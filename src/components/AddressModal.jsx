import { useEffect } from 'react'
import { createPortal } from 'react-dom'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAP_ZOOM = 8

function buildMapboxStatic(lat, lon, width = 900, height = 500) {
  if (!MAPBOX_TOKEN) return null
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+ed2939(${lon},${lat})/${lon},${lat},${MAP_ZOOM}/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}`
}

function buildGmapsUrl(lat, lon, q) {
  if (lat && lon) {
    return `https://www.google.com/maps?q=${lat},${lon}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    q || ''
  )}`
}

export default function AddressModal({
  open,
  onClose,
  address,
  customerName,
  orderName,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !address) return null

  const lat = typeof address.latitude === 'number' ? address.latitude : null
  const lon = typeof address.longitude === 'number' ? address.longitude : null
  const hasCoords = lat !== null && lon !== null

  const cityLine = [address.zip, address.city].filter(Boolean).join(' ')
  const lines = [
    address.address1,
    address.address2,
    cityLine,
    [address.province, address.country].filter(Boolean).join(' · '),
  ].filter(Boolean)
  const flatAddress = lines.join(', ')

  return createPortal(
    <div
      className="address-modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="address-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="address-modal__header">
          <div>
            <h3 id="address-modal-title">Adresse de livraison</h3>
            {(orderName || customerName) && (
              <p className="address-modal__subtitle">
                {orderName && <span>{orderName}</span>}
                {orderName && customerName && <span> · </span>}
                {customerName && <span>{customerName}</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            className="address-modal__close"
            onClick={onClose}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <div className="address-modal__body">
          {hasCoords && buildMapboxStatic(lat, lon) ? (
            <a
              href={buildGmapsUrl(lat, lon, flatAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="address-modal__map"
              title="Ouvrir dans Google Maps"
            >
              <img
                src={buildMapboxStatic(lat, lon)}
                alt="Carte de l'adresse"
                loading="lazy"
              />
            </a>
          ) : (
            <div className="address-modal__no-map">
              Coordonnées GPS indisponibles pour cette adresse.
            </div>
          )}

          <div className="address-modal__address">
            {address.name && (
              <div className="address-modal__name">{address.name}</div>
            )}
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
            <div className="address-modal__actions">
              <a
                href={buildGmapsUrl(lat, lon, flatAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="address-modal__action"
              >
                Ouvrir dans Google Maps
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
