import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { zoneGeometryForTag, geocodeAddress } from '../lib/zoneGeo'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

function bboxOf(geom) {
  let mnx = Infinity,
    mny = Infinity,
    mxx = -Infinity,
    mxy = -Infinity
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  for (const poly of polys)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < mnx) mnx = x
        if (y < mny) mny = y
        if (x > mxx) mxx = x
        if (y > mxy) mxy = y
      }
  return [mnx, mny, mxx, mxy]
}

// Carte interactive (zoomable) du modal de zone : pin de l'adresse + polygone de
// la zone survolée dessiné par-dessus, recadré pour montrer d'un coup d'œil si le
// client tombe bien dans la zone.
export default function ZoneConfirmMap({ address, highlightTag }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [pin, setPin] = useState(null)
  const [noCoords, setNoCoords] = useState(false)

  // Coordonnées du pin : lat/lon Shopify, sinon géocodage Mapbox de l'adresse.
  useEffect(() => {
    let alive = true
    const lat = typeof address?.latitude === 'number' ? address.latitude : null
    const lon = typeof address?.longitude === 'number' ? address.longitude : null
    if (lat !== null && lon !== null) {
      setPin({ lon, lat })
      setNoCoords(false)
      return
    }
    setPin(null)
    setNoCoords(false)
    geocodeAddress(address).then((geo) => {
      if (!alive) return
      if (geo) setPin(geo)
      else setNoCoords(true)
    })
    return () => {
      alive = false
    }
  }, [address])

  // Init de la carte (une fois).
  useEffect(() => {
    if (!containerRef.current || !mapboxgl.accessToken) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [4.35, 50.85],
      zoom: 7,
      attributionControl: false,
    })
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      'top-right'
    )
    map.on('load', () => {
      map.addSource('hl', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'hl-fill',
        type: 'fill',
        source: 'hl',
        paint: { 'fill-color': '#0a84ff', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'hl-line',
        type: 'line',
        source: 'hl',
        paint: { 'line-color': '#0a5fb8', 'line-width': 2 },
      })
      setReady(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      setReady(false)
    }
  }, [])

  // Pose / déplace le pin + centre sur l'adresse.
  useEffect(() => {
    if (!ready || !pin) return
    const map = mapRef.current
    map.resize()
    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: '#ed2939' })
        .setLngLat([pin.lon, pin.lat])
        .addTo(map)
      map.easeTo({ center: [pin.lon, pin.lat], zoom: 10, duration: 400 })
    } else {
      markerRef.current.setLngLat([pin.lon, pin.lat])
    }
  }, [ready, pin])

  // Dessine la zone survolée et recadre pour l'afficher entièrement (+ le pin).
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    const src = map.getSource('hl')
    if (!src) return
    const geom = highlightTag ? zoneGeometryForTag(highlightTag) : null
    if (!geom) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    src.setData({ type: 'Feature', properties: {}, geometry: geom })
    const [mnx, mny, mxx, mxy] = bboxOf(geom)
    const b = new mapboxgl.LngLatBounds([mnx, mny], [mxx, mxy])
    if (pin) b.extend([pin.lon, pin.lat])
    map.fitBounds(b, { padding: 40, duration: 500, maxZoom: 12 })
  }, [ready, highlightTag, pin])

  if (noCoords && !pin) {
    return (
      <div className="zone-modal__no-map zone-modal__no-map--full">
        Adresse non localisable
      </div>
    )
  }
  return <div ref={containerRef} className="zone-modal__gl-map" />
}
