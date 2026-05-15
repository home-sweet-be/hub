import { useCallback, useEffect, useMemo, useState } from 'react'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE)-/i

const TABS = [
  {
    id: 'stock',
    label: 'EN STOCK',
    dot: '#34c759',
    supplierTitle: null,
    allowStockAdjust: false,
    filter: (o) => o.tags.includes('ProduitEnStock'),
  },
  {
    id: 'intercommerce',
    label: 'INTERCOMMERCE',
    supplierTitle: 'intercommerce',
    allowStockAdjust: true,
    filter: (o) =>
      o.tags.includes('SentToSupplier') &&
      o.lineItems.some((li) => li.vendor === 'INTERCOMMERCE'),
  },
  {
    id: 'eltap',
    label: 'ELTAP',
    supplierTitle: 'ELTAP',
    allowStockAdjust: true,
    filter: (o) =>
      o.tags.includes('SentToSupplier') &&
      o.lineItems.some((li) => li.vendor === 'ELTAP'),
  },
]

function extractZone(tags = []) {
  return tags.find((t) => ZONE_TAG_PATTERN.test(t)) || null
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function articleLine(li) {
  const parts = [`${li.quantity}× ${li.title}`]
  if (li.variantTitle) parts.push(`/ ${li.variantTitle}`)
  return parts.join(' ')
}

function productsSummary(items) {
  return items.map((li) => `${li.quantity}× ${li.title}`).join(', ')
}

export default function Receptions() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('intercommerce')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [pending, setPending] = useState(null) // 'adjust' | 'markReady' | null
  const [feedback, setFeedback] = useState(null) // { type, message }

  const load = useCallback(() => {
    setOrders(null)
    setError(null)
    return fetch('/api/shopify/receptions?first=250')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
        return r.json()
      })
      .then((data) => setOrders(data.orders || []))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Clear selection when changing tab (avoid mixing suppliers in stock adjust)
  useEffect(() => {
    setSelectedIds(new Set())
    setFeedback(null)
  }, [activeTab])

  const activeDef = TABS.find((t) => t.id === activeTab) || TABS[0]

  const filtered = useMemo(() => {
    if (!orders) return []
    return orders
      .filter(activeDef.filter)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
  }, [orders, activeDef])

  const selectedOrders = useMemo(() => {
    if (!orders) return []
    return orders.filter((o) => selectedIds.has(o.id))
  }, [orders, selectedIds])

  const addToCart = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      next.add(id)
      return next
    })
  }

  const removeFromCart = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }

  const handleAdjustStock = async () => {
    if (selectedOrders.length === 0) return
    setPending('adjust')
    setFeedback(null)
    try {
      const items = []
      for (const o of selectedOrders) {
        for (const li of o.lineItems) {
          if (li.variant?.inventoryItem?.id && li.quantity > 0) {
            items.push({
              inventoryItemId: li.variant.inventoryItem.id,
              delta: li.quantity,
            })
          }
        }
      }
      const r = await fetch('/api/shopify/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, reason: 'received' }),
      })
      const data = await r.json()
      if (!r.ok || data.ok === false) {
        throw new Error(
          (data.userErrors || data.errors || [{ message: 'Erreur inconnue' }])
            .map((e) => e.message)
            .join(' · ')
        )
      }
      setFeedback({
        type: 'ok',
        message: `Stock ajusté pour ${data.applied?.length || 0} référence(s).`,
      })
    } catch (e) {
      setFeedback({ type: 'err', message: e.message })
    } finally {
      setPending(null)
    }
  }

  const handleMarkReady = async () => {
    if (selectedOrders.length === 0) return
    setPending('markReady')
    setFeedback(null)
    try {
      const customerIds = [
        ...new Set(
          selectedOrders.map((o) => o.customer?.id).filter(Boolean)
        ),
      ]
      const r = await fetch('/api/shopify/orders/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: selectedOrders.map((o) => o.id),
          remove: ['SentToSupplier'],
          add: ['PretPourLaLivraison'],
          customerIds,
          customerAdd: ['SendingBookingEmail'],
        }),
      })
      const data = await r.json()
      if (!r.ok || data.hasErrors) {
        const messages = [
          ...(data.orderResults || []),
          ...(data.customerResults || []),
        ]
          .flatMap((x) => [...(x.addErrors || []), ...(x.removeErrors || [])])
          .map((e) => e.message)
        throw new Error(messages.join(' · ') || `HTTP ${r.status}`)
      }
      setFeedback({
        type: 'ok',
        message: `${selectedOrders.length} commande(s) marquée(s) prête(s) pour la livraison.`,
      })
      setSelectedIds(new Set())
      await load()
    } catch (e) {
      setFeedback({ type: 'err', message: e.message })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="page reception">
      <div className="reception__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              'reception__tab' + (t.id === activeTab ? ' is-active' : '')
            }
            onClick={() => setActiveTab(t.id)}
          >
            {t.dot && (
              <span
                className="reception__tab-dot"
                style={{ background: t.dot }}
                aria-hidden="true"
              />
            )}
            {t.label}
          </button>
        ))}
      </div>

      {activeDef.supplierTitle && (
        <div className="reception__supplier-title">{activeDef.supplierTitle}</div>
      )}

      <div className="reception__panes">
        {/* ---------- Left: reception cart ---------- */}
        <aside className="reception__left">
          <div className="reception__pane-label">Liste de commandes réceptionnées</div>

          <div className="reception-cart">
            <table className="reception-cart__table">
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Produit</th>
                  <th aria-label="action" />
                </tr>
              </thead>
              <tbody>
                {selectedOrders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="reception-cart__empty">
                      No rows found
                    </td>
                  </tr>
                )}
                {selectedOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="reception-num">
                        {o.name.replace(/^#/, '')}
                      </span>
                    </td>
                    <td className="reception-cart__products">
                      {productsSummary(o.lineItems)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="reception-action reception-action--remove"
                        onClick={() => removeFromCart(o.id)}
                        title="Retirer"
                      >
                        −
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="reception-cart__footer">
              <div className="reception-cart__count">
                {selectedOrders.length} sélectionnée{selectedOrders.length > 1 ? 's' : ''}
              </div>

              {feedback && (
                <div
                  className={
                    'reception-cart__feedback reception-cart__feedback--' +
                    feedback.type
                  }
                >
                  {feedback.message}
                </div>
              )}

              {activeDef.allowStockAdjust && (
                <button
                  type="button"
                  className="btn btn--blue"
                  disabled={selectedOrders.length === 0 || pending !== null}
                  onClick={handleAdjustStock}
                >
                  {pending === 'adjust'
                    ? 'Ajustement…'
                    : 'Ajuster les entrées en stock'}
                </button>
              )}

              <button
                type="button"
                className="btn btn--green"
                disabled={selectedOrders.length === 0 || pending !== null}
                onClick={handleMarkReady}
              >
                {pending === 'markReady'
                  ? 'Mise à jour…'
                  : 'Marquer comme prêtes pour la livraison'}
              </button>
            </div>
          </div>
        </aside>

        {/* ---------- Right: pending receptions ---------- */}
        <section className="reception__right">
          <div className="reception__pane-label reception__pane-label--right">
            Commandes à réceptionner par le fournisseur
          </div>

          {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}
          {orders === null && !error && (
            <p className="page__hint">Chargement…</p>
          )}

          {orders && (
            <div className="reception-table-wrap">
              <table className="reception-table">
                <thead>
                  <tr>
                    <th aria-label="action" />
                    <th>Produits</th>
                    <th>N°</th>
                    <th>Zone</th>
                    <th>Date</th>
                    <th>Articles</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="reception-table__empty">
                        Aucune commande dans cet onglet.
                      </td>
                    </tr>
                  )}
                  {filtered.map((o) => {
                    const zone = extractZone(o.tags)
                    const isSelected = selectedIds.has(o.id)
                    return (
                      <tr key={o.id} className={isSelected ? 'is-selected' : ''}>
                        <td>
                          <button
                            type="button"
                            className="reception-action"
                            onClick={() => addToCart(o.id)}
                            disabled={isSelected}
                            title={
                              isSelected ? 'Déjà ajoutée' : 'Ajouter au panier'
                            }
                          >
                            +
                          </button>
                        </td>
                        <td>
                          <div className="reception-thumbs">
                            {o.lineItems.slice(0, 4).map((li, idx) =>
                              li.image?.url ? (
                                <img
                                  key={idx}
                                  src={li.image.url}
                                  alt={li.image.altText || li.title}
                                  className="reception-thumb"
                                />
                              ) : (
                                <div
                                  key={idx}
                                  className="reception-thumb reception-thumb--placeholder"
                                  aria-hidden="true"
                                />
                              )
                            )}
                          </div>
                        </td>
                        <td className="reception-num">
                          {o.name.replace(/^#/, '')}
                        </td>
                        <td>
                          {zone ? (
                            <span className="zone-badge">{zone}</span>
                          ) : (
                            <span className="reception-table__muted">—</span>
                          )}
                        </td>
                        <td className="reception-date">
                          {formatDate(o.createdAt)}
                        </td>
                        <td className="reception-articles">
                          {o.lineItems.map((li, i) => (
                            <div key={i}>{articleLine(li)}</div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
