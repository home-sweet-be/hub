// One-shot: build a simplified SVG map covering BE provinces, LU country,
// and the NE quarter of France (regions).
//
// Inputs (must exist next to this script's CWD = repo root):
//   - be-provinces-raw.geojson  (10 provinces + Brussels)
//   - lu-raw.geojson            (Luxembourg country)
//   - fr-regions-raw.geojson    (13 French regions, simplified)
//
// Output: src/components/belgiumProvincesPaths.js
import fs from 'node:fs'

const OUT = 'src/components/belgiumProvincesPaths.js'
const EPS_DEG = 0.0025
const VIEW_W = 1000

const BE_NISCODE_TO_META = {
  10000: { id: 'antwerpen', label: 'Anvers', zones: ['BE-Anvers'], country: 'BE' },
  20001: { id: 'vlaams-brabant', label: 'Brabant flamand', zones: [], country: 'BE' },
  20002: { id: 'brabant-wallon', label: 'Brabant wallon', zones: [], country: 'BE' },
  30000: { id: 'west-vl', label: 'Flandre occidentale', zones: ['BE-Flandre-Occidentale'], country: 'BE' },
  40000: { id: 'oost-vl', label: 'Flandre orientale', zones: ['BE-Flandre-Orientale'], country: 'BE' },
  50000: { id: 'hainaut', label: 'Hainaut', zones: ['BE-Hainaut-Est', 'BE-Hainaut-Ouest', 'BE-Hainaut'], country: 'BE' },
  60000: { id: 'liege', label: 'Liège', zones: ['BE-Liège'], country: 'BE' },
  70000: { id: 'limburg', label: 'Limbourg', zones: ['BE-Limbourg'], country: 'BE' },
  80000: { id: 'luxembourg-be', label: 'Luxembourg (BE)', zones: ['BE-Luxembourg'], country: 'BE' },
  90000: { id: 'namur', label: 'Namur', zones: ['BE-Namur'], country: 'BE' },
}
const BRUSSELS_META = { id: 'brussels', label: 'Bruxelles', zones: ['BE-Bruxelles'], country: 'BE' }

// French regions to include (NE quarter — Hauts-de-France + Grand Est tagged,
// the rest greyed-out as visual context)
const FR_REGION_TO_META = {
  '32': { id: 'fr-hdf', label: 'Hauts-de-France', zones: ['FR-Nord'], country: 'FR' },
  '44': { id: 'fr-ge', label: 'Grand Est', zones: ['FR-Est'], country: 'FR' },
  '11': { id: 'fr-idf', label: 'Île-de-France', zones: [], country: 'FR' },
  '27': { id: 'fr-bfc', label: 'Bourgogne-Franche-Comté', zones: [], country: 'FR' },
  '28': { id: 'fr-norm', label: 'Normandie', zones: [], country: 'FR' },
  '24': { id: 'fr-cvl', label: 'Centre-Val de Loire', zones: [], country: 'FR' },
}

const LU_META = { id: 'luxembourg-lu', label: 'Luxembourg', zones: ['LU'], country: 'LU' }

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

// ---- Collect raw features ---------------------------------------------
const raw = []

// Belgium provinces
const be = JSON.parse(fs.readFileSync('be-provinces-raw.geojson', 'utf8'))
for (const f of be.features) {
  const p = f.properties
  const meta = p.fictitious === 1 && /bruxelles|brussel/i.test(p.namedut || '')
    ? BRUSSELS_META
    : BE_NISCODE_TO_META[parseInt(p.niscode, 10)]
  if (meta) raw.push({ meta, geom: f.geometry })
}

// Luxembourg country
const lu = JSON.parse(fs.readFileSync('lu-raw.geojson', 'utf8'))
raw.push({ meta: LU_META, geom: lu.features[0].geometry })

// France regions (NE only)
const fr = JSON.parse(fs.readFileSync('fr-regions-raw.geojson', 'utf8'))
for (const f of fr.features) {
  const meta = FR_REGION_TO_META[f.properties.code]
  if (meta) raw.push({ meta, geom: f.geometry })
}

// ---- Simplify + bounds ------------------------------------------------
const simplified = raw.map(({ meta, geom }) => ({
  meta,
  rings: simplifyGeometry(geom),
}))

let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity
for (const { rings } of simplified) {
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
const aspect = projWidth / projHeight
const VIEW_H = Math.round(VIEW_W / aspect)
const scaleX = VIEW_W / projWidth
const scaleY = VIEW_H / projHeight

function project(lon, lat) {
  const x = (lon - lonMin) * cosLat * scaleX
  const y = (latMax - lat) * scaleY
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
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

// Render order: France first (background), then BE provinces, then Brussels last
const COUNTRY_ORDER = { FR: 0, LU: 1, BE: 2 }
provinces.sort((a, b) => {
  const ca = COUNTRY_ORDER[a.country] - COUNTRY_ORDER[b.country]
  if (ca !== 0) return ca
  if (a.id === 'brussels') return 1
  if (b.id === 'brussels') return -1
  return 0
})

const out = `// AUTO-GENERATED from be-provinces-raw.geojson + lu-raw.geojson + fr-regions-raw.geojson
// Do not edit by hand. Regenerate: node scripts/build-be-map.mjs
export const BE_VIEW_BOX = '0 0 ${VIEW_W} ${VIEW_H}'
export const BE_PROVINCES = ${JSON.stringify(provinces, null, 2)}
`

fs.writeFileSync(OUT, out)

const totalPts = provinces.reduce((s, p) => s + (p.d.match(/[ML]/g) || []).length, 0)
console.log(
  `Wrote ${OUT} — ${provinces.length} features, ${totalPts} pts, ${fs.statSync(OUT).size} B, viewBox 0 0 ${VIEW_W} ${VIEW_H}`
)
