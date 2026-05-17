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
  // Cap width at 1280 (Mapbox Static API limit)
  const w = Math.min(1280, BE_VIEW_W)
  const h = Math.round((w * BE_VIEW_H) / BE_VIEW_W)
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/${bbox}/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
}

function colorFor(count, max, country, hasZone) {
  // No waiting orders: keep the zone visible but very faint so the
  // underlying Mapbox basemap shows through.
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

export default function BelgiumHeatmap({ zoneCounts, max, pins = [] }) {
  const mapUrl = buildMapboxUrl()
  return (
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
        const { fill, stroke } = colorFor(count, max, p.country, hasZone)
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
          x < -20 || x > BE_VIEW_W + 20 ||
          y < -30 || y > BE_VIEW_H + 20
        ) return null
        return (
          <g
            key={p.key || i}
            transform={`translate(${x},${y})`}
            className="bemap__pin"
          >
            <path
              d="M0,0 L-5.5,-8.5 A6,6 0 1 1 5.5,-8.5 Z"
              fill="#ea4335"
              stroke="#fff"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <circle cx="0" cy="-12" r="2.8" fill="#fff" />
            {p.label && <title>{p.label}</title>}
          </g>
        )
      })}
    </svg>
  )
}
