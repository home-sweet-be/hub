import { useEffect, useState } from 'react'

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
  if (!c) return '—'
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '—'
}

function articlesSummary(items = []) {
  return items
    .map((li) => `${li.quantity}× ${li.title}${li.variant_title ? ` / ${li.variant_title}` : ''}`)
    .join(' · ')
}

export default function Commandes() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/shopify/orders?limit=50&status=any')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
        return r.json()
      })
      .then((data) => setOrders(data.orders || []))
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="page">
      <h1 className="page__title">Commandes</h1>
      <p className="page__hint">
        {orders === null && !error && 'Chargement…'}
        {error && <span style={{ color: '#c00' }}>Erreur : {error}</span>}
        {orders && `${orders.length} commande${orders.length > 1 ? 's' : ''}`}
      </p>

      {orders && (
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Date</th>
                <th>Client</th>
                <th className="num">Total</th>
                <th>Paiement</th>
                <th>Articles</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="order-num">{o.name}</span>
                  </td>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{customerName(o.customer)}</td>
                  <td className="num">
                    {formatPrice(o.total_price, o.currency)}
                  </td>
                  <td>
                    <span className={`badge badge--${o.financial_status}`}>
                      {(o.financial_status || '—').toUpperCase()}
                    </span>
                  </td>
                  <td className="truncate">{articlesSummary(o.line_items)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
