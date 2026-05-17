// One-shot: read be-provinces-raw.geojson, simplify via Douglas-Peucker,
// project to SVG viewBox, emit src/components/belgiumProvincesPaths.js
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'be-provinces-raw.geojson'
const OUT = 'src/components/belgiumProvincesPaths.js'

const EPS_DEG = 0.0025 // ~250m, good for a small inline map
const VIEW_W = 1000

// Belgium roughly: lon 2.55..6.4, lat 49.5..51.55
const NISCODE_TO_META = {
  10000: { id: 'antwerpen', label: 'Anvers', zones: ['BE-Anvers'] },
  20001: { id: 'vlaams-brabant', label: 'Brabant flamand', zones: [] },
  20002: { id: 'brabant-wallon', label: 'Brabant wallon', zones: [] },
  30000: {
    id: 'west-vl',
    label: 'Flandre occidentale',
    zones: ['BE-Flandre-Occidentale'],
  },
  40000: {
    id: 'oost-vl',
    label: 'Flandre orientale',
    zones: ['BE-Flandre-Orientale'],
  },
  50000: {
    id: 'hainaut',
    label: 'Hainaut',
    zones: ['BE-Hainaut-Est', 'BE-Hainaut-Ouest', 'BE-Hainaut'],
  },
  60000: { id: 'liege', label: 'Liège', zones: ['BE-Liège'] },
  70000: { id: 'limburg', label: 'Limbourg', zones: ['BE-Limbourg'] },
  80000: { id: 'luxembourg-be', label: 'Luxembourg', zones: ['BE-Luxembourg'] },
  90000: { id: 'namur', label: 'Namur', zones: ['BE-Namur'] },
}
// Brussels has niscode "NA" + fictitious=1
const BRUSSELS_META = {
  id: 'brussels',
  label: 'Bruxelles',
  zones: ['BE-Bruxelles'],
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t =
    ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
  const tc = Math.max(0, Math.min(1, t))
  const px = a[0] + tc * dx
  const py = a[1] + tc * dy
  return Math.hypot(p[0] - px, p[1] - py)
}

function dpSimplify(points, eps) {
  if (points.length < 3) return points
  let maxDist = 0
  let maxIdx = 0
  const a = points[0]
  const b = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
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
  // DP on open polyline
  // To preserve the closed shape we add the first point at end before simplifying
  const withClose = [...open, open[0]]
  const simp = dpSimplify(withClose, EPS_DEG)
  // Ensure closed
  return simp
}

function simplifyPolygon(rings) {
  return rings.map(simplifyRing).filter((r) => r.length >= 3)
}

function simplifyGeometry(geom) {
  if (geom.type === 'Polygon') {
    return simplifyPolygon(geom.coordinates)
  }
  if (geom.type === 'MultiPolygon') {
    // Drop tiny polygons (likely islands/artifacts < threshold)
    return geom.coordinates
      .map(simplifyPolygon)
      .flat()
      .filter((r) => r.length >= 4)
  }
  return []
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const features = raw.features

// First pass: simplify and gather global bounds
const simplifiedByFid = {}
let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity
for (const f of features) {
  const rings = simplifyGeometry(f.geometry)
  simplifiedByFid[f.properties.fid] = { rings, props: f.properties }
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

const provinces = []
for (const f of features) {
  const props = f.properties
  const meta =
    props.fictitious === 1 && /bruxelles|brussel/i.test(props.namedut || '')
      ? BRUSSELS_META
      : NISCODE_TO_META[parseInt(props.niscode, 10)]
  if (!meta) continue
  const rings = simplifiedByFid[f.properties.fid].rings
  const d = rings.map(ringToPath).join(' ')
  provinces.push({ ...meta, d })
}

// Sort so Brussels renders last (overlay on top of Vlaams-Brabant)
provinces.sort((a, b) => (a.id === 'brussels' ? 1 : b.id === 'brussels' ? -1 : 0))

const out = `// AUTO-GENERATED from be-provinces-raw.geojson by scripts/build-be-map.mjs
// Do not edit by hand. To regenerate: node scripts/build-be-map.mjs
export const BE_VIEW_BOX = '0 0 ${VIEW_W} ${VIEW_H}'
export const BE_PROVINCES = ${JSON.stringify(provinces, null, 2)}
`

fs.writeFileSync(OUT, out)

const totalCoords = provinces.reduce(
  (s, p) => s + (p.d.match(/[ML]/g) || []).length,
  0
)
console.log(
  `Wrote ${OUT} — ${provinces.length} provinces, ${totalCoords} total points, ${fs.statSync(OUT).size} bytes, viewBox 0 0 ${VIEW_W} ${VIEW_H}`
)
