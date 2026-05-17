import { BE_PROVINCES, BE_VIEW_BOX } from './belgiumProvincesPaths.js'

function colorFor(count, max, country, hasZone) {
  // Untagged / no waiting orders → neutral by country
  if (count === 0) {
    if (country === 'FR' && !hasZone) {
      return { fill: '#f6f6f8', stroke: 'rgba(28,28,30,0.1)' }
    }
    return { fill: '#eceff3', stroke: 'rgba(28,28,30,0.18)' }
  }
  const f = max > 0 ? count / max : 0
  const opacity = 0.35 + 0.55 * f
  const hue = 30 - 30 * f
  return {
    fill: `hsla(${hue}, 95%, 50%, ${opacity})`,
    stroke: `hsla(${hue}, 80%, 38%, ${Math.min(1, opacity + 0.25)})`,
  }
}

export default function BelgiumHeatmap({ zoneCounts, max }) {
  return (
    <svg
      viewBox={BE_VIEW_BOX}
      className="bemap"
      role="img"
      aria-label="Carte régionale — heatmap des zones en attente"
      preserveAspectRatio="xMidYMid meet"
    >
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
            strokeWidth={p.country === 'BE' ? 1.4 : 1.1}
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
