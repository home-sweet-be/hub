import { useCallback, useEffect, useMemo, useState } from 'react'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

const SUBPAGES = [
  { id: 'ventes', label: 'Meilleures ventes' },
  { id: 'marges', label: 'Calculateur de marge' },
]

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
/*  Sub-page: Calculateur de marge                              */
/* ============================================================ */
const VAT_RATE = 0.21

function MargeBadge({ pct }) {
  const cls =
    pct >= 50 ? 'is-good' : pct >= 30 ? 'is-mid' : pct >= 10 ? 'is-low' : 'is-bad'
  return (
    <span className={'marge-badge ' + cls}>
      {Math.round(pct)}%
    </span>
  )
}

const MARGE_TABS = [
  { id: 'par-produit', label: 'Par produit' },
  { id: 'par-commande', label: 'Par commande' },
]

function CalculateurMarge() {
  const [products, setProducts] = useState(null)
  const [orders30, setOrders30] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fixedCosts, setFixedCosts] = useState(() => {
    const stored = localStorage.getItem('rapports.fixedCosts')
    return stored ? Number(stored) : 5000
  })
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('par-produit')
  const { reloadKey } = useReload()

  useEffect(() => {
    localStorage.setItem('rapports.fixedCosts', String(fixedCosts))
  }, [fixedCosts])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const since = ymd(new Date(Date.now() - 30 * 86400000))
      const q = `created_at:>=${since} AND NOT tag:removed AND NOT financial_status:refunded AND NOT financial_status:partially_refunded AND total_price:>0`
      const [prodRes, ordRes] = await Promise.all([
        fetchAllPaged(
          (after) =>
            '/api/shopify/products?first=250' +
            (after ? '&after=' + encodeURIComponent(after) : ''),
          'products'
        ),
        fetchAllPaged(
          (after) =>
            '/api/shopify/receptions?q=' +
            encodeURIComponent(q) +
            '&first=250' +
            (after ? '&after=' + encodeURIComponent(after) : ''),
          'orders'
        ),
      ])
      setProducts(prodRes.items)
      setOrders30(ordRes.items)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const nbCmd = orders30?.length || 0
  const nbUnits = useMemo(() => {
    if (!orders30) return 0
    let total = 0
    for (const o of orders30) {
      for (const li of o.lineItems || []) {
        total += effectiveQuantity(li)
      }
    }
    return total
  }, [orders30])

  const safeNbCmd = nbCmd > 0 ? nbCmd : 60
  const safeNbUnits = nbUnits > 0 ? nbUnits : 60
  const fraisParUnite = fixedCosts > 0 ? fixedCosts / safeNbUnits : 0
  const fraisParCmd = fixedCosts > 0 ? fixedCosts / safeNbCmd : 0

  const rowsProduit = useMemo(() => {
    if (!products || tab !== 'par-produit') return []
    const term = search.trim().toLowerCase()
    return products
      .filter((p) => p.variant && p.variant.price > 0)
      .map((p) => {
        const v = p.variant
        const priceTtc = v.price
        const costHt = v.costHt
        const priceHt = priceTtc / (1 + VAT_RATE)
        const margeTtc = priceTtc - costHt
        const margeTtcPct = priceTtc > 0 ? (margeTtc / priceTtc) * 100 : 0
        const margeHt = priceHt - costHt
        const margeHtPct = priceHt > 0 ? (margeHt / priceHt) * 100 : 0
        const margePropre = margeHt - fraisParUnite
        const margeProprePct =
          priceHt > 0 ? (margePropre / priceHt) * 100 : 0
        const margePlNet = margeTtc - fraisParUnite
        const margePlNetPct =
          priceTtc > 0 ? (margePlNet / priceTtc) * 100 : 0
        return {
          ...p,
          priceTtc,
          costHt,
          priceHt,
          margeTtc,
          margeTtcPct,
          margeHt,
          margeHtPct,
          margePropre,
          margeProprePct,
          margePlNet,
          margePlNetPct,
        }
      })
      .filter((r) => {
        if (!term) return true
        return (
          r.title.toLowerCase().includes(term) ||
          (r.variant?.sku || '').toLowerCase().includes(term)
        )
      })
      .sort((a, b) => b.margeProprePct - a.margeProprePct)
  }, [products, search, fraisParUnite, tab])

  const rowsCommande = useMemo(() => {
    if (!orders30 || tab !== 'par-commande') return []
    const term = search.trim().toLowerCase()
    return orders30
      .map((o) => {
        const items = (o.lineItems || []).filter(
          (li) => effectiveQuantity(li) > 0
        )
        let totalHt = 0
        let totalCostHt = 0
        for (const li of items) {
          const qty = effectiveQuantity(li)
          const lineTtc = Number(
            li.discountedTotalSet?.shopMoney?.amount ||
              (li.originalUnitPriceSet?.shopMoney?.amount || 0) * qty
          )
          totalHt += (lineTtc || 0) / (1 + VAT_RATE)
          const unitCost = Number(li.variant?.inventoryItem?.unitCost?.amount) || 0
          totalCostHt += unitCost * qty
        }
        const priceTtc = Number(o.total) || 0
        const priceHt = priceTtc / (1 + VAT_RATE)
        const costHt = totalCostHt
        const margeTtc = priceTtc - costHt
        const margeTtcPct = priceTtc > 0 ? (margeTtc / priceTtc) * 100 : 0
        const margeHt = priceHt - costHt
        const margeHtPct = priceHt > 0 ? (margeHt / priceHt) * 100 : 0
        const margePropre = margeHt - fraisParCmd
        const margeProprePct =
          priceHt > 0 ? (margePropre / priceHt) * 100 : 0
        const margePlNet = margeTtc - fraisParCmd
        const margePlNetPct =
          priceTtc > 0 ? (margePlNet / priceTtc) * 100 : 0
        const articles = items
          .map((li) => {
            const q = effectiveQuantity(li)
            return q > 1 ? `${li.title} ×${q}` : li.title
          })
          .join(', ')
        const customerName =
          [o.customer?.firstName, o.customer?.lastName]
            .filter(Boolean)
            .join(' ') || ''
        return {
          id: o.id,
          name: o.name,
          createdAt: o.createdAt,
          customerName,
          adminUrl: o.adminUrl,
          articles,
          items,
          priceTtc,
          priceHt,
          costHt,
          margeTtc,
          margeTtcPct,
          margeHt,
          margeHtPct,
          margePropre,
          margeProprePct,
          margePlNet,
          margePlNetPct,
          hasCost: costHt > 0,
        }
      })
      .filter((r) => {
        if (!term) return true
        return (
          (r.name || '').toLowerCase().includes(term) ||
          (r.customerName || '').toLowerCase().includes(term) ||
          (r.articles || '').toLowerCase().includes(term)
        )
      })
      .sort((a, b) => b.margeProprePct - a.margeProprePct)
  }, [orders30, search, fraisParCmd, tab])

  const isProduit = tab === 'par-produit'
  const divisor = isProduit ? safeNbUnits : safeNbCmd
  const divisorReel = isProduit ? nbUnits : nbCmd
  const fraisPar = isProduit ? fraisParUnite : fraisParCmd
  const divisorLabel = isProduit
    ? 'Produits vendus (30 j)'
    : 'Commandes (30 j)'
  const fraisLabel = isProduit ? 'Frais fixes par produit' : 'Frais fixes par commande'

  const muted = <span className="reception-table__muted">—</span>

  return (
    <>
      <div className="rapports__tabs marge__tabs" role="tablist">
        {MARGE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={'rapports__tab' + (tab === t.id ? ' is-active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="marge__controls">
        <label className="marge__field">
          <span>Frais fixes (€ / 30 jours)</span>
          <input
            type="number"
            value={fixedCosts}
            min={0}
            step={100}
            onChange={(e) => setFixedCosts(Number(e.target.value) || 0)}
          />
        </label>
        <div className="marge__field marge__field--readonly">
          <span>{divisorLabel}</span>
          <div className="marge__val">
            <strong>{divisorReel || '—'}</strong>
            {divisorReel === 0 && (
              <span className="marge__val-hint">fallback 60</span>
            )}
          </div>
        </div>
        <div className="marge__field marge__field--readonly">
          <span>{fraisLabel}</span>
          <div className="marge__val">
            <strong>{formatPrice(fraisPar, 'EUR', 2)}</strong>
            <span className="marge__val-hint">
              {formatPrice(fixedCosts, 'EUR', 0)} / {divisor}
            </span>
          </div>
        </div>
        <label className="marge__field marge__field--search">
          <span>Recherche</span>
          <input
            type="search"
            placeholder={
              isProduit ? 'Bellagio, COBRA…' : 'N°, client, article…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}
      {loading && <OrdersTableSkeleton columns={6} rows={10} hasImageCol />}

      {!loading && isProduit && products && (
        <div className="compta-table-wrap">
          <table className="compta-table rapports-table marge-table">
            <thead>
              <tr>
                <th aria-label="photo" />
                <th>Produit</th>
                <th>SKU</th>
                <th className="num">Prix TTC</th>
                <th className="num">Montant HT</th>
                <th className="num">Coût HT</th>
                <th className="num">Marge HT</th>
                <th className="num">Marge nette</th>
                <th className="num marge-table__divider">Marge PL</th>
                <th className="num">Marge PL nette</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rowsProduit.length === 0 && (
                <tr>
                  <td colSpan={11} className="reception-table__empty">
                    {search
                      ? 'Aucun produit ne correspond à la recherche.'
                      : 'Aucun produit avec coût HT renseigné.'}
                  </td>
                </tr>
              )}
              {rowsProduit.map((r) => {
                const has = r.costHt > 0
                return (
                  <tr key={r.id}>
                    <td className="rapports-table__img">
                      {r.imageUrl ? (
                        <img
                          src={r.imageUrl}
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
                      <div className="rapports-table__title">{r.title}</div>
                    </td>
                    <td className="rapports-table__sku">
                      {r.variant.sku || muted}
                    </td>
                    <td className="num">{formatPrice(r.priceTtc)}</td>
                    <td className="num">{formatPrice(r.priceHt)}</td>
                    <td className="num">{has ? formatPrice(r.costHt) : muted}</td>
                    <td className="num marge-table__cell">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margeHt)}</div>
                          <MargeBadge pct={r.margeHtPct} />
                        </>
                      ) : muted}
                    </td>
                    <td className="num marge-table__cell">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margePropre)}</div>
                          <MargeBadge pct={r.margeProprePct} />
                        </>
                      ) : muted}
                    </td>
                    <td className="num marge-table__cell marge-table__divider">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margeTtc)}</div>
                          <MargeBadge pct={r.margeTtcPct} />
                        </>
                      ) : muted}
                    </td>
                    <td className="num marge-table__cell">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margePlNet)}</div>
                          <MargeBadge pct={r.margePlNetPct} />
                        </>
                      ) : muted}
                    </td>
                    <td>
                      {r.bulkEditUrl && (
                        <a
                          href={r.bulkEditUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="marge-table__edit"
                          title="Modifier le coût HT dans Shopify"
                        >
                          ✎
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !isProduit && orders30 && (
        <div className="compta-table-wrap">
          <table className="compta-table rapports-table marge-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>N°</th>
                <th>Client</th>
                <th>Articles</th>
                <th className="num">Total TTC</th>
                <th className="num">Total HT</th>
                <th className="num">Coût HT</th>
                <th className="num">Marge HT</th>
                <th className="num">Marge nette</th>
                <th className="num marge-table__divider">Marge PL</th>
                <th className="num">Marge PL nette</th>
              </tr>
            </thead>
            <tbody>
              {rowsCommande.length === 0 && (
                <tr>
                  <td colSpan={11} className="reception-table__empty">
                    {search
                      ? 'Aucune commande ne correspond à la recherche.'
                      : 'Aucune commande sur les 30 derniers jours.'}
                  </td>
                </tr>
              )}
              {rowsCommande.map((r) => {
                const has = r.hasCost
                const date = r.createdAt
                  ? new Date(r.createdAt).toLocaleDateString('fr-BE', {
                      day: '2-digit',
                      month: '2-digit',
                    })
                  : '—'
                return (
                  <tr key={r.id}>
                    <td>{date}</td>
                    <td>
                      {r.adminUrl ? (
                        <a
                          href={r.adminUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="marge-table__order-link"
                        >
                          {r.name}
                        </a>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td>{r.customerName || muted}</td>
                    <td className="marge-table__articles">
                      {r.articles || muted}
                    </td>
                    <td className="num">{formatPrice(r.priceTtc)}</td>
                    <td className="num">{formatPrice(r.priceHt)}</td>
                    <td className="num">{has ? formatPrice(r.costHt) : muted}</td>
                    <td className="num marge-table__cell">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margeHt)}</div>
                          <MargeBadge pct={r.margeHtPct} />
                        </>
                      ) : muted}
                    </td>
                    <td className="num marge-table__cell">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margePropre)}</div>
                          <MargeBadge pct={r.margeProprePct} />
                        </>
                      ) : muted}
                    </td>
                    <td className="num marge-table__cell marge-table__divider">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margeTtc)}</div>
                          <MargeBadge pct={r.margeTtcPct} />
                        </>
                      ) : muted}
                    </td>
                    <td className="num marge-table__cell">
                      {has ? (
                        <>
                          <div>{formatPrice(r.margePlNet)}</div>
                          <MargeBadge pct={r.margePlNetPct} />
                        </>
                      ) : muted}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ============================================================ */
/*  Main page                                                   */
/* ============================================================ */
export default function Rapports() {
  const [subpage, setSubpage] = useState('ventes')

  return (
    <div className="page rapports">
      <header className="rapports__head">
        <h1 className="rapports__title">Rapports</h1>
      </header>

      <nav className="rapports__subpages" aria-label="Sous-pages">
        {SUBPAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={
              'rapports__subpage' + (subpage === s.id ? ' is-active' : '')
            }
            onClick={() => setSubpage(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <section className="rapports__panel">
        {subpage === 'ventes' && <MeilleuresVentes />}
        {subpage === 'marges' && <CalculateurMarge />}
      </section>
    </div>
  )
}
