import {
  BE_PROVINCES,
  BE_VIEW_BOX,
  BE_VIEW_W,
  BE_VIEW_H,
  BE_BBOX,
} from './belgiumProvincesPaths.js'

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

export default function BelgiumHeatmap({ zoneCounts, max }) {
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
    </svg>
  )
}
