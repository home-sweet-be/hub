// Auto-tag de zone des commandes par géolocalisation (remplace le Zap ville→tag).
// Pour chaque commande SANS tag de zone, on calcule la zone à partir de la
// lat/lon (point-dans-polygone), et on pose le tag correspondant sur la commande
// via l'API tags existante. Précis au tracé de la carte, aucune table de villes.
import { zoneFromLatLon, geocodeAddress } from './zoneGeo'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

function hasZoneTag(order) {
  const has = (tags) => (tags || []).some((t) => ZONE_TAG_PATTERN.test(t))
  return has(order?.tags) || has(order?.customer?.tags)
}

// lat/lon de Shopify si dispo, sinon géocodage Mapbox de l'adresse.
async function resolveZone(order) {
  const a = order?.shippingAddress
  if (!a) return null
  let lat = typeof a.latitude === 'number' ? a.latitude : null
  let lon = typeof a.longitude === 'number' ? a.longitude : null
  if (lat === null || lon === null) {
    const geo = await geocodeAddress(a)
    if (geo) {
      lat = geo.lat
      lon = geo.lon
    }
  }
  if (lat === null || lon === null) return null
  return zoneFromLatLon(lat, lon)
}

/**
 * Tague en masse les commandes sans zone d'après leur position.
 * @param {Array} orders liste de commandes (avec shippingAddress + id)
 * @returns {Promise<Map<string,string>>} map orderId → tag de zone réellement posé
 */
export async function autoTagOrdersByLocation(orders) {
  const targets = (Array.isArray(orders) ? orders : []).filter(
    (o) => o?.id && !hasZoneTag(o)
  )
  if (targets.length === 0) return new Map()

  // Résout la zone de chaque commande (séquentiel : borne les appels géocodage).
  const resolved = []
  for (const o of targets) {
    const zone = await resolveZone(o)
    if (zone) resolved.push({ id: o.id, zone })
  }
  if (resolved.length === 0) return new Map()

  // Groupe par zone : l'API tags applique un même `add` à tous les orderIds.
  const byZone = new Map()
  for (const { id, zone } of resolved) {
    if (!byZone.has(zone)) byZone.set(zone, [])
    byZone.get(zone).push(id)
  }

  const tagged = new Map()
  for (const [zone, ids] of byZone) {
    try {
      const r = await fetch('/api/shopify/orders/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids, add: [zone], remove: [] }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok && !data.hasErrors) {
        for (const id of ids) tagged.set(id, zone)
      }
    } catch {
      // best-effort : les non-taguées seront retentées au prochain chargement
    }
  }
  return tagged
}
