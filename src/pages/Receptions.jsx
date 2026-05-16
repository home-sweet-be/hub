import { useCallback, useEffect, useMemo, useState } from 'react'
import { ZoneFlag, zoneCode } from '../components/ZoneFlag'
import ZoneModal from '../components/ZoneModal'
import AddressModal from '../components/AddressModal'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

const TABS = [
  {
    id: 'stock',
    label: 'EN STOCK',
    dot: '#34c759',
    vendor: null,
    supplierTitle: null,
    allowStockAdjust: false,
    filter: (o) => o.tags.includes('ProduitEnStock'),
  },
  {
    id: 'intercommerce',
    label: 'INTERCOMMERCE',
    vendor: 'INTERCOMMERCE',
    supplierTitle: 'intercommerce',
    allowStockAdjust: true,
    filter: (o) =>
      o.tags.includes('SentToSupplier') &&
      o.lineItems.some((li) => li.vendor === 'INTERCOMMERCE'),
  },
  {
    id: 'eltap',
    label: 'ELTAP',
    vendor: 'ELTAP',
    supplierTitle: 'ELTAP',
    allowStockAdjust: true,
    filter: (o) =>
      o.tags.includes('SentToSupplier') &&
      o.lineItems.some((li) => li.vendor === 'ELTAP'),
  },
]

function extractZone(order) {
  const find = (tags) => (tags || []).find((t) => ZONE_TAG_PATTERN.test(t))
  return find(order?.tags) || find(order?.customer?.tags) || null
}


function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function daysSince(iso) {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function customerName(c) {
  if (!c) return ''
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
}

function effectiveQuantity(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

function activeLineItems(order) {
  return order.lineItems.filter((li) => effectiveQuantity(li) > 0)
}

function articleLine(li) {
  const parts = [`${effectiveQuantity(li)}× ${li.title}`]
  if (li.variantTitle) parts.push(`/ ${li.variantTitle}`)
  return parts.join(' ')
}

function productsSummary(items) {
  return items.map((li) => `${effectiveQuantity(li)}× ${li.title}`).join(', ')
}

function SubBranch() {
  return (
    <svg
      className="reception-suboption__branch"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 2 L 7 8 L 13 8" />
    </svg>
  )
}

export default function Receptions() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('intercommerce')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [pending, setPending] = useState(null) // 'adjust' | 'markReady' | null
  const [feedback, setFeedback] = useState(null) // { type, message }
  const [zoneEditing, setZoneEditing] = useState(null) // order being edited
  const [addressViewing, setAddressViewing] = useState(null) // order whose address is shown

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
        for (const li of activeLineItems(o)) {
          if (li.variant?.inventoryItem?.id) {
            items.push({
              inventoryItemId: li.variant.inventoryItem.id,
              delta: effectiveQuantity(li),
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

      <div className="reception__body">
      <div className="reception__panes">
        {/* ---------- Left: reception cart ---------- */}
        <aside className="reception__left">
          <div className="reception__pane-label reception__pane-label--left">Liste de commandes réceptionnées</div>

          <div className="reception-cart">
            <table className="reception-cart__table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Produit</th>
                  <th aria-label="action">
                    {selectedOrders.length > 2 && (
                      <button
                        type="button"
                        className="reception-cart__clear"
                        onClick={() => setSelectedIds(new Set())}
                        title="Tout retirer"
                      >
                        −
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedOrders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="reception-cart__empty">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7" />
                      </svg>
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
                      {(() => {
                        const out = []
                        activeLineItems(o).forEach((li, idx) => {
                          const hasImage = !!li.image?.url
                          const lineAmount = Number(
                            li.discountedTotalSet?.shopMoney?.amount || 0
                          )
                          const isSubLine = !hasImage && lineAmount < 590
                          const wrong =
                            !!activeDef.vendor &&
                            !!li.vendor &&
                            li.vendor !== activeDef.vendor
                          if (wrong) {
                            out.push(
                              <div
                                className="reception-cart__product is-wrong-vendor"
                                key={`l-${idx}`}
                              >
                                <span className="reception-qty">
                                  {effectiveQuantity(li)}×
                                </span>
                                <span className="reception-wrong-vendor">
                                  ⚠️ {li.title}
                                  {li.vendor ? ` (${li.vendor})` : ''}
                                </span>
                              </div>
                            )
                            return
                          }
                          if (isSubLine) {
                            out.push(
                              <div
                                className="reception-cart__product is-sub"
                                key={`l-${idx}`}
                              >
                                <SubBranch />
                                <span className="reception-suboption__bubble">
                                  {li.title}
                                </span>
                              </div>
                            )
                          } else {
                            out.push(
                              <div
                                className="reception-cart__product"
                                key={`l-${idx}`}
                              >
                                <div className="reception-cart__product-main">
                                  <span className="reception-qty">
                                    {effectiveQuantity(li)}×
                                  </span>
                                  <span className="reception-article__title">
                                    {li.title}
                                  </span>
                                  {li.variantTitle &&
                                    !/texture/i.test(li.variantTitle) && (
                                      <span className="reception-article__variant">
                                        {li.variantTitle}
                                      </span>
                                    )}
                                </div>
                                {(li.sku || li.variant?.sku) && (
                                  <div className="reception-cart__sku">
                                    <span>{li.sku || li.variant?.sku}</span>
                                  </div>
                                )}
                              </div>
                            )
                          }
                          for (const attr of li.customAttributes || []) {
                            if (!attr.key || attr.key.startsWith('_')) continue
                            if (!attr.value) continue
                            out.push(
                              <div
                                className="reception-cart__product is-sub"
                                key={`a-${idx}-${attr.key}`}
                              >
                                <SubBranch />
                                <span className="reception-suboption__bubble">
                                  {attr.key}: {attr.value}
                                </span>
                              </div>
                            )
                          }
                        })
                        return out
                      })()}
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
                {selectedOrders.length} sélectionnée
                {selectedOrders.length > 1 ? 's' : ''}
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
            {activeDef.id === 'stock'
              ? 'Commandes à valider'
              : 'Commandes à réceptionner du fournisseur'}
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
                    <th aria-label="image" />
                    <th>Produit</th>
                    <th>N°</th>
                    <th>Zone</th>
                    <th>Ville</th>
                    <th>Client</th>
                    <th>Attente</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="reception-table__empty">
                        Aucune commande dans cet onglet.
                      </td>
                    </tr>
                  )}
                  {filtered.flatMap((o) => {
                    const zone = extractZone(o)
                    const isSelected = selectedIds.has(o.id)
                    const items = activeLineItems(o)
                    if (items.length === 0) return []

                    // Build a flat list of rows: each line item, followed by
                    // its visible custom attributes (which render like a
                    // separate sub-line / cheap unimaged line item).
                    const rows = []
                    items.forEach((li) => {
                      const wrong =
                        !!activeDef.vendor &&
                        !!li.vendor &&
                        li.vendor !== activeDef.vendor
                      rows.push({ kind: 'line', li, wrong })
                      if (wrong) return
                      for (const attr of li.customAttributes || []) {
                        if (!attr.key || attr.key.startsWith('_')) continue
                        if (!attr.value) continue
                        rows.push({ kind: 'attr', attr })
                      }
                    })
                    const span = rows.length

                    const isSubRow = (r) => {
                      if (!r) return false
                      if (r.kind === 'attr') return true
                      const x = r.li
                      const amt = Number(
                        x?.discountedTotalSet?.shopMoney?.amount || 0
                      )
                      return !!x && !x.image?.url && amt < 590
                    }
                    return rows.map((row, idx) => {
                      const isFirst = idx === 0
                      const isLast = idx === span - 1
                      const li = row.kind === 'line' ? row.li : null
                      const hasImage = !!li?.image?.url
                      const lineAmount = li
                        ? Number(li.discountedTotalSet?.shopMoney?.amount || 0)
                        : 0
                      const isSubLine = isSubRow(row)
                      const isWrongVendor = row.kind === 'line' && !!row.wrong
                      const nudgeImage =
                        row.kind === 'line' &&
                        hasImage &&
                        !isWrongVendor &&
                        isSubRow(rows[idx + 1])
                      const rowCls = [
                        isSelected ? 'is-selected' : '',
                        span > 1 && !isLast ? 'is-row-mid' : '',
                        span > 1 && !isFirst ? 'is-row-cont' : '',
                        isSubLine && !isWrongVendor ? 'is-row-sub' : '',
                        isSubLine && isLast && !isWrongVendor
                          ? 'is-row-sub--last'
                          : '',
                        isWrongVendor ? 'is-row-wrong-vendor' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <tr key={`${o.id}-${idx}`} className={rowCls}>
                          {isFirst && (
                            <td rowSpan={span}>
                              <button
                                type="button"
                                className="reception-action"
                                onClick={() => addToCart(o.id)}
                                disabled={isSelected}
                                title={
                                  isSelected
                                    ? 'Déjà ajoutée'
                                    : 'Ajouter au panier'
                                }
                              >
                                +
                              </button>
                            </td>
                          )}
                          <td className="reception-img-cell">
                            {row.kind === 'line' && hasImage ? (
                              <img
                                src={li.image.url}
                                alt={li.image.altText || li.title}
                                className={
                                  'reception-thumb' +
                                  (nudgeImage ? ' is-nudged' : '')
                                }
                              />
                            ) : isSubLine ? null : row.kind === 'line' ? (
                              <div
                                className="reception-thumb reception-thumb--placeholder"
                                aria-hidden="true"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  strokeLinejoin="round"
                                  strokeLinecap="round"
                                >
                                  <path
                                    d="M12 3 L3 8 L12 13 L21 8 Z"
                                    fill="#d8d8de"
                                    stroke="#9a9aa3"
                                    strokeWidth="0.9"
                                  />
                                  <path
                                    d="M3 8 L3 17 L12 22 L12 13 Z"
                                    fill="#b3b3bd"
                                    stroke="#9a9aa3"
                                    strokeWidth="0.9"
                                  />
                                  <path
                                    d="M21 8 L21 17 L12 22 L12 13 Z"
                                    fill="#909099"
                                    stroke="#9a9aa3"
                                    strokeWidth="0.9"
                                  />
                                </svg>
                              </div>
                            ) : null}
                          </td>
                          <td className="reception-articles">
                            {isWrongVendor ? (
                              <>
                                <span className="reception-qty">
                                  {effectiveQuantity(li)}×
                                </span>
                                <span className="reception-wrong-vendor">
                                  ⚠️ {li.title}
                                  {li.vendor ? ` (${li.vendor})` : ''}
                                </span>
                              </>
                            ) : isSubLine ? (
                              <span className="reception-suboption">
                                <SubBranch />
                                <span className="reception-suboption__bubble">
                                  {row.kind === 'attr'
                                    ? `${row.attr.key}: ${row.attr.value}`
                                    : li.title}
                                </span>
                              </span>
                            ) : (
                              <>
                                <span className="reception-qty">
                                  {effectiveQuantity(li)}×
                                </span>
                                <span className="reception-article__title">
                                  {li.title}
                                </span>
                                {li.variantTitle &&
                                  !/texture/i.test(li.variantTitle) && (
                                    <span className="reception-article__variant">
                                      {li.variantTitle}
                                    </span>
                                  )}
                              </>
                            )}
                          </td>
                          {isFirst && (
                            <td className="reception-num" rowSpan={span}>
                              {o.adminUrl ? (
                                <a
                                  href={o.adminUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="reception-num__link"
                                  title="Ouvrir dans Shopify Admin"
                                >
                                  <span className="reception-num__icon-wrap">
                                    <img
                                      src="/shopify-icon.png"
                                      alt=""
                                      aria-hidden="true"
                                      className="reception-num__icon"
                                    />
                                  </span>
                                  {o.name.replace(/^#/, '')}
                                </a>
                              ) : (
                                o.name.replace(/^#/, '')
                              )}
                            </td>
                          )}
                          {isFirst && (
                            <td rowSpan={span}>
                              <button
                                type="button"
                                className={
                                  'zone-badge zone-badge--button' +
                                  (!zone ? ' zone-badge--undefined' : '') +
                                  (zone && /^LIV/i.test(zone)
                                    ? ' zone-badge--external'
                                    : '')
                                }
                                onClick={() => setZoneEditing(o)}
                                title="Changer la zone"
                              >
                                {zone ? (
                                  /^LIV/i.test(zone) ? (
                                    'Externe'
                                  ) : (
                                    <>
                                      <ZoneFlag code={zoneCode(zone)} />
                                      {zone}
                                    </>
                                  )
                                ) : (
                                  'Non défini'
                                )}
                              </button>
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-meta" rowSpan={span}>
                              {o.shippingAddress?.city ? (
                                <button
                                  type="button"
                                  className="reception-meta__chip reception-meta__chip--button"
                                  onClick={() => setAddressViewing(o)}
                                  title="Voir l'adresse sur la carte"
                                >
                                  <span className="reception-meta__emoji">📍</span>
                                  {o.shippingAddress.city}
                                </button>
                              ) : (
                                <span className="reception-table__muted">—</span>
                              )}
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-meta" rowSpan={span}>
                              {customerName(o.customer) ? (
                                o.customer?.adminUrl ? (
                                  <a
                                    href={o.customer.adminUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="reception-meta__chip reception-meta__chip--client reception-meta__chip--link"
                                    title="Ouvrir la fiche client dans Shopify"
                                  >
                                    <span className="reception-meta__emoji">👤</span>
                                    {customerName(o.customer)}
                                  </a>
                                ) : (
                                  <span className="reception-meta__chip reception-meta__chip--client">
                                    <span className="reception-meta__emoji">👤</span>
                                    {customerName(o.customer)}
                                  </span>
                                )
                              ) : (
                                <span className="reception-table__muted">—</span>
                              )}
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-meta" rowSpan={span}>
                              <span className="reception-meta__chip reception-meta__chip--wait">
                                <span className="reception-meta__emoji">⏱️</span>
                                {daysSince(o.createdAt)} j
                              </span>
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-date" rowSpan={span}>
                              {formatDate(o.createdAt)}
                            </td>
                          )}
                        </tr>
                      )
                    })
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      </div>

      <ZoneModal
        open={!!zoneEditing}
        currentZone={zoneEditing ? extractZone(zoneEditing) : null}
        customerId={zoneEditing?.customer?.id || null}
        customerName={
          zoneEditing ? customerName(zoneEditing.customer) : null
        }
        address={zoneEditing?.shippingAddress || null}
        orderId={zoneEditing?.id || null}
        orderName={zoneEditing?.name || null}
        onClose={() => setZoneEditing(null)}
        onChanged={() => load()}
      />

      <AddressModal
        open={!!addressViewing}
        address={addressViewing?.shippingAddress || null}
        customerName={
          addressViewing ? customerName(addressViewing.customer) : null
        }
        orderName={addressViewing?.name || null}
        onClose={() => setAddressViewing(null)}
      />
    </div>
  )
}
