import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function StockAdjustModal({
  open,
  onClose,
  items,
  orderCount = 0,
  onConfirm,
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [editedItems, setEditedItems] = useState([])

  useEffect(() => {
    if (open && Array.isArray(items)) {
      setEditedItems(items.map((it) => ({ ...it, editing: false })))
    }
  }, [open, items])

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

  const setDelta = (idx, raw) => {
    const n = parseInt(raw, 10)
    setEditedItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, delta: Number.isFinite(n) ? n : 0 } : it
      )
    )
  }

  const bumpDelta = (idx, by) => {
    setEditedItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, delta: (it.delta || 0) + by } : it
      )
    )
  }

  const startEdit = (idx) => {
    setEditedItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, editing: true } : it))
    )
  }

  const handleConfirm = async () => {
    setPending(true)
    setError(null)
    try {
      const toApply = editedItems.filter((it) => it.delta !== 0)
      await onConfirm?.(toApply)
    } catch (e) {
      setError(e.message || String(e))
      setPending(false)
    } finally {
      setPending(false)
    }
  }

  const total = editedItems.reduce((s, it) => s + (it.delta || 0), 0)

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
            <h3 id="stock-modal-title">Réceptionner les produits</h3>
            <p className="stock-modal__subtitle">
              {editedItems.length} référence
              {editedItems.length > 1 ? 's' : ''} · delta total{' '}
              <strong className={total < 0 ? 'is-negative' : ''}>
                {total > 0 ? '+' : ''}
                {total}
              </strong>{' '}
              unité{Math.abs(total) > 1 ? 's' : ''}
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
                {editedItems.map((it, idx) => {
                  const before = it.before
                  const delta = it.delta || 0
                  const after =
                    typeof before === 'number' ? before + delta : null
                  const deltaClass =
                    delta > 0
                      ? 'stock-modal__delta-input is-positive'
                      : delta < 0
                      ? 'stock-modal__delta-input is-negative'
                      : 'stock-modal__delta-input is-zero'
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
                        {it.editing ? (
                          <div className="stock-modal__delta-group">
                            <button
                              type="button"
                              className="stock-modal__delta-btn"
                              onClick={() => bumpDelta(idx, -1)}
                              disabled={pending}
                              aria-label="Diminuer"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              className={deltaClass}
                              value={delta}
                              onChange={(e) => setDelta(idx, e.target.value)}
                              disabled={pending}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="stock-modal__delta-btn"
                              onClick={() => bumpDelta(idx, 1)}
                              disabled={pending}
                              aria-label="Augmenter"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={
                              'stock-modal__delta-pill' +
                              (delta > 0
                                ? ' is-positive'
                                : delta < 0
                                ? ' is-negative'
                                : ' is-zero')
                            }
                            onClick={() => startEdit(idx)}
                            disabled={pending}
                            title="Cliquer pour ajuster"
                          >
                            {delta > 0 ? `+${delta}` : delta}
                          </button>
                        )}
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
          <span className="stock-modal__order-count">
            {orderCount} commande{orderCount > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            className="btn btn--green"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending
              ? 'Réception en cours…'
              : 'Marquer comme prêtes pour la livraison'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
