import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

const MONTHS_BACK = 12
const MAX_PAGES = 40
const VAT_RATE = 0.21
// Fallback when an order has neither a product cost nor a cout_backfill
// metafield: estimate COGS at 50% of the order's HT revenue.
const FALLBACK_COST_RATIO = 0.5

// Resolve an order's COGS (HT): metafield override > line-item cost > estimate.
function resolveOrderCogs({ costBackfill, lineCogs, revenueHt }) {
  if (costBackfill != null) return { cogs: costBackfill, source: 'backfill' }
  if (lineCogs > 0) return { cogs: lineCogs, source: 'product' }
  return { cogs: revenueHt * FALLBACK_COST_RATIO, source: 'estimate' }
}

const MONTH_LABELS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Key for a month = first day, e.g. "2026-06-01" (matches the DB `month` date).
function monthKeyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`
}

function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${MONTH_LABELS[Number(m) - 1]} ${y}`
}

function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatPrice(amount, frac = 0) {
  const n = Number(amount)
  if (Number.isNaN(n)) return amount
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: frac,
  }).format(n)
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function effectiveQuantity(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

function isSample(item) {
  return /[ée]chantillon/i.test(item?.title || '')
}

function pct(value, base) {
  return base > 0 ? (value / base) * 100 : 0
}

async function fetchAllPaged(buildUrl, key, maxPages = MAX_PAGES) {
  const all = []
  let after = null
  let pages = 0
  let truncated = false
  while (pages < maxPages) {
    const r = await fetch(buildUrl(after))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    all.push(...(data[key] || []))
    pages += 1
    const info = data.pageInfo
    if (!info?.hasNextPage) break
    after = info.endCursor
    if (pages === maxPages) truncated = true
  }
  return { items: all, truncated }
}

/* ============================================================ */
/*  Per-month cost editor (marketing value + fixed costs list)  */
/* ============================================================ */
function CostEditor({ monthKey, marketingRow, fixedRows, onPatch, onPersist, onAdd, onDelete }) {
  return (
    <div className="calrent__editor">
      <div className="calrent__editor-col">
        <div className="calrent__editor-title">Coûts marketing</div>
        <div className="calrent__cost-row calrent__cost-row--marketing">
          <span className="calrent__cost-label">📣 Meta</span>
          <div className="calrent__amount">
            <input
              type="number"
              min={0}
              step={50}
              value={marketingRow ? marketingRow.amount : 0}
              onChange={(e) =>
                marketingRow &&
                onPatch(marketingRow.id, { amount: Number(e.target.value) || 0 })
              }
              onBlur={(e) =>
                onPersist('marketing', monthKey, {
                  amount: Number(e.target.value) || 0,
                })
              }
            />
            <span className="calrent__amount-unit">€</span>
          </div>
        </div>
      </div>

      <div className="calrent__editor-col calrent__editor-col--fixed">
        <div className="calrent__editor-title">Frais fixes mensuels</div>
        {fixedRows.length === 0 && (
          <div className="calrent__cost-empty">Aucun frais fixe pour ce mois.</div>
        )}
        {fixedRows.map((f) => (
          <div key={f.id} className="calrent__cost-row">
            <input
              type="text"
              className="calrent__cost-label-input"
              placeholder="Libellé (ex. Loyer)"
              value={f.label}
              onChange={(e) => onPatch(f.id, { label: e.target.value })}
              onBlur={(e) => onPersist('fixed', f.id, { label: e.target.value })}
            />
            <div className="calrent__amount">
              <input
                type="number"
                min={0}
                step={50}
                value={f.amount}
                onChange={(e) =>
                  onPatch(f.id, { amount: Number(e.target.value) || 0 })
                }
                onBlur={(e) =>
                  onPersist('fixed', f.id, { amount: Number(e.target.value) || 0 })
                }
              />
              <span className="calrent__amount-unit">€</span>
            </div>
            <button
              type="button"
              className="calrent__cost-del"
              onClick={() => onDelete(f.id)}
              title="Supprimer ce coût"
              aria-label="Supprimer"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="calrent__add"
          onClick={() => onAdd(monthKey)}
        >
          + Ajouter un coût
        </button>
      </div>
    </div>
  )
}

/* ============================================================ */
/*  Per-month orders breakdown (control / reconciliation)       */
/*  Rendered as rows of the MAIN table so the CA HT / Coût      */
/*  march. / Marge brute columns line up with the month rows.   */
/* ============================================================ */
function OrdersBreakdownRows({ rows, monthKey }) {
  if (!rows.length) {
    return (
      <tr className="calrent-table__order-row">
        <td colSpan={8} className="calrent__detail-empty">
          Aucune commande ce mois-ci.
        </td>
      </tr>
    )
  }
  return rows.map((r) => (
    <tr key={`${monthKey}-${r.id}`} className="calrent-table__order-row">
      <td className="calrent-table__order-name">
        {r.adminUrl ? (
          <a href={r.adminUrl} target="_blank" rel="noopener noreferrer">
            {r.name}
          </a>
        ) : (
          r.name
        )}
        <span className="calrent-table__order-date">{formatDate(r.date)}</span>
      </td>
      <td className="num">{formatPrice(r.revenueHt)}</td>
      <td className="num">
        {formatPrice(r.cogs)}
        {r.costSource === 'backfill' && (
          <span
            className="calrent__detail-backfill"
            title="Coût saisi manuellement (métachamp custom.cout_backfill)"
          >
            ✎
          </span>
        )}
        {r.costSource === 'estimate' && (
          <span
            className="calrent__detail-est"
            title="Coût estimé à 50% du HT (aucun coût produit ni backfill)"
          >
            ≈
          </span>
        )}
      </td>
      <td className="num">
        {formatPrice(r.margeBrute)}
        <span className="calrent-table__pct">
          {Math.round(r.margeBrutePct)}%
        </span>
      </td>
      <td className="num" />
      <td className="num" />
      <td className="num" />
      <td />
    </tr>
  ))
}

/* ============================================================ */
/*  Calendrier — monthly profitability over the last 12 months  */
/* ============================================================ */
export default function Calendrier() {
  const [costs, setCosts] = useState(null)
  const [orders, setOrders] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const { reloadKey } = useReload()

  // 12 month keys, most recent first.
  const months = useMemo(() => {
    const now = new Date()
    const arr = []
    for (let i = 0; i < MONTHS_BACK; i++) {
      arr.push(monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 1)))
    }
    return arr
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 1 — monthly costs from Supabase
      const firstMonth = months[months.length - 1]
      const { data: cRows, error: cErr } = await supabase
        .from('monthly_costs')
        .select('id, month, category, label, amount')
        .gte('month', firstMonth)
        .order('created_at', { ascending: true })
      if (cErr) throw cErr
      let costRows = cRows || []

      // 2 — lazy carry-over: if the current month has no costs yet (we just
      // rolled into a new month), copy the most recent prior month's costs.
      const currentKey = months[0]
      if (!costRows.some((c) => c.month === currentKey)) {
        const prior = [...new Set(costRows.map((c) => c.month))]
          .filter((k) => k < currentKey)
          .sort()
        const src = prior[prior.length - 1]
        if (src) {
          const toCopy = costRows
            .filter((c) => c.month === src)
            .map((c) => ({
              month: currentKey,
              category: c.category,
              label: c.label,
              amount: c.amount,
            }))
          const { data: inserted } = await supabase
            .from('monthly_costs')
            .insert(toCopy)
            .select('id, month, category, label, amount')
          if (inserted) costRows = [...costRows, ...inserted]
        }
      }
      setCosts(costRows)

      // 3 — 12 months of orders, for the margin aggregation
      const since = ymd(
        new Date(new Date().getFullYear(), new Date().getMonth() - (MONTHS_BACK - 1), 1)
      )
      const q = `created_at:>=${since} AND NOT tag:removed AND NOT financial_status:refunded AND NOT financial_status:partially_refunded AND total_price:>0`
      const res = await fetchAllPaged(
        (after) =>
          '/api/shopify/receptions?q=' +
          encodeURIComponent(q) +
          '&first=250' +
          (after ? '&after=' + encodeURIComponent(after) : ''),
        'orders'
      )
      setOrders(res.items)
      setTruncated(res.truncated)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [months])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // Sales (revenue HT/TTC + COGS) aggregated per month.
  const salesByMonth = useMemo(() => {
    const m = new Map()
    for (const key of months) m.set(key, { revenueHt: 0, revenueTtc: 0, cogs: 0 })
    if (orders) {
      for (const o of orders) {
        const d = new Date(o.createdAt)
        const key = monthKeyOf(new Date(d.getFullYear(), d.getMonth(), 1))
        const bucket = m.get(key)
        if (!bucket) continue
        let revenueTtc = 0
        let revenueHt = 0
        let lineCogs = 0
        for (const li of o.lineItems || []) {
          const qty = effectiveQuantity(li)
          if (qty <= 0 || isSample(li)) continue
          const lineTtc = Number(
            li.discountedTotalSet?.shopMoney?.amount ||
              (li.originalUnitPriceSet?.shopMoney?.amount || 0) * qty
          )
          if (Number.isNaN(lineTtc)) continue
          const unitCost = Number(li.variant?.inventoryItem?.unitCost?.amount) || 0
          revenueTtc += lineTtc
          revenueHt += lineTtc / (1 + VAT_RATE)
          lineCogs += unitCost * qty
        }
        const { cogs } = resolveOrderCogs({
          costBackfill: o.costBackfill,
          lineCogs,
          revenueHt,
        })
        bucket.revenueTtc += revenueTtc
        bucket.revenueHt += revenueHt
        bucket.cogs += cogs
      }
    }
    return m
  }, [orders, months])

  // Costs grouped per month (marketing total + fixed total).
  const costTotals = useMemo(() => {
    const m = new Map()
    for (const key of months) m.set(key, { marketing: 0, fixed: 0 })
    if (costs) {
      for (const c of costs) {
        const b = m.get(c.month)
        if (!b) continue
        if (c.category === 'marketing') b.marketing += Number(c.amount) || 0
        else b.fixed += Number(c.amount) || 0
      }
    }
    return m
  }, [costs, months])

  // Per-order breakdown for each month (for the control dropdown).
  const ordersDetailByMonth = useMemo(() => {
    const m = new Map()
    for (const key of months) m.set(key, [])
    if (orders) {
      for (const o of orders) {
        const d = new Date(o.createdAt)
        const key = monthKeyOf(new Date(d.getFullYear(), d.getMonth(), 1))
        const arr = m.get(key)
        if (!arr) continue
        let revenueHt = 0
        let revenueTtc = 0
        let lineCogs = 0
        for (const li of o.lineItems || []) {
          const qty = effectiveQuantity(li)
          if (qty <= 0 || isSample(li)) continue
          const lineTtc = Number(
            li.discountedTotalSet?.shopMoney?.amount ||
              (li.originalUnitPriceSet?.shopMoney?.amount || 0) * qty
          )
          if (Number.isNaN(lineTtc)) continue
          const unitCost = Number(li.variant?.inventoryItem?.unitCost?.amount) || 0
          revenueTtc += lineTtc
          revenueHt += lineTtc / (1 + VAT_RATE)
          lineCogs += unitCost * qty
        }
        if (revenueTtc === 0) continue
        const { cogs, source } = resolveOrderCogs({
          costBackfill: o.costBackfill,
          lineCogs,
          revenueHt,
        })
        const margeBrute = revenueHt - cogs
        arr.push({
          id: o.id,
          name: o.name,
          adminUrl: o.adminUrl,
          date: o.createdAt,
          revenueHt,
          cogs,
          margeBrute,
          margeBrutePct: pct(margeBrute, revenueHt),
          costSource: source, // 'backfill' | 'product' | 'estimate'
        })
      }
      for (const arr of m.values()) {
        arr.sort((a, b) => new Date(b.date) - new Date(a.date))
      }
    }
    return m
  }, [orders, months])

  // Per-month derived rows + 12-month totals.
  const rows = useMemo(() => {
    return months.map((key) => {
      const s = salesByMonth.get(key) || { revenueHt: 0, revenueTtc: 0, cogs: 0 }
      const ct = costTotals.get(key) || { marketing: 0, fixed: 0 }
      const margeBrute = s.revenueHt - s.cogs
      const net = margeBrute - ct.marketing - ct.fixed
      return {
        key,
        revenueHt: s.revenueHt,
        revenueTtc: s.revenueTtc,
        cogs: s.cogs,
        margeBrute,
        marketing: ct.marketing,
        fixed: ct.fixed,
        net,
        margeBrutePct: pct(margeBrute, s.revenueHt),
        netPct: pct(net, s.revenueHt),
      }
    })
  }, [months, salesByMonth, costTotals])

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.revenueHt += r.revenueHt
        acc.cogs += r.cogs
        acc.margeBrute += r.margeBrute
        acc.marketing += r.marketing
        acc.fixed += r.fixed
        acc.net += r.net
        return acc
      },
      { revenueHt: 0, cogs: 0, margeBrute: 0, marketing: 0, fixed: 0, net: 0 }
    )
  }, [rows])

  // --- cost mutations (write to Supabase, keep local state in sync) ---
  const patchLocal = (id, fields) =>
    setCosts((prev) => prev.map((c) => (c.id === id ? { ...c, ...fields } : c)))

  const persist = async (category, idOrMonth, fields) => {
    try {
      if (category === 'marketing') {
        const monthKey = idOrMonth
        const existing = costs.find(
          (c) => c.month === monthKey && c.category === 'marketing'
        )
        if (existing) {
          await supabase.from('monthly_costs').update(fields).eq('id', existing.id)
        } else {
          const { data } = await supabase
            .from('monthly_costs')
            .insert({
              month: monthKey,
              category: 'marketing',
              label: 'Meta',
              amount: fields.amount ?? 0,
            })
            .select('id, month, category, label, amount')
          if (data) setCosts((prev) => [...prev, ...data])
        }
      } else {
        await supabase.from('monthly_costs').update(fields).eq('id', idOrMonth)
      }
    } catch (e) {
      setError(e.message || String(e))
    }
  }

  const addFixed = async (monthKey) => {
    try {
      const { data } = await supabase
        .from('monthly_costs')
        .insert({ month: monthKey, category: 'fixed', label: '', amount: 0 })
        .select('id, month, category, label, amount')
      if (data) setCosts((prev) => [...prev, ...data])
    } catch (e) {
      setError(e.message || String(e))
    }
  }

  const deleteFixed = async (id) => {
    setCosts((prev) => prev.filter((c) => c.id !== id))
    try {
      await supabase.from('monthly_costs').delete().eq('id', id)
    } catch (e) {
      setError(e.message || String(e))
    }
  }

  const ready = !loading && costs && orders

  return (
    <div className="calrent">
      {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}

      {loading && <OrdersTableSkeleton columns={7} rows={12} />}

      {ready && (
        <>
          {truncated && (
            <p className="calrent__trunc">
              ⚠️ Trop de commandes : données limitées.
            </p>
          )}

          <div className="compta-table-wrap">
            <table className="compta-table calrent-table">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th className="num">CA HT</th>
                  <th className="num">Coût march.</th>
                  <th className="num">Marge brute</th>
                  <th className="num">Marketing</th>
                  <th className="num">Frais fixes</th>
                  <th className="num">Résultat net</th>
                  <th aria-label="éditer" />
                </tr>
              </thead>
              <tbody>
                <tr className="calrent-table__totals">
                  <td className="calrent-table__totals-label">Total 12 mois</td>
                  <td className="num calrent-table__ca">
                    {formatPrice(totals.revenueHt)}
                  </td>
                  <td className="num">{formatPrice(totals.cogs)}</td>
                  <td className="num calrent-table__marge">
                    {formatPrice(totals.margeBrute)}
                  </td>
                  <td className="num" />
                  <td className="num" />
                  <td
                    className={
                      'num calrent-table__net' +
                      (totals.net < 0 ? ' is-negative' : '')
                    }
                  >
                    {formatPrice(totals.net)}
                  </td>
                  <td />
                </tr>
                {rows.map((r) => {
                  const isOrders =
                    expanded?.key === r.key && expanded.mode === 'orders'
                  const isCosts =
                    expanded?.key === r.key && expanded.mode === 'costs'
                  const open = isOrders || isCosts
                  const marketingRow = costs.find(
                    (c) => c.month === r.key && c.category === 'marketing'
                  )
                  const fixedRows = costs.filter(
                    (c) => c.month === r.key && c.category === 'fixed'
                  )
                  return (
                    <Fragment key={r.key}>
                      <tr
                        className={
                          'calrent-table__row calrent-table__row--clickable' +
                          (open ? ' is-open' : '')
                        }
                        onClick={() =>
                          setExpanded(
                            isOrders ? null : { key: r.key, mode: 'orders' }
                          )
                        }
                      >
                        <td className="calrent-table__month">
                          <span
                            className={
                              'calrent-table__chevron' +
                              (isOrders ? ' is-open' : '')
                            }
                            aria-hidden="true"
                          >
                            ▸
                          </span>
                          {monthLabel(r.key)}
                        </td>
                        <td className="num calrent-table__ca">
                          {formatPrice(r.revenueHt)}
                        </td>
                        <td className="num">{formatPrice(r.cogs)}</td>
                        <td className="num calrent-table__marge">
                          {formatPrice(r.margeBrute)}
                          <span className="calrent-table__pct calrent-table__pct--bubble">
                            {Math.round(r.margeBrutePct)}%
                          </span>
                        </td>
                        <td className="num calrent-table__cost">
                          −{formatPrice(r.marketing)}
                        </td>
                        <td className="num calrent-table__cost">
                          −{formatPrice(r.fixed)}
                        </td>
                        <td
                          className={
                            'num calrent-table__net' +
                            (r.net < 0 ? ' is-negative' : '')
                          }
                        >
                          {formatPrice(r.net)}
                          <span className="calrent-table__pct">
                            {Math.round(r.netPct)}%
                          </span>
                        </td>
                        <td className="calrent-table__toggle-cell">
                          <button
                            type="button"
                            className="calrent-table__toggle"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpanded(
                                isCosts ? null : { key: r.key, mode: 'costs' }
                              )
                            }}
                            aria-expanded={isCosts}
                            title="Éditer les coûts du mois"
                          >
                            {isCosts ? '×' : '✎'}
                          </button>
                        </td>
                      </tr>
                      {isOrders && (
                        <OrdersBreakdownRows
                          monthKey={r.key}
                          rows={ordersDetailByMonth.get(r.key) || []}
                        />
                      )}
                      {isCosts && (
                        <tr className="calrent-table__editor-row">
                          <td colSpan={8}>
                            <CostEditor
                              monthKey={r.key}
                              marketingRow={marketingRow}
                              fixedRows={fixedRows}
                              onPatch={patchLocal}
                              onPersist={persist}
                              onAdd={addFixed}
                              onDelete={deleteFixed}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
