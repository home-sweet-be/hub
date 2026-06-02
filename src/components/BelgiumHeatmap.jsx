import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { BE_PROVINCES, BE_BBOX } from './belgiumProvincesPaths.js'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

function zonesFeatureCollection(zoneCounts, zoneCoverage, max) {
  return {
    type: 'FeatureCollection',
    features: BE_PROVINCES.map((p) => {
      const count = p.zones.reduce(
        (sum, z) => sum + (zoneCounts.get(z) || 0),
        0
      )
      const coverage = p.zones.reduce(
        (sum, z) => sum + (zoneCoverage?.get(z) || 0),
        0
      )
      const covered = count > 0 && coverage >= count ? 1 : 0
      const intensity = max > 0 ? Math.min(1, count / max) : 0
      return {
        type: 'Feature',
        properties: {
          id: p.id,
          label: p.label,
          country: p.country,
          count,
          coverage,
          covered,
          intensity,
        },
        geometry: p.geometry,
      }
    }),
  }
}

function pinsFeatureCollection(pins) {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature',
      properties: {
        orderName: p.orderName || '',
        city: p.city || '',
        product: p.product || '',
        customerName: p.customerName || '',
        bookedAt: p.bookedAt || '',
        covered: p.covered ? 1 : 0,
        booked: p.booked ? 1 : 0,
        tier: p.tier || 'standard',
      },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  }
}

const TIER_LABEL = { premium: 'Premium', confort: 'Confort', standard: 'Standard' }
const TIER_COLOR = { premium: '#af52de', confort: '#ff9f0a', standard: '#9ba0a8' }

function formatBookedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('fr-BE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
  const time = d.toLocaleTimeString('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${date} · ${time}`
}

export default function BelgiumHeatmap({
  zoneCounts,
  zoneCoverage,
  max,
  pins = [],
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Init map once
  useEffect(() => {
    if (!containerRef.current || !mapboxgl.accessToken) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: [
        [BE_BBOX[0], BE_BBOX[1]],
        [BE_BBOX[2], BE_BBOX[3]],
      ],
      fitBoundsOptions: { padding: 16, animate: false },
      attributionControl: false,
      logoPosition: 'bottom-left',
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
            ['==', ['get', 'count'], 0],
            '#a8aab0',
            ['==', ['get', 'covered'], 1],
            '#34c759',
            '#ea4335',
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'count'], 0],
            0.18,
            0.4,
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
            ['==', ['get', 'count'], 0],
            'rgba(28,28,30,0.3)',
            ['==', ['get', 'covered'], 1],
            'rgba(30,90,40,0.6)',
            'rgba(28,28,30,0.55)',
          ],
          'line-width': 1.1,
        },
      })

      map.addSource('pins', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'pins-layer',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['==', ['get', 'covered'], 1],
            '#34c759',
            '#ea4335',
          ],
          'circle-stroke-color': [
            'match',
            ['get', 'tier'],
            'premium', '#af52de',
            'confort', '#ff9f0a',
            '#fff',
          ],
          'circle-stroke-width': [
            'match',
            ['get', 'tier'],
            'premium', 2.4,
            'confort', 2.4,
            1.6,
          ],
        },
      })
      map.addLayer({
        id: 'pins-booked-check',
        type: 'symbol',
        source: 'pins',
        filter: ['==', ['get', 'booked'], 1],
        layout: {
          'text-field': '✓',
          'text-size': 8,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-offset': [0, 0.05],
        },
        paint: {
          'text-color': '#fff',
        },
      })

      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'bemap-popup',
      })

      map.on('mouseenter', 'pins-layer', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (!f) return
        const {
          orderName,
          city,
          product,
          customerName,
          bookedAt,
          booked,
          tier,
        } = f.properties
        const isBooked = String(booked) === '1'
        const tierKey = String(tier || 'standard')
        const tierLabel = TIER_LABEL[tierKey] || 'Standard'
        const tierColor = TIER_COLOR[tierKey] || TIER_COLOR.standard
        const bookedLabel = formatBookedAt(bookedAt)
        const html = `
          <div class="bemap-popup__head">
            <div class="bemap-popup__num">${escapeHtml(orderName)}</div>
            <span class="bemap-popup__tier" style="background:${tierColor}">${escapeHtml(tierLabel)}</span>
          </div>
          ${
            isBooked
              ? `<div class="bemap-popup__status bemap-popup__status--booked"><span class="bemap-popup__check">✓</span> Réservée${bookedLabel ? ` · ${escapeHtml(bookedLabel)}` : ''}</div>`
              : `<div class="bemap-popup__status bemap-popup__status--waiting">En attente de réservation</div>`
          }
          ${customerName ? `<div class="bemap-popup__row"><span class="bemap-popup__ico">👤</span>${escapeHtml(customerName)}</div>` : ''}
          ${city ? `<div class="bemap-popup__row"><span class="bemap-popup__ico">📍</span>${escapeHtml(city)}</div>` : ''}
          ${product ? `<div class="bemap-popup__row bemap-popup__row--product">${escapeHtml(product)}</div>` : ''}
        `
        popupRef.current
          .setLngLat(f.geometry.coordinates)
          .setHTML(html)
          .addTo(map)
      })
      map.on('mouseleave', 'pins-layer', () => {
        map.getCanvas().style.cursor = ''
        popupRef.current?.remove()
      })

      map.resize()
      setReady(true)
    })

    mapRef.current = map

    // The map can be created before its container has its final size — e.g.
    // when navigating to this tab inside the Shopify iframe — which leaves it
    // rendered grey and never recovering. Resize it whenever the container
    // changes size, plus a few times shortly after mount.
    const ro = new ResizeObserver(() => {
      try {
        map.resize()
      } catch {
        // ignore
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)
    const resizeTimers = [60, 250, 600, 1200].map((ms) =>
      setTimeout(() => {
        try {
          map.resize()
        } catch {
          // ignore
        }
      }, ms)
    )

    return () => {
      ro.disconnect()
      resizeTimers.forEach(clearTimeout)
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Push zone data when counts/coverage change
  useEffect(() => {
    if (!ready) return
    const src = mapRef.current.getSource('zones')
    if (src) src.setData(zonesFeatureCollection(zoneCounts, zoneCoverage, max))
  }, [ready, zoneCounts, zoneCoverage, max])

  // Push pins
  const pinsData = useMemo(() => pinsFeatureCollection(pins), [pins])
  useEffect(() => {
    if (!ready) return
    const src = mapRef.current.getSource('pins')
    if (src) src.setData(pinsData)
  }, [ready, pinsData])

  return <div ref={containerRef} className="bemap-gl" />
}
