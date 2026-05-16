import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// ~300 km radius. 1° latitude ≈ 111 km, so 2.7° ≈ 300 km.
const BBOX_DEG = 2.7

function buildOsmEmbedUrl(lat, lon) {
  const left = lon - BBOX_DEG
  const right = lon + BBOX_DEG
  const top = lat + BBOX_DEG
  const bottom = lat - BBOX_DEG
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lon}`
}

function buildOsmLinkUrl(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=6/${lat}/${lon}`
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
          {hasCoords ? (
            <a
              href={buildOsmLinkUrl(lat, lon)}
              target="_blank"
              rel="noopener noreferrer"
              className="address-modal__map"
              title="Ouvrir dans OpenStreetMap"
            >
              <iframe
                src={buildOsmEmbedUrl(lat, lon)}
                title="Carte"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
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
              {hasCoords && (
                <a
                  href={buildOsmLinkUrl(lat, lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="address-modal__action"
                >
                  Ouvrir dans OpenStreetMap
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
