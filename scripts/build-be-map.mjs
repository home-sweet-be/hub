// One-shot: simplify the user's delivery-zone GeoJSON (public/geoexample.json)
// and emit a small JS module of SVG paths for the heatmap.
//
// The 8 outer BE provinces in geoexample.json leave a hole in the middle
// (Bruxelles + Brabant flamand + Brabant wallon). We fill that hole with the
// real NUTS-2 boundaries (Eurostat GISCO), each clipped to the hole so their
// outer edges snap exactly to the surrounding provinces (no slivers).
// Also adds low-opacity context countries (NL, DE, CH, GB) clipped by viewBox.
//
// Inputs:
//   - public/geoexample.json        (user zones, JSONC-ish)
//   - nuts-brabant-brussels.json    (Eurostat GISCO NUTS-2: BE10/BE24/BE31)
//   - ne-countries.json             (Natural Earth 110m, only neighbors used)
// Output: src/components/belgiumProvincesPaths.js
import fs from 'node:fs'
import polygonClipping from 'polygon-clipping'

const SRC = 'public/geoexample.json'
const OUT = 'src/components/belgiumProvincesPaths.js'
const EPS_DEG = 0.0025
const VIEW_W = 1000

// Hainaut split: slanted line pivoting at Mons, tilted 5° clockwise (top→east)
const HAINAUT_CUT_LON = 3.9514 // Mons longitude
const HAINAUT_PIVOT_LAT = 50.4542 // Mons latitude
const HAINAUT_TILT_DEG = 12 // visual tilt to the right
const _cosLatBE = Math.cos((50.5 * Math.PI) / 180)
const HAINAUT_SLOPE =
  Math.tan((HAINAUT_TILT_DEG * Math.PI) / 180) / _cosLatBE
const cutLonAt = (lat) =>
  HAINAUT_CUT_LON + (lat - HAINAUT_PIVOT_LAT) * HAINAUT_SLOPE

// id (from properties.id) → metadata + matching Shopify zone tags
const ZONE_META = {
  // Belgium provinces / regions
  BEVAN: { id: 'antwerpen', label: 'Anvers', zones: ['BE-Anvers'], country: 'BE' },
  BEVOV: { id: 'oost-vl', label: 'Flandre orientale', zones: ['BE-Flandre-Orientale'], country: 'BE' },
  BEVWV: { id: 'west-vl', label: 'Flandre occidentale', zones: ['BE-Flandre-Occidentale'], country: 'BE' },
  BEVLI: { id: 'limburg', label: 'Limbourg', zones: ['BE-Limbourg'], country: 'BE' },
  BEWHTO: { id: 'hainaut-ouest', label: 'Hainaut Ouest', zones: ['BE-Hainaut-Ouest'], country: 'BE' },
  BEWHTE: { id: 'hainaut-est', label: 'Hainaut Est', zones: ['BE-Hainaut-Est'], country: 'BE' },
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

// ---- Split Hainaut (BEWHT) into east/west at Mons longitude ----
{
  const hai = data.features.find((f) => f.properties?.id === 'BEWHT')
  if (hai) {
    const polys =
      hai.geometry.type === 'Polygon'
        ? [hai.geometry.coordinates]
        : hai.geometry.coordinates
    const cutS = cutLonAt(45)
    const cutN = cutLonAt(55)
    const westRect = [[[
      [-10, 45], [cutS, 45],
      [cutN, 55], [-10, 55], [-10, 45],
    ]]]
    const eastRect = [[[
      [cutS, 45], [20, 45],
      [20, 55], [cutN, 55], [cutS, 45],
    ]]]
    const west = polygonClipping.intersection(polys, westRect)
    const east = polygonClipping.intersection(polys, eastRect)
    data.features = data.features.filter((f) => f.properties?.id !== 'BEWHT')
    const push = (id, name, mp) => {
      if (mp.length === 0) return
      data.features.push({
        type: 'Feature',
        properties: { id, name, source: 'split-from-BEWHT' },
        geometry: {
          type: mp.length === 1 ? 'Polygon' : 'MultiPolygon',
          coordinates: mp.length === 1 ? mp[0] : mp,
        },
      })
    }
    push('BEWHTO', 'Hainaut Ouest', west)
    push('BEWHTE', 'Hainaut Est', east)
  }
}

// ---- Split the central hole into Bruxelles-Capitale + the two Brabants ----
// The 8 outer provinces leave a hole in the middle = Bruxelles + Brabant
// flamand + Brabant wallon. We compute that hole, then fill it with the real
// NUTS-2 boundaries, each intersected with the hole so their outer edges snap
// exactly to the surrounding provinces (no gaps / overlaps).
const BE_IDS = ['BEVAN', 'BEVOV', 'BEVWV', 'BEVLI', 'BEWHTO', 'BEWHTE', 'BEWNA', 'BEWLX', 'BEWLG']
const bePolygons = data.features
  .filter((f) => BE_IDS.includes(f.properties?.id))
  .map((f) =>
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates]
      : f.geometry.coordinates
  )
const union = polygonClipping.union(...bePolygons)
// Each union polygon = [outerRing, hole1, hole2, ...]. polygon-clipping returns
// outer = CCW, holes = CW. Invert each hole so it becomes a normal (CCW) outer
// ring, then use the collection as a MultiPolygon clip mask.
const holeMask = []
for (const poly of union) {
  for (let h = 1; h < poly.length; h++) {
    holeMask.push([[...poly[h]].reverse()])
  }
}

const NUTS_PATH = 'nuts-brabant-brussels.json'
// NUTS_ID (Eurostat) → feature id + metadata + matching Shopify zone tags
const NUTS_META = {
  BE10: { id: 'BEBRU', metaId: 'brussels', label: 'Bruxelles', zones: ['BE-Bruxelles'] },
  BE24: { id: 'BEVBR', metaId: 'brabant-flamand', label: 'Brabant flamand', zones: ['BE-Brabant-Flamand'] },
  BE31: { id: 'BEWBR', metaId: 'brabant-wallon', label: 'Brabant wallon', zones: ['BE-Brabant-Wallon'] },
}
if (holeMask.length > 0 && fs.existsSync(NUTS_PATH)) {
  const nuts = JSON.parse(fs.readFileSync(NUTS_PATH, 'utf8'))
  for (const f of nuts.features) {
    const m = NUTS_META[f.properties?.NUTS_ID]
    if (!m) continue
    const subj =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates
    const clipped = polygonClipping.intersection(subj, holeMask)
    if (!clipped.length) {
      console.warn(`Empty clip for ${f.properties.NUTS_ID} — skipping`)
      continue
    }
    data.features.push({
      type: 'Feature',
      properties: { id: m.id, name: m.label, source: 'nuts-clipped-to-hole' },
      geometry: { type: 'MultiPolygon', coordinates: clipped },
    })
    ZONE_META[m.id] = {
      id: m.metaId,
      label: m.label,
      zones: m.zones,
      country: 'BE',
    }
  }
} else {
  console.warn(`(no ${NUTS_PATH} or empty hole — Bruxelles/Brabant zones skipped)`)
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

// Bounds: zoom on BE+LU. FR regions still render where they overlap, but
// they don't push the viewBox out (otherwise the map dezooms a lot for the
// huge French regions vs the small Belgium provinces).
let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity
for (const { meta, rings } of simplified) {
  if (meta.country !== 'BE' && meta.country !== 'LU') continue
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < lonMin) lonMin = lon
      if (lon > lonMax) lonMax = lon
      if (lat < latMin) latMin = lat
      if (lat > latMax) latMax = lat
    }
  }
}

// Output GeoJSON-style geometry in lon/lat — Mapbox GL handles projection.
function roundRing(ring) {
  return ring.map(([lon, lat]) => [
    Math.round(lon * 10000) / 10000,
    Math.round(lat * 10000) / 10000,
  ])
}

const provinces = simplified.map(({ meta, rings }) => {
  const rounded = rings.map(roundRing)
  return {
    ...meta,
    geometry:
      rounded.length === 1
        ? { type: 'Polygon', coordinates: [rounded[0]] }
        : {
            type: 'MultiPolygon',
            coordinates: rounded.map((r) => [r]),
          },
  }
})

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
//
// [lonMin, latMin, lonMax, latMax] — bbox of BE+LU zones (used as
// initial map fit-bounds in BelgiumHeatmap)
export const BE_BBOX = [${lonMin}, ${latMin}, ${lonMax}, ${latMax}]
// Each zone: id, label, country, zones (Shopify tags), geometry (GeoJSON)
export const BE_PROVINCES = ${JSON.stringify(provinces)}
`

fs.writeFileSync(OUT, out)
const totalPts = provinces.reduce((s, p) => {
  const coords = p.geometry.coordinates
  const flat = p.geometry.type === 'Polygon' ? coords : coords.flat()
  return s + flat.reduce((ss, r) => ss + r.length, 0)
}, 0)
console.log(
  `Wrote ${OUT} — ${provinces.length} zones, ${totalPts} pts, ${fs.statSync(OUT).size} B`
)
