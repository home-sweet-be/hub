import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function StockAdjustModal({
  open,
  onClose,
  items,
  onConfirm,
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !pending) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, pending])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  if (!open) return null

  const handleConfirm = async () => {
    setPending(true)
    setError(null)
    try {
      await onConfirm?.()
    } catch (e) {
      setError(e.message || String(e))
      setPending(false)
    } finally {
      setPending(false)
    }
  }

  const total = items.reduce((s, it) => s + it.delta, 0)

  return createPortal(
    <div
      className="stock-modal__backdrop"
      onClick={pending ? undefined : onClose}
      role="presentation"
    >
      <div
        className="stock-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="stock-modal__header">
          <div>
            <h3 id="stock-modal-title">Ajuster les entrées en stock</h3>
            <p className="stock-modal__subtitle">
              {items.length} référence{items.length > 1 ? 's' : ''} · {total}{' '}
              unité{total > 1 ? 's' : ''} à ajouter
            </p>
          </div>
          <button
            type="button"
            className="stock-modal__close"
            onClick={onClose}
            disabled={pending}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <div className="stock-modal__body">
          {items.length === 0 ? (
            <div className="stock-modal__empty">Aucune ligne à ajuster.</div>
          ) : (
            <table className="stock-modal__table">
              <thead>
                <tr>
                  <th aria-label="image" />
                  <th>Produit</th>
                  <th>SKU</th>
                  <th className="stock-modal__num">Dispo. avant</th>
                  <th />
                  <th className="stock-modal__num">Dispo. après</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const before = it.before
                  const after =
                    typeof before === 'number' ? before + it.delta : null
                  return (
                    <tr key={it.inventoryItemId}>
                      <td className="stock-modal__img-cell">
                        {it.imageUrl ? (
                          <img src={it.imageUrl} alt="" />
                        ) : (
                          <div className="stock-modal__img-placeholder" />
                        )}
                      </td>
                      <td className="stock-modal__title">
                        <div>{it.title}</div>
                        {it.variantTitle && (
                          <div className="stock-modal__variant">
                            {it.variantTitle}
                          </div>
                        )}
                      </td>
                      <td className="stock-modal__sku">{it.sku || '—'}</td>
                      <td className="stock-modal__num">
                        {typeof before === 'number' ? before : '—'}
                      </td>
                      <td className="stock-modal__arrow">
                        <span className="stock-modal__delta">
                          +{it.delta}
                        </span>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 12h14" />
                          <path d="M13 5l7 7-7 7" />
                        </svg>
                      </td>
                      <td className="stock-modal__num stock-modal__after">
                        {after !== null ? after : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {error && <div className="stock-modal__error">{error}</div>}

        <footer className="stock-modal__footer">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={pending}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--blue"
            onClick={handleConfirm}
            disabled={pending || items.length === 0}
          >
            {pending ? 'Ajustement…' : 'Valider l\'ajustement'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
