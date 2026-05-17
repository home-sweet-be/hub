// One-shot: simplify the user's delivery-zone GeoJSON (public/geoexample.json)
// and emit a small JS module of SVG paths for the heatmap.
//
// Also derives BE-Bruxelles as the hole inside the union of all BE provinces,
// and adds low-opacity context countries (NL, DE, CH, GB) clipped by viewBox.
//
// Inputs:
//   - public/geoexample.json  (user zones, JSONC-ish)
//   - ne-countries.json       (Natural Earth 110m, only neighbors used)
// Output: src/components/belgiumProvincesPaths.js
import fs from 'node:fs'
import polygonClipping from 'polygon-clipping'

const SRC = 'public/geoexample.json'
const OUT = 'src/components/belgiumProvincesPaths.js'
const EPS_DEG = 0.0025
const VIEW_W = 1000

// id (from properties.id) → metadata + matching Shopify zone tags
const ZONE_META = {
  // Belgium provinces / regions
  BEVAN: { id: 'antwerpen', label: 'Anvers', zones: ['BE-Anvers'], country: 'BE' },
  BEVOV: { id: 'oost-vl', label: 'Flandre orientale', zones: ['BE-Flandre-Orientale'], country: 'BE' },
  BEVWV: { id: 'west-vl', label: 'Flandre occidentale', zones: ['BE-Flandre-Occidentale'], country: 'BE' },
  BEVLI: { id: 'limburg', label: 'Limbourg', zones: ['BE-Limbourg'], country: 'BE' },
  BEWHT: { id: 'hainaut', label: 'Hainaut', zones: ['BE-Hainaut-Est', 'BE-Hainaut-Ouest', 'BE-Hainaut'], country: 'BE' },
  BEWNA: { id: 'namur', label: 'Namur', zones: ['BE-Namur'], country: 'BE' },
  BEWLX: { id: 'luxembourg-be', label: 'Luxembourg (BE)', zones: ['BE-Luxembourg'], country: 'BE' },
  BEWLG: { id: 'liege', label: 'Liège', zones: ['BE-Liège'], country: 'BE' },
  // Luxembourg country
  LU: { id: 'luxembourg-lu', label: 'Luxembourg', zones: ['LU'], country: 'LU' },
  // France regions
  FRHDF: { id: 'fr-hdf', label: 'Hauts-de-France', zones: ['FR-Nord'], country: 'FR' },
  FRGES: { id: 'fr-ge', label: 'Grand Est', zones: ['FR-Est'], country: 'FR' },
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
  const tc = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy))
}

function dpSimplify(points, eps) {
  if (points.length < 3) return points
  let maxDist = 0
  let maxIdx = 0
  const a = points[0]
  const b = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b)
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist > eps) {
    const left = dpSimplify(points.slice(0, maxIdx + 1), eps)
    const right = dpSimplify(points.slice(maxIdx), eps)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

function simplifyRing(ring) {
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const open = closed ? ring.slice(0, -1) : ring
  const withClose = [...open, open[0]]
  return dpSimplify(withClose, EPS_DEG)
}

function simplifyPolygon(rings) {
  return rings.map(simplifyRing).filter((r) => r.length >= 4)
}

function simplifyGeometry(geom) {
  if (geom.type === 'Polygon') return simplifyPolygon(geom.coordinates)
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(simplifyPolygon).flat().filter((r) => r.length >= 4)
  }
  return []
}

// ---- Parse JSONC (tolerate trailing commas) ----
let raw = fs.readFileSync(SRC, 'utf8')
raw = raw.replace(/,(\s*[}\]])/g, '$1')
const data = JSON.parse(raw)

// ---- Derive BE-Bruxelles from the hole in the BE provinces union ----
const BE_IDS = ['BEVAN', 'BEVOV', 'BEVWV', 'BEVLI', 'BEWHT', 'BEWNA', 'BEWLX', 'BEWLG']
const bePolygons = data.features
  .filter((f) => BE_IDS.includes(f.properties?.id))
  .map((f) =>
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates]
      : f.geometry.coordinates
  )
const union = polygonClipping.union(...bePolygons)
// Each polygon = [outerRing, hole1, hole2, ...]. Collect holes as Bruxelles.
const bruxellesRings = []
for (const poly of union) {
  for (let h = 1; h < poly.length; h++) {
    // GeoJSON rings: holes are clockwise (CW). polygon-clipping returns
    // outer = CCW, holes = CW. We invert the hole so it draws as a normal
    // (filled) outer polygon when treated standalone.
    bruxellesRings.push([...poly[h]].reverse())
  }
}
if (bruxellesRings.length > 0) {
  data.features.push({
    type: 'Feature',
    properties: {
      id: 'BEBRU',
      name: 'Bruxelles & Brabant',
      source: 'derived-from-hole',
    },
    geometry: {
      type: bruxellesRings.length === 1 ? 'Polygon' : 'MultiPolygon',
      coordinates:
        bruxellesRings.length === 1
          ? [bruxellesRings[0]]
          : bruxellesRings.map((r) => [r]),
    },
  })
  ZONE_META.BEBRU = {
    id: 'brussels',
    label: 'Bruxelles',
    zones: ['BE-Bruxelles'],
    country: 'BE',
  }
}

// ---- Add low-opacity context countries (background, no zones) ----
const CONTEXT_COUNTRIES = {
  France: { id: 'ctx-fr', label: 'France' },
  Netherlands: { id: 'ctx-nl', label: 'Pays-Bas' },
  Germany: { id: 'ctx-de', label: 'Allemagne' },
  Switzerland: { id: 'ctx-ch', label: 'Suisse' },
  'United Kingdom': { id: 'ctx-gb', label: 'Royaume-Uni' },
  Austria: { id: 'ctx-at', label: 'Autriche' },
  Italy: { id: 'ctx-it', label: 'Italie' },
  Spain: { id: 'ctx-es', label: 'Espagne' },
}
const NE_PATH = 'ne-countries.json'
if (fs.existsSync(NE_PATH)) {
  const ne = JSON.parse(fs.readFileSync(NE_PATH, 'utf8'))
  for (const f of ne.features) {
    const name = f.properties.NAME || f.properties.name
    const m = CONTEXT_COUNTRIES[name]
    if (!m) continue
    const id = `CTX_${m.id.replace('ctx-', '').toUpperCase()}`
    data.features.push({
      type: 'Feature',
      properties: { id, name, source: 'natural-earth-110m' },
      geometry: f.geometry,
    })
    ZONE_META[id] = {
      id: m.id,
      label: m.label,
      zones: [],
      country: 'CTX',
    }
  }
} else {
  console.warn(`(no ${NE_PATH} — skipping context countries)`)
}

// ---- Collect & simplify ----
const simplified = []
for (const f of data.features) {
  const id = f.properties?.id
  const meta = ZONE_META[id]
  if (!meta) {
    console.warn(`Skipping unknown feature id: ${id}`)
    continue
  }
  simplified.push({ meta, rings: simplifyGeometry(f.geometry) })
}

// Bounds computed from zone features only (context countries don't count —
// SVG viewBox clips them naturally)
let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity
for (const { meta, rings } of simplified) {
  if (meta.country === 'CTX') continue
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < lonMin) lonMin = lon
      if (lon > lonMax) lonMax = lon
      if (lat < latMin) latMin = lat
      if (lat > latMax) latMax = lat
    }
  }
}

const cosLat = Math.cos(((latMin + latMax) / 2) * (Math.PI / 180))
const projWidth = (lonMax - lonMin) * cosLat
const projHeight = latMax - latMin
const VIEW_H = Math.round(VIEW_W * (projHeight / projWidth))
const scaleX = VIEW_W / projWidth
const scaleY = VIEW_H / projHeight

function project(lon, lat) {
  return [
    Math.round((lon - lonMin) * cosLat * scaleX * 10) / 10,
    Math.round((latMax - lat) * scaleY * 10) / 10,
  ]
}

function ringToPath(ring) {
  let d = ''
  ring.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, lat)
    d += (i === 0 ? 'M' : 'L') + x + ',' + y
  })
  return d + 'Z'
}

const provinces = simplified.map(({ meta, rings }) => ({
  ...meta,
  d: rings.map(ringToPath).join(' '),
}))

// Render order: context countries → FR regions → LU → BE provinces → Brussels last
const COUNTRY_ORDER = { CTX: 0, FR: 1, LU: 2, BE: 3 }
provinces.sort((a, b) => {
  const c = COUNTRY_ORDER[a.country] - COUNTRY_ORDER[b.country]
  if (c !== 0) return c
  if (a.id === 'brussels') return 1
  if (b.id === 'brussels') return -1
  return 0
})

const out = `// AUTO-GENERATED from public/geoexample.json by scripts/build-be-map.mjs
// Regenerate: node scripts/build-be-map.mjs
export const BE_VIEW_BOX = '0 0 ${VIEW_W} ${VIEW_H}'
export const BE_PROVINCES = ${JSON.stringify(provinces, null, 2)}
`

fs.writeFileSync(OUT, out)
const totalPts = provinces.reduce((s, p) => s + (p.d.match(/[ML]/g) || []).length, 0)
console.log(
  `Wrote ${OUT} — ${provinces.length} zones, ${totalPts} pts, ${fs.statSync(OUT).size} B, viewBox 0 0 ${VIEW_W} ${VIEW_H}`
)
