import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ZoneFlag } from './ZoneFlag'

export const ZONES_BY_COUNTRY = {
  Belgique: [
    'BE-Anvers',
    'BE-Bruxelles',
    'BE-Flandre-Occidentale',
    'BE-Flandre-Orientale',
    'BE-Hainaut-Est',
    'BE-Hainaut-Ouest',
    'BE-Limbourg',
    'BE-Liège',
    'BE-Luxembourg',
    'BE-Namur',
  ],
  Luxembourg: ['LU'],
  France: ['FR-Est', 'FR-Nord'],
}

const COUNTRY_FLAG = {
  Belgique: 'BE',
  Luxembourg: 'LU',
  France: 'FR',
}

function zoneLabel(zone) {
  if (zone === 'LU') return 'Pays entier'
  return zone.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
}

// ~100 km radius. 1° latitude ≈ 111 km, so 0.9° ≈ 100 km.
const BBOX_DEG = 0.9

function osmEmbed(lat, lon) {
  const left = lon - BBOX_DEG
  const right = lon + BBOX_DEG
  const top = lat + BBOX_DEG
  const bottom = lat - BBOX_DEG
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lon}`
}

function osmLink(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=7/${lat}/${lon}`
}

function gmapsLink(lat, lon, q) {
  if (lat != null && lon != null) {
    return `https://www.google.com/maps?q=${lat},${lon}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    q || ''
  )}`
}

export default function ZoneModal({
  open,
  onClose,
  currentZone,
  customerId,
  customerName,
  address,
  orderName,
  onChanged,
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const handleSelect = async (zone) => {
    if (zone === currentZone) {
      onClose?.()
      return
    }
    if (!customerId) {
      setError('Aucun client associé à cette commande, impossible de modifier la zone.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const r = await fetch('/api/shopify/orders/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerIds: [customerId],
          customerRemove: currentZone ? [currentZone] : [],
          customerAdd: [zone],
        }),
      })
      const data = await r.json()
      if (!r.ok || data.hasErrors) {
        const msg = (data.customerResults || [])
          .flatMap((x) => [...(x.addErrors || []), ...(x.removeErrors || [])])
          .map((e) => e.message)
          .join(' · ')
        throw new Error(msg || `HTTP ${r.status}`)
      }
      onChanged?.(zone)
      onClose?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setPending(false)
    }
  }

  const lat = typeof address?.latitude === 'number' ? address.latitude : null
  const lon = typeof address?.longitude === 'number' ? address.longitude : null
  const hasCoords = lat !== null && lon !== null
  const cityLine = address
    ? [address.zip, address.city].filter(Boolean).join(' ')
    : ''
  const addressLines = address
    ? [
        address.address1,
        address.address2,
        cityLine,
        [address.province, address.country].filter(Boolean).join(' · '),
      ].filter(Boolean)
    : []
  const flatAddress = addressLines.join(', ')

  return createPortal(
    <div
      className="zone-modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="zone-modal__card zone-modal__card--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="zone-modal__header">
          <div>
            <h3 id="zone-modal-title">Changer la zone de livraison</h3>
            {(orderName || customerName || flatAddress) && (
              <p className="zone-modal__subtitle">
                {orderName && <span>{orderName}</span>}
                {orderName && customerName && <span> · </span>}
                {customerName && <span>{customerName}</span>}
                {(orderName || customerName) && flatAddress && (
                  <span> · </span>
                )}
                {flatAddress && (
                  <span className="zone-modal__inline-address">
                    {flatAddress}
                  </span>
                )}
                {(flatAddress || hasCoords) && (
                  <>
                    {' '}
                    <a
                      href={gmapsLink(lat, lon, flatAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="zone-modal__gmaps-btn"
                      title="Ouvrir dans Google Maps"
                    >
                      Google Maps ↗
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            className="zone-modal__close"
            onClick={onClose}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <div className="zone-modal__layout">
          <aside className="zone-modal__address-pane">
            {hasCoords ? (
              <a
                href={osmLink(lat, lon)}
                target="_blank"
                rel="noopener noreferrer"
                className="zone-modal__map zone-modal__map--full"
                title="Ouvrir dans OpenStreetMap"
              >
                <iframe
                  src={osmEmbed(lat, lon)}
                  title="Carte"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </a>
            ) : (
              <div className="zone-modal__no-map zone-modal__no-map--full">
                Coordonnées GPS indisponibles
              </div>
            )}
          </aside>

          <div className="zone-modal__body">
            {Object.entries(ZONES_BY_COUNTRY).map(([country, zones]) => (
            <section key={country} className="zone-modal__section">
              <header className="zone-modal__section-header">
                <ZoneFlag
                  code={COUNTRY_FLAG[country]}
                  className="zone-modal__country-flag"
                />
                <span>{country}</span>
              </header>
              <div className="zone-modal__zones">
                {zones.map((z) => {
                  const active = z === currentZone
                  return (
                    <button
                      key={z}
                      type="button"
                      className={
                        'zone-modal__chip' + (active ? ' is-active' : '')
                      }
                      onClick={() => handleSelect(z)}
                      disabled={pending}
                    >
                      {zoneLabel(z)}
                      {active && (
                        <span className="zone-modal__current">actuelle</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          </div>
        </div>

        {error && <div className="zone-modal__error">{error}</div>}
        {pending && <div className="zone-modal__pending">Mise à jour…</div>}
      </div>
    </div>,
    document.body
  )
}
