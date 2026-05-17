import { useEffect, useRef, useState } from 'react'
import {
  BE_PROVINCES,
  BE_VIEW_BOX,
  BE_VIEW_W,
  BE_VIEW_H,
  BE_BBOX,
} from './belgiumProvincesPaths.js'

const [_LON_MIN, _LAT_MIN, _LON_MAX, _LAT_MAX] = BE_BBOX
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const X_MIN_MERC = (_LON_MIN * Math.PI) / 180
const X_MAX_MERC = (_LON_MAX * Math.PI) / 180
const Y_MIN_MERC = mercY(_LAT_MIN)
const Y_MAX_MERC = mercY(_LAT_MAX)

function projectLonLat(lon, lat) {
  const x =
    (((lon * Math.PI) / 180 - X_MIN_MERC) / (X_MAX_MERC - X_MIN_MERC)) *
    BE_VIEW_W
  const y =
    ((Y_MAX_MERC - mercY(lat)) / (Y_MAX_MERC - Y_MIN_MERC)) * BE_VIEW_H
  return [x, y]
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_STYLE = 'mapbox/light-v11'

function buildMapboxUrl() {
  if (!MAPBOX_TOKEN) return null
  const [lonMin, latMin, lonMax, latMax] = BE_BBOX
  const bbox = `[${lonMin},${latMin},${lonMax},${latMax}]`
  const w = Math.min(1280, BE_VIEW_W)
  const h = Math.round((w * BE_VIEW_H) / BE_VIEW_W)
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/${bbox}/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
}

function colorFor(count, max) {
  if (count === 0) {
    return {
      fill: 'rgba(255, 255, 255, 0.18)',
      stroke: 'rgba(28, 28, 30, 0.45)',
    }
  }
  const f = max > 0 ? count / max : 0
  const opacity = 0.55 + 0.35 * f
  const hue = 30 - 30 * f
  return {
    fill: `hsla(${hue}, 95%, 50%, ${opacity})`,
    stroke: `hsla(${hue}, 80%, 38%, ${Math.min(1, opacity + 0.25)})`,
  }
}

const MIN_SCALE = 1
const MAX_SCALE = 8

export default function BelgiumHeatmap({ zoneCounts, max, pins = [] }) {
  const mapUrl = buildMapboxUrl()
  const wrapRef = useRef(null)
  const dragRef = useRef(null)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [tooltip, setTooltip] = useState(null) // { pin, x, y }

  // Wheel zoom — non-passive listener so we can call preventDefault
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setView((v) => {
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
        if (newScale === v.scale) return v
        const contentX = (cx - v.x) / v.scale
        const contentY = (cy - v.y) / v.scale
        return {
          x: cx - contentX * newScale,
          y: cy - contentY * newScale,
          scale: newScale,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    // Ignore drags that start on a pin (lets the user click them later)
    if (e.target.closest('.bemap__pin')) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) + Math.abs(dy) > 2) dragRef.current.moved = true
    setView((v) => ({
      ...v,
      x: dragRef.current.viewX + dx,
      y: dragRef.current.viewY + dy,
    }))
  }
  const onPointerUp = () => {
    dragRef.current = null
  }

  const onPinEnter = (e, pin) => {
    const rect = wrapRef.current.getBoundingClientRect()
    setTooltip({
      pin,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }
  const onPinMove = (e) => {
    if (!tooltip) return
    const rect = wrapRef.current.getBoundingClientRect()
    setTooltip((t) =>
      t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : t
    )
  }
  const onPinLeave = () => setTooltip(null)

  const resetView = () => setView({ x: 0, y: 0, scale: 1 })
  const isZoomed = view.scale > 1.001 || view.x !== 0 || view.y !== 0

  return (
    <div
      ref={wrapRef}
      className={'bemap-wrap' + (dragRef.current ? ' is-dragging' : '')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="bemap-pan-zoom"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          viewBox={BE_VIEW_BOX}
          className="bemap"
          role="img"
          aria-label="Carte régionale — heatmap des zones en attente"
          preserveAspectRatio="xMidYMid meet"
        >
          {mapUrl && (
            <image
              href={mapUrl}
              x="0"
              y="0"
              width={BE_VIEW_W}
              height={BE_VIEW_H}
              preserveAspectRatio="none"
              opacity="0.85"
            />
          )}
          {BE_PROVINCES.map((p) => {
            const count = p.zones.reduce(
              (sum, z) => sum + (zoneCounts.get(z) || 0),
              0
            )
            const hasZone = p.zones.length > 0
            const { fill, stroke } = colorFor(count, max)
            return (
              <path
                key={p.id}
                d={p.d}
                fill={fill}
                stroke={stroke}
                strokeWidth={
                  p.country === 'CTX' ? 0.8 : p.country === 'BE' ? 1.4 : 1.1
                }
                strokeLinejoin="round"
                className={
                  'bemap__province' +
                  ` is-${p.country.toLowerCase()}` +
                  (hasZone ? ' has-zone' : '') +
                  (count > 0 ? ' is-hot' : '') +
                  (p.id === 'brussels' ? ' is-brussels' : '')
                }
              >
                <title>
                  {p.label}
                  {count > 0 ? ` — ${count} en attente` : ''}
                </title>
              </path>
            )
          })}
          {pins.map((p, i) => {
            const [x, y] = projectLonLat(p.lon, p.lat)
            if (
              x < -20 ||
              x > BE_VIEW_W + 20 ||
              y < -30 ||
              y > BE_VIEW_H + 20
            )
              return null
            // Counter-scale so pins stay roughly the same screen size when zoomed
            const pinScale = 1 / view.scale
            return (
              <g
                key={p.key || i}
                transform={`translate(${x},${y}) scale(${pinScale})`}
                className="bemap__pin"
                onMouseEnter={(e) => onPinEnter(e, p)}
                onMouseMove={onPinMove}
                onMouseLeave={onPinLeave}
              >
                <path
                  d="M0,0 L-5.5,-8.5 A6,6 0 1 1 5.5,-8.5 Z"
                  fill="#ea4335"
                  stroke="#fff"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <circle cx="0" cy="-12" r="2.8" fill="#fff" />
              </g>
            )
          })}
        </svg>
      </div>

      {isZoomed && (
        <button
          type="button"
          className="bemap__reset"
          onClick={resetView}
          title="Réinitialiser la vue"
        >
          ⌂
        </button>
      )}

      {tooltip && (
        <div
          className="bemap-tooltip"
          style={{ left: tooltip.x, top: tooltip.y - 14 }}
        >
          <div className="bemap-tooltip__num">{tooltip.pin.orderName}</div>
          {tooltip.pin.city && (
            <div className="bemap-tooltip__row">
              <span>📍</span>
              {tooltip.pin.city}
            </div>
          )}
          {tooltip.pin.product && (
            <div className="bemap-tooltip__row bemap-tooltip__row--product">
              {tooltip.pin.product}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
