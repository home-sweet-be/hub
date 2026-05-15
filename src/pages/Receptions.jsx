import { useEffect, useMemo, useState } from 'react'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE)-/i

const TABS = [
  {
    id: 'stock',
    label: 'EN STOCK',
    dot: '#34c759',
    supplierTitle: null,
    filter: (o) => o.tags.includes('ProduitEnStock'),
  },
  {
    id: 'intercommerce',
    label: 'INTERCOMMERCE',
    supplierTitle: 'intercommerce',
    filter: (o) =>
      o.tags.includes('SentToSupplier') &&
      o.lineItems.some((li) => li.vendor === 'INTERCOMMERCE'),
  },
  {
    id: 'eltap',
    label: 'ELTAP',
    supplierTitle: 'ELTAP',
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

export default function Receptions() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('intercommerce')

  useEffect(() => {
    fetch('/api/shopify/receptions?first=250')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
        return r.json()
      })
      .then((data) => setOrders(data.orders || []))
      .catch((e) => setError(e.message))
  }, [])

  const activeDef = TABS.find((t) => t.id === activeTab) || TABS[0]

  const filtered = useMemo(() => {
    if (!orders) return []
    const list = orders.filter(activeDef.filter)
    return list.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }, [orders, activeDef])

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
        <aside className="reception__left">
          <div className="reception__pane-label">Liste de commandes réceptionnées</div>
          <div className="reception__received-empty">
            <span>0 results</span>
            <span className="reception__received-empty-hint">
              à brancher
            </span>
          </div>
        </aside>

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
                    return (
                      <tr key={o.id}>
                        <td>
                          <button
                            type="button"
                            className="reception-action"
                            title="Réceptionner (à brancher)"
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
                        <td className="reception-num">{o.name.replace(/^#/, '')}</td>
                        <td>
                          {zone ? (
                            <span className="zone-badge">{zone}</span>
                          ) : (
                            <span className="reception-table__muted">—</span>
                          )}
                        </td>
                        <td className="reception-date">{formatDate(o.createdAt)}</td>
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
