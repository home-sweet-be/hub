import { useEffect, useState } from 'react'
import { ZoneFlag, zoneCode } from './ZoneFlag'

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

export default function ZoneModal({
  open,
  onClose,
  currentZone,
  customerId,
  customerName,
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

  return (
    <div
      className="zone-modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="zone-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="zone-modal__header">
          <div>
            <h3 id="zone-modal-title">Changer la zone de livraison</h3>
            {customerName && (
              <p className="zone-modal__subtitle">
                Client&nbsp;: {customerName}
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
                      <ZoneFlag code={zoneCode(z)} />
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

        {error && <div className="zone-modal__error">{error}</div>}
        {pending && <div className="zone-modal__pending">Mise à jour…</div>}
      </div>
    </div>
  )
}
