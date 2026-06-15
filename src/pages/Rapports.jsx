import { useCallback, useEffect, useMemo, useState } from 'react'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

const RANGES = [
  { id: 365, label: '365 jours' },
  { id: 90, label: '90 jours' },
  { id: 30, label: '30 jours' },
]

const VENTES_TABS = [
  { id: 'qty', label: 'Par produit' },
  { id: 'rev', label: 'Par chiffre d’affaires' },
]

const MAX_PAGES = 12

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatPrice(amount, currency = 'EUR', frac = 0) {
  const n = Number(amount)
  if (Number.isNaN(n)) return amount
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency',
    currency,
    maximumFractionDigits: frac,
  }).format(n)
}

function effectiveQuantity(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

async function fetchAllPaged(buildUrl, key) {
  const all = []
  let after = null
  let pages = 0
  let truncated = false
  while (pages < MAX_PAGES) {
    const r = await fetch(buildUrl(after))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    all.push(...(data[key] || []))
    pages += 1
    const info = data.pageInfo
    if (!info?.hasNextPage) break
    after = info.endCursor
    if (pages === MAX_PAGES) truncated = true
  }
  return { items: all, pages, truncated }
}

/* ============================================================ */
/*  Sub-page: Meilleures ventes                                 */
/* ============================================================ */
function MeilleuresVentes() {
  const [days, setDays] = useState(365)
  const [tab, setTab] = useState('qty')
  const [orders, setOrders] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ pages: 0, truncated: false })
  const { reloadKey } = useReload()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setOrders(null)
    try {
      const since = ymd(new Date(Date.now() - days * 86400000))
      const q = `created_at:>=${since} AND NOT tag:removed AND NOT financial_status:refunded AND NOT financial_status:partially_refunded AND total_price:>0`
      const { items, pages, truncated } = await fetchAllPaged(
        (after) =>
          '/api/shopify/receptions?q=' +
          encodeURIComponent(q) +
          '&first=250' +
          (after ? '&after=' + encodeURIComponent(after) : ''),
        'orders'
      )
      setOrders(items)
      setStats({ pages, truncated })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const variants = useMemo(() => {
    if (!orders) return []
    const map = new Map()
    for (const o of orders) {
      for (const li of o.lineItems || []) {
        const qty = effectiveQuantity(li)
        if (qty <= 0) continue
        const vId = li.variant?.id || li.sku || `${o.id}-${li.title}`
        const existing = map.get(vId) || {
          key: vId,
          sku: li.variant?.sku || li.sku || '',
          title: li.title || '',
          variantTitle: li.variantTitle || '',
          imageUrl: li.image?.url || '',
          qty: 0,
          revenue: 0,
          currency: 'EUR',
        }
        existing.qty += qty
        const lineRevenue = Number(
          li.discountedTotalSet?.shopMoney?.amount ||
            (li.originalUnitPriceSet?.shopMoney?.amount || 0) * qty
        )
        if (!Number.isNaN(lineRevenue)) existing.revenue += lineRevenue
        existing.currency =
          li.discountedTotalSet?.shopMoney?.currencyCode ||
          li.originalUnitPriceSet?.shopMoney?.currencyCode ||
          o.currency ||
          existing.currency
        if (!existing.imageUrl && li.image?.url) existing.imageUrl = li.image.url
        map.set(vId, existing)
      }
    }
    const rows = [...map.values()]
    rows.sort((a, b) => (tab === 'qty' ? b.qty - a.qty : b.revenue - a.revenue))
    return rows
  }, [orders, tab])

  return (
    <>
      <div className="rapports__toolbar">
        <div className="rapports__range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={
                'rapports__chip' + (days === r.id ? ' is-active' : '')
              }
              onClick={() => setDays(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="rapports__tabs" role="tablist">
          {VENTES_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={
                'rapports__tab' + (tab === t.id ? ' is-active' : '')
              }
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}
      {loading && (
        <OrdersTableSkeleton columns={4} rows={10} hasImageCol />
      )}

      {!loading && orders && (
        <>
          <div className="rapports__summary">
            <span>
              <strong>{variants.length}</strong> variante
              {variants.length > 1 ? 's' : ''} vendue
              {variants.length > 1 ? 's' : ''}
            </span>
            <span>
              <strong>{orders.length}</strong> commande
              {orders.length > 1 ? 's' : ''} analysée
              {orders.length > 1 ? 's' : ''}
              {stats.truncated && ' (limité)'}
            </span>
          </div>

          <div className="compta-table-wrap">
            <table className="compta-table rapports-table">
              <thead>
                <tr>
                  <th className="rapports-table__rank">#</th>
                  <th aria-label="photo" />
                  <th>Variante</th>
                  <th>SKU</th>
                  <th className="num">
                    {tab === 'qty' ? 'Ventes' : 'CA'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="reception-table__empty">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {variants.map((v, i) => (
                  <tr key={v.key}>
                    <td className="rapports-table__rank">{i + 1}</td>
                    <td className="rapports-table__img">
                      {v.imageUrl ? (
                        <img
                          src={v.imageUrl}
                          alt=""
                          className="rapports-table__thumb"
                        />
                      ) : (
                        <div
                          className="rapports-table__thumb rapports-table__thumb--empty"
                          aria-hidden="true"
                        />
                      )}
                    </td>
                    <td>
                      <div className="rapports-table__title">{v.title}</div>
                      {v.variantTitle && (
                        <div className="rapports-table__variant">
                          {v.variantTitle}
                        </div>
                      )}
                    </td>
                    <td className="rapports-table__sku">
                      {v.sku || (
                        <span className="reception-table__muted">—</span>
                      )}
                    </td>
                    <td className="num rapports-table__value">
                      {tab === 'qty'
                        ? v.qty
                        : formatPrice(v.revenue, v.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/* ============================================================ */
/*  Main page                                                   */
/* ============================================================ */
export default function Rapports() {
  return (
    <div className="page rapports">
      <header className="rapports__head">
        <h1 className="rapports__title">Rapports</h1>
      </header>

      <section className="rapports__panel">
        <MeilleuresVentes />
      </section>
    </div>
  )
}
