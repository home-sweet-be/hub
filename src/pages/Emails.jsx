import { useCallback, useEffect, useMemo, useState } from 'react'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

// Maps Resend's `last_event` to a human label + badge style. Anything we don't
// recognise falls through to a neutral badge with the raw value.
const STATUS_META = {
  delivered: { label: 'Livré', cls: 'is-delivered' },
  sent: { label: 'Envoyé', cls: 'is-sent' },
  queued: { label: 'En file', cls: 'is-sent' },
  scheduled: { label: 'Programmé', cls: 'is-sent' },
  delivery_delayed: { label: 'Retardé', cls: 'is-delayed' },
  opened: { label: 'Ouvert', cls: 'is-opened' },
  clicked: { label: 'Cliqué', cls: 'is-opened' },
  bounced: { label: 'Rejeté', cls: 'is-bounced' },
  complained: { label: 'Spam', cls: 'is-bounced' },
  failed: { label: 'Échec', cls: 'is-bounced' },
  canceled: { label: 'Annulé', cls: 'is-muted' },
}

// Status families used for the filter chips + summary counters.
const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'delivered', label: 'Livrés' },
  { id: 'sent', label: 'En cours' },
  { id: 'opened', label: 'Ouverts' },
  { id: 'bounced', label: 'Problèmes' },
]

// Which last_event values belong to each filter family.
const FILTER_GROUPS = {
  delivered: ['delivered'],
  sent: ['sent', 'queued', 'scheduled', 'delivery_delayed'],
  opened: ['opened', 'clicked'],
  bounced: ['bounced', 'complained', 'failed'],
}

function statusMeta(event) {
  const key = String(event || '').toLowerCase()
  return STATUS_META[key] || { label: event || 'Inconnu', cls: 'is-muted' }
}

function filterOf(event) {
  const key = String(event || '').toLowerCase()
  for (const [family, events] of Object.entries(FILTER_GROUPS)) {
    if (events.includes(key)) return family
  }
  return 'sent'
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function recipient(email) {
  const to = email?.to
  if (Array.isArray(to)) return to.join(', ')
  return to || '—'
}

export default function Emails() {
  const [emails, setEmails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const { reloadKey } = useReload()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/email/list?pages=10')
      const data = await r.json().catch(() => null)
      if (!r.ok || !data) {
        throw new Error(data?.error || `HTTP ${r.status}`)
      }
      setEmails(Array.isArray(data.emails) ? data.emails : [])
      setHasMore(Boolean(data.has_more))
    } catch (e) {
      setError(e.message || String(e))
      setEmails([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const counts = useMemo(() => {
    const c = { all: 0, delivered: 0, sent: 0, opened: 0, bounced: 0 }
    for (const e of emails || []) {
      c.all += 1
      c[filterOf(e.last_event)] += 1
    }
    return c
  }, [emails])

  const rows = useMemo(() => {
    if (!emails) return []
    const term = search.trim().toLowerCase()
    return emails.filter((e) => {
      if (filter !== 'all' && filterOf(e.last_event) !== filter) return false
      if (!term) return true
      return (
        recipient(e).toLowerCase().includes(term) ||
        (e.subject || '').toLowerCase().includes(term)
      )
    })
  }, [emails, search, filter])

  return (
    <div className="page emails">
      <header className="rapports__head">
        <h1 className="rapports__title">Emails</h1>
        <p className="emails__subtitle">
          Historique complet des emails envoyés aux clients, synchronisé depuis
          Resend avec leur statut de livraison réel.
        </p>
      </header>

      <nav className="emails__filters" aria-label="Filtres">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={'emails__chip' + (filter === f.id ? ' is-active' : '')}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {emails && (
              <span className="emails__chip-count">{counts[f.id] ?? 0}</span>
            )}
          </button>
        ))}
        <label className="emails__search">
          <input
            type="search"
            placeholder="Email ou sujet…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </nav>

      {error && (
        <p style={{ color: '#c00' }}>
          Erreur de chargement : {error}
        </p>
      )}

      {loading && <OrdersTableSkeleton columns={4} rows={10} />}

      {!loading && emails && (
        <>
          <div className="emails__summary">
            <span>
              <strong>{rows.length}</strong> email
              {rows.length > 1 ? 's' : ''} affiché{rows.length > 1 ? 's' : ''}
              {filter !== 'all' || search ? ` (sur ${counts.all})` : ''}
            </span>
            {counts.bounced > 0 && (
              <span className="emails__summary-warn">
                ⚠ {counts.bounced} problème{counts.bounced > 1 ? 's' : ''} de
                livraison
              </span>
            )}
            {hasMore && (
              <span className="reception-table__muted">
                Historique tronqué — emails les plus récents affichés.
              </span>
            )}
          </div>

          <div className="compta-table-wrap">
            <table className="compta-table rapports-table emails-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Destinataire</th>
                  <th>Sujet</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="reception-table__empty">
                      {search || filter !== 'all'
                        ? 'Aucun email ne correspond aux filtres.'
                        : 'Aucun email envoyé pour le moment.'}
                    </td>
                  </tr>
                )}
                {rows.map((e) => {
                  const meta = statusMeta(e.last_event)
                  return (
                    <tr key={e.id}>
                      <td className="emails-table__date">
                        {formatDateTime(e.created_at)}
                      </td>
                      <td className="emails-table__to">{recipient(e)}</td>
                      <td className="emails-table__subject">
                        {e.subject || (
                          <span className="reception-table__muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={'email-status ' + meta.cls}>
                          {meta.label}
                        </span>
                      </td>
                    </tr>
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
