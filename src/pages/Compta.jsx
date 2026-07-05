import { useCallback, useEffect, useMemo, useState } from 'react'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'
import { fetchDepositOrderNumbers } from '../lib/depositSync'

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

// Line item « tissu personnalisé » : repéré par le titre (insensible à la
// casse), pas la variante. Masqué partout et son montant est retranché du
// total de la commande, comme s'il n'avait pas été ajouté.
function isTissuLineItem(li) {
  return /tissu/i.test(li.title || '')
}

// Line items affichés : actifs, hors tissu personnalisé.
function visibleLineItems(order) {
  return activeLineItems(order).filter((li) => !isTissuLineItem(li))
}

// Total de la commande hors line items tissu personnalisé.
function orderDisplayTotal(o) {
  const gross = Number(o.total) || 0
  const tissu = activeLineItems(o)
    .filter(isTissuLineItem)
    .reduce((s, li) => {
      const n = parseFloat(li.discountedTotalSet?.shopMoney?.amount)
      return s + (Number.isFinite(n) ? n : 0)
    }, 0)
  return Math.max(0, gross - tissu)
}

function shortAddress(addr) {
  if (!addr) return '—'
  const line = [addr.address1, addr.zip, addr.city, addr.country]
    .filter(Boolean)
    .join(', ')
  return line || '—'
}

function csvEscape(v) {
  const s = String(v ?? '')
  if (/[";\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function buildCsv(orders) {
  const headers = [
    'Date',
    'Numéro',
    'Montant',
    'Devise',
    'Client',
    'Articles',
    'Paiement',
    'Adresse',
    'Complément',
    'Code postal',
    'Ville',
    'Pays',
  ]
  const rows = orders.map((o) => {
    const a = o.shippingAddress || {}
    return [
      formatDate(o.createdAt),
      o.name,
      orderDisplayTotal(o)
        .toFixed(2)
        .replace('.', ','),
      o.currency || 'EUR',
      customerName(o.customer),
      visibleLineItems(o)
        .map((li) => `${effectiveQuantity(li)}× ${li.title}`)
        .join(' | '),
      o.financialStatus || '',
      a.address1 || '',
      a.address2 || '',
      a.zip || '',
      a.city || '',
      a.country || '',
    ]
  })
  return [headers, ...rows]
    .map((r) => r.map(csvEscape).join(';'))
    .join('\r\n')
}

function downloadCsv(filename, csv) {
  // BOM so Excel opens UTF-8 cleanly
  const blob = new Blob(['﻿' + csv], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const PAYMENT_FILTERS = [
  { id: 'all', label: 'Toutes les commandes' },
  { id: 'full', label: 'Paiement complet en ligne' },
  { id: 'acompte', label: 'A eu un acompte (paiements)' },
]

function hasDepoTag(o) {
  return (o.tags || []).some((t) => /^depo$/i.test(t))
}

// Commande ne contenant QUE des échantillons de textile (aucun vrai produit) :
// exclue du filtre « Paiement complet en ligne ».
function isSamplesOnly(o) {
  const items = activeLineItems(o)
  if (items.length === 0) return false
  return items.every((li) =>
    /échantillons?\s+de\s+textile/i.test(
      (li.title || '').normalize('NFC')
    )
  )
}

// « A eu un acompte » s'appuie sur le cache deposit_orders (rempli au
// chargement du hub, cf. lib/depositSync), donc on ne recharge/recalcule plus
// les transactions ici : simple test d'appartenance par numéro de commande.
function matchPaymentFilter(o, filterId, depositSet) {
  if (filterId === 'full') return !hasDepoTag(o) && !isSamplesOnly(o)
  if (filterId === 'acompte') return depositSet.has(o.name)
  return true
}

export default function Compta() {
  const months = useMemo(buildMonths, [])
  const [activeIdx, setActiveIdx] = useState(0)
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [ordersByMonth, setOrdersByMonth] = useState({}) // {idx: orders[]}
  const [loadingIdx, setLoadingIdx] = useState(null)
  const [error, setError] = useState(null)
  const [depositSet, setDepositSet] = useState(() => new Set())
  const { reloadKey } = useReload()

  // Numéros de commande ayant eu un acompte, depuis le cache deposit_orders
  // (rempli au chargement du hub). Rechargé à chaque rafraîchissement.
  useEffect(() => {
    let alive = true
    fetchDepositOrderNumbers().then((set) => {
      if (alive) setDepositSet(set)
    })
    return () => {
      alive = false
    }
  }, [reloadKey])

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
      full: sortedAll.filter((o) => !hasDepoTag(o) && !isSamplesOnly(o)).length,
      acompte: sortedAll.filter((o) => depositSet.has(o.name)).length,
    }),
    [sortedAll, depositSet]
  )

  const sorted = useMemo(
    () =>
      sortedAll.filter((o) => matchPaymentFilter(o, paymentFilter, depositSet)),
    [sortedAll, paymentFilter, depositSet]
  )

  const total = useMemo(
    () => sorted.reduce((s, o) => s + orderDisplayTotal(o), 0),
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
              'compta__subtab compta__subtab--' +
              f.id +
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
              <div className="compta__summary-left">
                <span>
                  <strong>{sorted.length}</strong> commande
                  {sorted.length > 1 ? 's' : ''}
                </span>
                <span>
                  Total <strong>{formatPrice(total)}</strong>
                </span>
              </div>
              {paymentFilter === 'full' && sorted.length > 0 && (
                <button
                  type="button"
                  className="compta__export"
                  onClick={() => {
                    const m = months[activeIdx]
                    const slug = m.label
                      .toLowerCase()
                      .normalize('NFD')
                      .replace(/[̀-ͯ]/g, '')
                      .replace(/\s+/g, '-')
                    downloadCsv(
                      `compta-paiement-complet-${slug}.csv`,
                      buildCsv(sorted)
                    )
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Exporter en CSV
                </button>
              )}
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
                  const items = visibleLineItems(o)
                  return (
                    <tr key={o.id}>
                      <td className="reception-date">
                        {formatDate(o.createdAt)}
                      </td>
                      <td className="num">
                        {formatPrice(orderDisplayTotal(o), o.currency)}
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
