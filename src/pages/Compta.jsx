import { useCallback, useEffect, useMemo, useState } from 'react'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function monthLabel(d) {
  return `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`
}

function buildMonths() {
  const now = new Date()
  const arr = []
  for (let i = 0; i < 5; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    arr.push({
      id: `m-${i}`,
      label: monthLabel(start),
      start,
      end,
    })
  }
  return arr
}

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatPrice(amount, currency = 'EUR') {
  const n = Number(amount)
  if (Number.isNaN(n)) return amount
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency',
    currency,
  }).format(n)
}

function customerName(c) {
  if (!c) return ''
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
}

function effectiveQuantity(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

function activeLineItems(order) {
  return (order.lineItems || []).filter((li) => effectiveQuantity(li) > 0)
}

function shortAddress(addr) {
  if (!addr) return '—'
  const line = [addr.address1, addr.zip, addr.city, addr.country]
    .filter(Boolean)
    .join(', ')
  return line || '—'
}

const PAYMENT_FILTERS = [
  { id: 'all', label: 'Toutes les commandes' },
  { id: 'full', label: 'Paiement complet en ligne' },
  { id: 'depo', label: 'Acompte en ligne + solde cash' },
]

function hasDepoTag(o) {
  return (o.tags || []).some((t) => /^depo$/i.test(t))
}

function matchPaymentFilter(o, filterId) {
  if (filterId === 'full') return !hasDepoTag(o)
  if (filterId === 'depo') return hasDepoTag(o)
  return true
}

export default function Compta() {
  const months = useMemo(buildMonths, [])
  const [activeIdx, setActiveIdx] = useState(0)
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [ordersByMonth, setOrdersByMonth] = useState({}) // {idx: orders[]}
  const [loadingIdx, setLoadingIdx] = useState(null)
  const [error, setError] = useState(null)
  const { reloadKey } = useReload()

  const load = useCallback(
    async (idx) => {
      const m = months[idx]
      if (!m) return
      setLoadingIdx(idx)
      setError(null)
      try {
        const q = `created_at:>=${ymd(m.start)} AND created_at:<${ymd(m.end)} AND NOT tag:removed AND NOT financial_status:refunded AND NOT financial_status:partially_refunded`
        const r = await fetch(
          '/api/shopify/receptions?q=' +
            encodeURIComponent(q) +
            '&first=250'
        )
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setOrdersByMonth((prev) => ({ ...prev, [idx]: data.orders || [] }))
      } catch (e) {
        setError(e.message || String(e))
      } finally {
        setLoadingIdx(null)
      }
    },
    [months]
  )

  // Always load the active tab when it changes or on reload bump
  useEffect(() => {
    load(activeIdx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, reloadKey])

  // Invalidate cache on global reload
  useEffect(() => {
    if (reloadKey > 0) setOrdersByMonth({})
  }, [reloadKey])

  const orders = ordersByMonth[activeIdx]
  const isLoading = loadingIdx === activeIdx && !orders

  const sortedAll = useMemo(() => {
    if (!orders) return []
    return [...orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [orders])

  const counts = useMemo(
    () => ({
      all: sortedAll.length,
      full: sortedAll.filter((o) => !hasDepoTag(o)).length,
      depo: sortedAll.filter(hasDepoTag).length,
    }),
    [sortedAll]
  )

  const sorted = useMemo(
    () => sortedAll.filter((o) => matchPaymentFilter(o, paymentFilter)),
    [sortedAll, paymentFilter]
  )

  const total = useMemo(
    () => sorted.reduce((s, o) => s + (Number(o.total) || 0), 0),
    [sorted]
  )

  return (
    <div className="page compta">
      <header className="compta__head">
        <h1 className="compta__title">Comptabilité</h1>
      </header>

      <div className="compta__tabs" role="tablist">
        {months.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={i === activeIdx}
            className={
              'compta__tab' + (i === activeIdx ? ' is-active' : '')
            }
            onClick={() => setActiveIdx(i)}
          >
            {m.label}
            {i === 0 && (
              <span className="compta__tab-flag">Mois actuel</span>
            )}
          </button>
        ))}
      </div>

      <div className="compta__subtabs" role="tablist">
        {PAYMENT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={paymentFilter === f.id}
            className={
              'compta__subtab' +
              (paymentFilter === f.id ? ' is-active' : '')
            }
            onClick={() => setPaymentFilter(f.id)}
          >
            <span>{f.label}</span>
            <span className="compta__subtab-count">
              {orders ? counts[f.id] : '…'}
            </span>
          </button>
        ))}
      </div>

      <div className="compta__panel">
        {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}

        <div className="compta__summary">
          {orders && (
            <>
              <span>
                <strong>{sorted.length}</strong> commande
                {sorted.length > 1 ? 's' : ''}
              </span>
              <span>
                Total <strong>{formatPrice(total)}</strong>
              </span>
            </>
          )}
        </div>

        {isLoading && <OrdersTableSkeleton columns={6} rows={8} />}

        {orders && (
          <div className="compta-table-wrap">
            <table className="compta-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Montant</th>
                  <th>Client</th>
                  <th>Articles</th>
                  <th>Paiement</th>
                  <th>Adresse</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="reception-table__empty"
                    >
                      Aucune commande sur ce mois.
                    </td>
                  </tr>
                )}
                {sorted.map((o) => {
                  const items = activeLineItems(o)
                  return (
                    <tr key={o.id}>
                      <td className="reception-date">
                        {formatDate(o.createdAt)}
                      </td>
                      <td className="num">
                        {formatPrice(o.total, o.currency)}
                      </td>
                      <td>
                        {customerName(o.customer) ? (
                          o.customer?.adminUrl ? (
                            <a
                              href={o.customer.adminUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="compta__client"
                            >
                              {customerName(o.customer)}
                            </a>
                          ) : (
                            customerName(o.customer)
                          )
                        ) : (
                          <span className="reception-table__muted">
                            —
                          </span>
                        )}
                      </td>
                      <td className="compta__items">
                        {items.length === 0 ? (
                          <span className="reception-table__muted">
                            —
                          </span>
                        ) : (
                          <ul className="compta__items-list">
                            {items.map((li) => (
                              <li key={li.id}>
                                <span className="compta__qty">
                                  {effectiveQuantity(li)}×
                                </span>{' '}
                                {li.title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge badge--${(o.financialStatus || '').toLowerCase()}`}
                        >
                          {(o.financialStatus || '—').toUpperCase()}
                        </span>
                      </td>
                      <td className="compta__addr">
                        {shortAddress(o.shippingAddress)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
