import { BE_PROVINCES, BE_VIEW_BOX } from './belgiumProvincesPaths.js'

function colorFor(count, max) {
  if (count === 0) return { fill: '#eceff3', stroke: 'rgba(28,28,30,0.18)' }
  const f = max > 0 ? count / max : 0
  const opacity = 0.35 + 0.55 * f
  const hue = 30 - 30 * f // 30 (amber) → 0 (red)
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
      aria-label="Carte de Belgique — heatmap des zones en attente"
      preserveAspectRatio="xMidYMid meet"
    >
      {BE_PROVINCES.map((p) => {
        const count = p.zones.reduce(
          (sum, z) => sum + (zoneCounts.get(z) || 0),
          0
        )
        const { fill, stroke } = colorFor(count, max)
        return (
          <path
            key={p.id}
            d={p.d}
            fill={fill}
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinejoin="round"
            className={
              'bemap__province' +
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
