import { useCallback, useEffect, useMemo, useState } from 'react'
import { ZoneFlag, zoneCode } from '../components/ZoneFlag'
import ZoneModal from '../components/ZoneModal'
import AddressModal from '../components/AddressModal'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

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

function formatPrice(amount, currency = 'EUR') {
  const n = Number(amount)
  if (Number.isNaN(n)) return amount
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency }).format(
    n
  )
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

export default function Commandes() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [zoneEditing, setZoneEditing] = useState(null)
  const [addressViewing, setAddressViewing] = useState(null)

  const load = useCallback(() => {
    setOrders(null)
    setError(null)
    return fetch(
      '/api/shopify/receptions?q=' +
        encodeURIComponent(
          'created_at:>=2024-01-01 AND NOT financial_status:refunded'
        ) +
        '&first=100'
    )
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

  const sorted = useMemo(() => {
    if (!orders) return []
    return [...orders].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [orders])

  return (
    <div className="page reception">
      <div className="reception__body">
        <section className="reception__right">
          <div className="reception__pane-label reception__pane-label--right">
            Toutes les commandes
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
                    <th aria-label="image" />
                    <th>Produit</th>
                    <th>N°</th>
                    <th>Zone</th>
                    <th>Ville</th>
                    <th>Client</th>
                    <th>Attente</th>
                    <th>Date</th>
                    <th className="num">Total</th>
                    <th>Paiement</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={10} className="reception-table__empty">
                        Aucune commande.
                      </td>
                    </tr>
                  )}
                  {sorted.flatMap((o) => {
                    const zone = extractZone(o)
                    const items = activeLineItems(o)
                    if (items.length === 0) return []

                    const rows = []
                    items.forEach((li) => {
                      rows.push({ kind: 'line', li })
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
                      const isSubLine = isSubRow(row)
                      const nudgeImage =
                        row.kind === 'line' &&
                        hasImage &&
                        isSubRow(rows[idx + 1])
                      const rowCls = [
                        span > 1 && !isLast ? 'is-row-mid' : '',
                        span > 1 && !isFirst ? 'is-row-cont' : '',
                        isSubLine ? 'is-row-sub' : '',
                        isSubLine && isLast ? 'is-row-sub--last' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')

                      return (
                        <tr key={`${o.id}-${idx}`} className={rowCls}>
                          <td className="reception-img-cell">
                            {hasImage ? (
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
                            {isSubLine ? (
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
                          {isFirst && (
                            <td className="num" rowSpan={span}>
                              {formatPrice(o.total, o.currency)}
                            </td>
                          )}
                          {isFirst && (
                            <td rowSpan={span}>
                              <span
                                className={`badge badge--${(
                                  o.financialStatus || ''
                                ).toLowerCase()}`}
                              >
                                {(o.financialStatus || '—').toUpperCase()}
                              </span>
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
