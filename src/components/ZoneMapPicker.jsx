import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { BE_PROVINCES, BE_BBOX } from './belgiumProvincesPaths.js'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

function buildFC(selected) {
  return {
    type: 'FeatureCollection',
    features: BE_PROVINCES.map((p) => ({
      type: 'Feature',
      properties: {
        zone: p.zones[0] || '',
        label: p.label,
        selected: p.zones[0] && selected.has(p.zones[0]) ? 1 : 0,
      },
      geometry: p.geometry,
    })),
  }
}

export default function ZoneMapPicker({ selected, onToggle, disabled }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const onToggleRef = useRef(onToggle)
  const disabledRef = useRef(disabled)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onToggleRef.current = onToggle
  })
  useEffect(() => {
    disabledRef.current = disabled
  })

  useEffect(() => {
    if (!containerRef.current || !mapboxgl.accessToken) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: [
        [BE_BBOX[0], BE_BBOX[1]],
        [BE_BBOX[2], BE_BBOX[3]],
      ],
      fitBoundsOptions: { padding: 12, animate: false },
      attributionControl: false,
    })
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      'top-right'
    )

    map.on('load', () => {
      map.addSource('zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'selected'], 1],
            '#0a84ff',
            '#a8aab0',
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'selected'], 1],
            0.45,
            0.16,
          ],
        },
      })
      map.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'selected'], 1],
            '#0a5fb8',
            'rgba(28,28,30,0.4)',
          ],
          'line-width': [
            'case',
            ['==', ['get', 'selected'], 1],
            1.6,
            1.1,
          ],
        },
      })

      map.on('mouseenter', 'zones-fill', () => {
        if (!disabledRef.current)
          map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'zones-fill', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', 'zones-fill', (e) => {
        if (disabledRef.current) return
        const z = e.features?.[0]?.properties?.zone
        if (z && onToggleRef.current) onToggleRef.current(z)
      })

      setReady(true)
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const src = mapRef.current.getSource('zones')
    if (src) src.setData(buildFC(selected))
  }, [ready, selected])

  return <div ref={containerRef} className="zonemap-picker" />
}
