export function ZoneFlag({ code, className = 'zone-badge__flag' }) {
  switch (code) {
    case 'BE':
      return (
        <svg className={className} viewBox="0 0 3 2" aria-hidden="true">
          <rect width="1" height="2" x="0" fill="#000" />
          <rect width="1" height="2" x="1" fill="#fae042" />
          <rect width="1" height="2" x="2" fill="#ed2939" />
        </svg>
      )
    case 'FR':
      return (
        <svg className={className} viewBox="0 0 3 2" aria-hidden="true">
          <rect width="1" height="2" x="0" fill="#0055a4" />
          <rect width="1" height="2" x="1" fill="#fff" />
          <rect width="1" height="2" x="2" fill="#ef4135" />
        </svg>
      )
    case 'LU':
      return (
        <svg className={className} viewBox="0 0 3 2" aria-hidden="true">
          <rect width="3" height="0.667" y="0" fill="#ed2939" />
          <rect width="3" height="0.667" y="0.667" fill="#fff" />
          <rect width="3" height="0.666" y="1.333" fill="#00a1de" />
        </svg>
      )
    case 'NL':
      return (
        <svg className={className} viewBox="0 0 3 2" aria-hidden="true">
          <rect width="3" height="0.667" y="0" fill="#ae1c28" />
          <rect width="3" height="0.667" y="0.667" fill="#fff" />
          <rect width="3" height="0.666" y="1.333" fill="#21468b" />
        </svg>
      )
    case 'DE':
      return (
        <svg className={className} viewBox="0 0 3 2" aria-hidden="true">
          <rect width="3" height="0.667" y="0" fill="#000" />
          <rect width="3" height="0.667" y="0.667" fill="#dd0000" />
          <rect width="3" height="0.666" y="1.333" fill="#ffce00" />
        </svg>
      )
    default:
      return null
  }
}

export function zoneCode(zone) {
  if (!zone) return null
  return zone.slice(0, 2).toUpperCase()
}
