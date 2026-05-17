// Simplified Belgian provinces (approximate polygons — not pixel-perfect)
// ViewBox: 0 0 320 240 (top-left origin, north = top)
const PROVINCES = [
  {
    id: 'antwerpen',
    label: 'Anvers',
    zones: ['BE-Anvers'],
    d: 'M 130,10 L 210,5 L 235,55 L 190,70 L 130,55 Z',
  },
  {
    id: 'limburg',
    label: 'Limbourg',
    zones: ['BE-Limbourg'],
    d: 'M 210,5 L 280,30 L 290,80 L 235,75 L 210,55 Z',
  },
  {
    id: 'west-vl',
    label: 'Flandre occidentale',
    zones: ['BE-Flandre-Occidentale'],
    d: 'M 10,30 L 75,15 L 90,75 L 75,100 L 15,95 L 5,60 Z',
  },
  {
    id: 'oost-vl',
    label: 'Flandre orientale',
    zones: ['BE-Flandre-Orientale'],
    d: 'M 75,15 L 130,10 L 130,55 L 115,80 L 90,75 Z',
  },
  {
    id: 'vlaams-brabant',
    label: 'Brabant flamand',
    zones: [],
    d: 'M 115,80 L 130,55 L 190,70 L 200,115 L 145,130 L 115,110 Z',
  },
  {
    id: 'brabant-wallon',
    label: 'Brabant wallon',
    zones: [],
    d: 'M 115,110 L 145,130 L 200,115 L 200,150 L 130,150 Z',
  },
  {
    id: 'hainaut',
    label: 'Hainaut',
    zones: ['BE-Hainaut-Est', 'BE-Hainaut-Ouest', 'BE-Hainaut'],
    d: 'M 5,95 L 75,100 L 115,110 L 130,150 L 130,170 L 90,210 L 40,210 L 5,160 Z',
  },
  {
    id: 'liege',
    label: 'Liège',
    zones: ['BE-Liège'],
    d: 'M 200,115 L 200,70 L 235,55 L 290,80 L 300,140 L 250,165 L 220,140 Z',
  },
  {
    id: 'namur',
    label: 'Namur',
    zones: ['BE-Namur'],
    d: 'M 130,150 L 200,150 L 220,140 L 215,195 L 175,210 L 130,195 Z',
  },
  {
    id: 'luxembourg-be',
    label: 'Luxembourg',
    zones: ['BE-Luxembourg'],
    d: 'M 215,195 L 250,165 L 300,140 L 315,240 L 220,235 Z',
  },
  {
    id: 'brussels',
    label: 'Bruxelles',
    zones: ['BE-Bruxelles'],
    d: 'M 140,95 L 165,95 L 165,115 L 140,115 Z',
  },
]

function colorFor(count, max) {
  if (count === 0) return { fill: '#eceff3', stroke: 'rgba(28,28,30,0.18)' }
  const f = max > 0 ? count / max : 0
  // Amber → red ramp
  // f=0 (just above 0) → light amber, f=1 → vivid red
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
      viewBox="0 0 320 250"
      className="bemap"
      role="img"
      aria-label="Carte de Belgique — heatmap des zones en attente"
      preserveAspectRatio="xMidYMid meet"
    >
      {PROVINCES.map((p) => {
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
            strokeWidth="1"
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
