// Géolocalisation d'une commande → tag de zone, par point-dans-polygone sur les
// contours de `belgiumProvincesPaths.js` (mêmes tracés que la carte du hub).
//
// Deux subtilités gérées ici :
//  1. Le build aplatit les trous en anneaux séparés (ex: Brabant flamand
//     entoure Bruxelles → un anneau = le contour de Bruxelles). On applique donc
//     la règle even-odd PAR zone : un point compté dans un nombre impair
//     d'anneaux de la zone est dedans, pair = dehors (donc un point bruxellois
//     est exclu du Brabant flamand).
//  2. Le sens de rotation des anneaux n'est pas homogène (certaines provinces
//     source sont CW, les zones dérivées CCW) → on n'utilise jamais l'aire
//     signée pour décider, seulement even-odd.
import { BE_PROVINCES } from '../components/belgiumProvincesPaths.js'

// Priorité d'attribution : BE avant LU avant FR. Utile aux frontières où les
// tracés simplifiés de deux pays peuvent se chevaucher de quelques centaines de
// mètres — on privilégie la Belgique (boutique belge).
const COUNTRY_ORDER = { BE: 0, LU: 1, FR: 2 }
const ORDERED_ZONES = [...BE_PROVINCES]
  .filter((p) => p.zones?.[0])
  .sort(
    (a, b) => (COUNTRY_ORDER[a.country] ?? 9) - (COUNTRY_ORDER[b.country] ?? 9)
  )

// Ray-casting : le point [lon,lat] est-il dans cet anneau ?
function pointInRing(lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function ringsOf(geom) {
  if (geom.type === 'Polygon') return geom.coordinates
  // MultiPolygon : tableau de polygones (chacun = tableau d'anneaux) → à plat
  return geom.coordinates.flatMap((poly) => poly)
}

// Règle even-odd sur tous les anneaux d'une même zone (gère les trous).
function pointInZone(lon, lat, geom) {
  let crossings = 0
  for (const ring of ringsOf(geom)) {
    if (pointInRing(lon, lat, ring)) crossings++
  }
  return crossings % 2 === 1
}

/**
 * Renvoie le tag de zone (ex: 'BE-Bruxelles') qui contient ce point, ou null si
 * le point ne tombe dans aucune zone connue.
 */
export function zoneFromLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  for (const p of ORDERED_ZONES) {
    if (pointInZone(lon, lat, p.geometry)) return p.zones[0]
  }
  return null
}

function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return a / 2
}

/**
 * Géométrie GeoJSON d'affichage pour un tag de zone, avec les TROUS reconstruits
 * (le build aplatit les anneaux ; ici on ré-associe chaque anneau intérieur à
 * son extérieur pour que, p.ex., Bruxelles apparaisse comme un trou du Brabant
 * flamand et non comme une surface pleine). Renvoie une Polygon/MultiPolygon
 * ou null si le tag n'a pas de tracé (ex: LIV-Externe).
 */
export function zoneGeometryForTag(tag) {
  if (!tag) return null
  const p = BE_PROVINCES.find((z) => z.zones?.[0] === tag)
  if (!p) return null
  const rings = ringsOf(p.geometry)
  if (rings.length === 0) return null
  if (rings.length === 1) return { type: 'Polygon', coordinates: [rings[0]] }
  // Le plus grand anneau = extérieur ; les anneaux contenus dedans = trous ;
  // un anneau disjoint = un autre extérieur (îlot).
  const sorted = [...rings].sort(
    (a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a))
  )
  const outers = []
  for (const r of sorted) {
    const [px, py] = r[0]
    let placed = false
    for (const o of outers) {
      if (
        pointInRing(px, py, o.ring) &&
        !o.holes.some((h) => pointInRing(px, py, h))
      ) {
        o.holes.push(r)
        placed = true
        break
      }
    }
    if (!placed) outers.push({ ring: r, holes: [] })
  }
  const polys = outers.map((o) => [o.ring, ...o.holes])
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

const MAPBOX_TOKEN = import.meta.env?.VITE_MAPBOX_TOKEN

/**
 * Fallback quand Shopify n'a pas géocodé l'adresse : géocodage direct via
 * Mapbox → { lat, lon } ou null. Best-effort, silencieux en cas d'échec.
 */
export async function geocodeAddress(address) {
  if (!MAPBOX_TOKEN || !address) return null
  const q = [
    address.address1,
    [address.zip, address.city].filter(Boolean).join(' '),
    address.country,
  ]
    .filter(Boolean)
    .join(', ')
    .trim()
  if (!q) return null
  try {
    const url =
      'https://api.mapbox.com/search/geocode/v6/forward?limit=1&q=' +
      encodeURIComponent(q) +
      '&access_token=' +
      MAPBOX_TOKEN
    const r = await fetch(url)
    if (!r.ok) return null
    const data = await r.json()
    const c = data?.features?.[0]?.geometry?.coordinates
    if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      return { lon: c[0], lat: c[1] }
    }
    return null
  } catch {
    return null
  }
}
