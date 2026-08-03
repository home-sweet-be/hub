import { useState } from 'react'
import FactureOptionsModal from '../components/FactureOptionsModal'

// Recherche d'une commande (numéro, nom client ou email) pour générer sa
// facture. Contrairement à l'onglet Commandes (qui n'affiche que les ~90
// dernières), on interroge Shopify à la demande, donc n'importe quelle
// commande, même ancienne, est trouvable. La facture elle-même est rendue par
// la page /facture/:orderName (déjà en place), ouverte dans un nouvel onglet.

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

const FINANCIAL_LABEL = {
  PAID: 'Payée',
  PARTIALLY_PAID: 'Acompte versé',
  PENDING: 'En attente',
  AUTHORIZED: 'Autorisée',
  REFUNDED: 'Remboursée',
  PARTIALLY_REFUNDED: 'Part. remboursée',
  VOIDED: 'Annulée',
}

export default function Facturation() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null) // null = pas de recherche, [] = aucun résultat
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState('')
  const [customizing, setCustomizing] = useState(null) // commande en cours de personnalisation

  const search = async (e) => {
    e?.preventDefault()
    const t = term.trim()
    if (!t || loading) return
    setLoading(true)
    setError(null)
    setResults(null)
    // Numéro pur → recherche exacte par name (évite les faux positifs) ;
    // sinon on laisse Shopify chercher (email, nom client, etc.).
    const digits = t.replace(/^#/, '')
    const q = /^\d+$/.test(digits) ? `name:${digits}` : t
    try {
      const r = await fetch(
        '/api/shopify/receptions?first=25&withTx=1&q=' +
          encodeURIComponent(q)
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setResults(data.orders || [])
      setSearched(t)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page page--facturation">
      <h1 className="page__title">Facturation</h1>
      <p className="page__hint">
        Recherchez une commande par numéro, nom de client ou email, puis générez
        sa facture.
      </p>

      <form className="facturation-search" onSubmit={search}>
        <span className="facturation-search__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        <input
          type="text"
          className="facturation-search__input"
          placeholder="N° de commande, nom ou email…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="btn btn--blue"
          disabled={loading || !term.trim()}
        >
          {loading ? 'Recherche…' : 'Rechercher'}
        </button>
      </form>

      {error && <p className="facturation-error">Erreur : {error}</p>}

      {!error && results && results.length === 0 && (
        <p className="facturation-empty">
          Aucune commande trouvée pour « {searched} ».
        </p>
      )}

      {!error && results && results.length > 0 && (
        <ul className="facturation-results">
          {results.map((o) => {
            const name = String(o.name).replace(/^#/, '')
            return (
              <li key={o.id} className="facturation-card">
                <div className="facturation-card__main">
                  <div className="facturation-card__num">#{name}</div>
                  <div className="facturation-card__cust">
                    {customerName(o.customer) ||
                      o.shippingAddress?.name ||
                      '—'}
                    {o.shippingAddress?.city
                      ? ` · ${o.shippingAddress.city}`
                      : ''}
                  </div>
                  <div className="facturation-card__meta">
                    {formatDate(o.createdAt)}
                    {o.financialStatus
                      ? ` · ${FINANCIAL_LABEL[o.financialStatus] || o.financialStatus}`
                      : ''}
                  </div>
                </div>
                <div className="facturation-card__total">
                  {formatPrice(o.total, o.currency)}
                </div>
                <a
                  href={`/facture/${name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--blue facturation-card__btn"
                >
                  📄 Facture
                </a>
                <button
                  type="button"
                  className="facturation-card__gear"
                  onClick={() => setCustomizing(o)}
                  title="Personnaliser (adresse, texte) — non enregistré"
                  aria-label="Personnaliser la facture"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {customizing && (
        <FactureOptionsModal
          key={customizing.id}
          order={customizing}
          onClose={() => setCustomizing(null)}
        />
      )}
    </div>
  )
}
