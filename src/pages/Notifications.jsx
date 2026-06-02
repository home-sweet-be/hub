import { useCallback, useEffect, useMemo, useState } from 'react'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

/* ============================================================ */
/*  Shared helpers                                              */
/* ============================================================ */
function zoneLabel(zone) {
  if (!zone) return '—'
  if (zone === 'LU') return 'Luxembourg'
  if (zone === 'LIV-Externe') return 'Externe'
  return zone.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
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

/* ============================================================ */
/*  Tab 1: Suivi (expected vs sent reconciliation)             */
/* ============================================================ */
// Resend last_event → reconciliation family.
function familyOf(row) {
  if (!row.notified) return 'missing'
  const e = String(row.lastEvent || '').toLowerCase()
  if (['bounced', 'complained', 'failed'].includes(e)) return 'problem'
  if (['delivered', 'opened', 'clicked'].includes(e)) return 'received'
  return 'sent' // sent, queued, scheduled, delivery_delayed, …
}

const SUIVI_META = {
  received: { label: '✓ Reçu', cls: 'is-received' },
  sent: { label: 'Envoyé', cls: 'is-sent' },
  problem: { label: '⚠ Problème', cls: 'is-problem' },
  missing: { label: 'Non notifié', cls: 'is-missing' },
}

const SUIVI_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'missing', label: 'Non notifiés' },
  { id: 'problem', label: 'Problèmes' },
  { id: 'sent', label: 'Envoyés' },
  { id: 'received', label: 'Reçus' },
]

// Lower = more urgent → sorted first.
const FAMILY_RANK = { missing: 0, problem: 1, sent: 2, received: 3 }

function Suivi() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [zone, setZone] = useState('all')
  const [search, setSearch] = useState('')
  // Per-row resend state: orderName -> 'sending' | 'ok' | { err: msg }
  const [resend, setResend] = useState({})
  const { reloadKey } = useReload()

  const resendOne = useCallback(async (r) => {
    if (!r.email) {
      setResend((s) => ({ ...s, [r.orderName]: { err: 'Pas d’email' } }))
      return
    }
    setResend((s) => ({ ...s, [r.orderName]: 'sending' }))
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderName: r.orderName,
          email: r.email,
          customerName: r.customerName,
          zone: r.zone,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setResend((s) => ({ ...s, [r.orderName]: 'ok' }))
    } catch (e) {
      setResend((s) => ({ ...s, [r.orderName]: { err: e.message || String(e) } }))
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/notifications')
      const json = await r.json().catch(() => null)
      if (!r.ok || !json) throw new Error(json?.error || `HTTP ${r.status}`)
      setData(json)
    } catch (e) {
      setError(e.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const enriched = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.map((r) => ({ ...r, family: familyOf(r) }))
  }, [data])

  const counts = useMemo(() => {
    const c = { all: 0, received: 0, sent: 0, problem: 0, missing: 0 }
    for (const r of enriched) {
      c.all += 1
      c[r.family] += 1
    }
    return c
  }, [enriched])

  const zones = useMemo(() => {
    const set = new Set()
    for (const r of enriched) if (r.zone) set.add(r.zone)
    return [...set].sort()
  }, [enriched])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return enriched
      .filter((r) => {
        if (filter !== 'all' && r.family !== filter) return false
        if (zone !== 'all' && r.zone !== zone) return false
        if (!term) return true
        return (
          (r.customerName || '').toLowerCase().includes(term) ||
          (r.email || '').toLowerCase().includes(term) ||
          (r.orderName || '').toLowerCase().includes(term)
        )
      })
      .sort((a, b) => {
        const ra = FAMILY_RANK[a.family] ?? 9
        const rb = FAMILY_RANK[b.family] ?? 9
        if (ra !== rb) return ra - rb
        if ((a.zone || '') !== (b.zone || '')) return (a.zone || '').localeCompare(b.zone || '')
        return String(a.orderName).localeCompare(String(b.orderName))
      })
  }, [enriched, filter, zone, search])

  return (
    <>
      <p className="notif__subtitle">
        Tous les clients en file d'attente (<code>WaitingList</code>) et l'état
        réel de leur notification, croisé avec Resend. Les lignes{' '}
        <strong>Non notifié</strong> ou <strong>Problème</strong> sont celles à
        traiter.
      </p>

      <nav className="notif__filters" aria-label="Filtres">
        {SUIVI_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={
              'notif__chip notif__chip--' +
              f.id +
              (filter === f.id ? ' is-active' : '')
            }
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {data && <span className="notif__chip-count">{counts[f.id] ?? 0}</span>}
          </button>
        ))}

        {zones.length > 0 && (
          <select
            className="notif__zone-select"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            aria-label="Filtrer par zone"
          >
            <option value="all">Toutes les zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </select>
        )}

        <label className="notif__search">
          <input
            type="search"
            placeholder="Client, email, n°…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </nav>

      {error && <p style={{ color: '#c00' }}>Erreur de chargement : {error}</p>}
      {loading && <OrdersTableSkeleton columns={6} rows={10} />}

      {!loading && data && (
        <>
          <div className="notif__summary">
            <span>
              <strong>{counts.all}</strong> en file d'attente
            </span>
            {counts.missing > 0 && (
              <span className="notif__summary-warn">
                ⛔ {counts.missing} non notifié{counts.missing > 1 ? 's' : ''}
              </span>
            )}
            {counts.problem > 0 && (
              <span className="notif__summary-warn">
                ⚠ {counts.problem} problème{counts.problem > 1 ? 's' : ''}
              </span>
            )}
            <span className="notif__summary-ok">✓ {counts.received} reçu{counts.received > 1 ? 's' : ''}</span>
          </div>

          <div className="compta-table-wrap">
            <table className="compta-table rapports-table notif-table">
              <thead>
                <tr>
                  <th>Statut</th>
                  <th>N°</th>
                  <th>Client</th>
                  <th>Email</th>
                  <th>Zone</th>
                  <th>Notifié le</th>
                  <th aria-label="Relancer" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="reception-table__empty">
                      {data.rows.length === 0
                        ? "Aucun client en file d'attente."
                        : 'Aucun client ne correspond aux filtres.'}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const meta = SUIVI_META[r.family]
                  const urgent = r.family === 'missing' && r.zoneHasSlot
                  return (
                    <tr key={r.orderName + r.email}>
                      <td>
                        <span className={'notif-status ' + meta.cls}>
                          {meta.label}
                        </span>
                        {urgent && (
                          <span
                            className="notif-slot-flag"
                            title="Un créneau est disponible dans sa zone — à notifier en priorité"
                          >
                            créneau dispo
                          </span>
                        )}
                      </td>
                      <td className="notif-table__order">
                        {String(r.orderName).replace(/^#/, '')}
                      </td>
                      <td>{r.customerName || <span className="reception-table__muted">—</span>}</td>
                      <td className="notif-table__email">
                        {r.email || <span className="reception-table__muted">—</span>}
                      </td>
                      <td>{zoneLabel(r.zone)}</td>
                      <td className="notif-table__date">
                        {r.notified ? formatDateTime(r.sentAt) : '—'}
                      </td>
                      <td className="notif-table__action">
                        {(() => {
                          const st = resend[r.orderName]
                          if (st === 'ok') {
                            return <span className="notif-resent">✓ Renvoyé</span>
                          }
                          return (
                            <button
                              type="button"
                              className="notif-resend-btn"
                              disabled={st === 'sending' || !r.email}
                              onClick={() => resendOne(r)}
                              title={
                                r.email
                                  ? `Renvoyer la notification à ${r.email}`
                                  : 'Aucun email pour ce client'
                              }
                            >
                              {st === 'sending'
                                ? '…'
                                : st && st.err
                                ? '⚠️'
                                : '📨'}
                            </button>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/* ============================================================ */
/*  Tab 2: Historique (raw Resend list)                        */
/* ============================================================ */
const HIST_META = {
  delivered: { label: 'Livré', cls: 'is-received' },
  sent: { label: 'Envoyé', cls: 'is-sent' },
  queued: { label: 'En file', cls: 'is-sent' },
  scheduled: { label: 'Programmé', cls: 'is-sent' },
  delivery_delayed: { label: 'Retardé', cls: 'is-sent' },
  opened: { label: 'Ouvert', cls: 'is-received' },
  clicked: { label: 'Cliqué', cls: 'is-received' },
  bounced: { label: 'Rejeté', cls: 'is-problem' },
  complained: { label: 'Spam', cls: 'is-problem' },
  failed: { label: 'Échec', cls: 'is-problem' },
  canceled: { label: 'Annulé', cls: 'is-missing' },
}

function histMeta(event) {
  return HIST_META[String(event || '').toLowerCase()] || { label: event || 'Inconnu', cls: 'is-missing' }
}

function recipient(email) {
  const to = email?.to
  if (Array.isArray(to)) return to.join(', ')
  return to || '—'
}

function Historique() {
  const [emails, setEmails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const { reloadKey } = useReload()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/email/list?pages=10')
      const data = await r.json().catch(() => null)
      if (!r.ok || !data) throw new Error(data?.error || `HTTP ${r.status}`)
      setEmails(Array.isArray(data.emails) ? data.emails : [])
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

  const rows = useMemo(() => {
    if (!emails) return []
    const term = search.trim().toLowerCase()
    if (!term) return emails
    return emails.filter(
      (e) =>
        recipient(e).toLowerCase().includes(term) ||
        (e.subject || '').toLowerCase().includes(term)
    )
  }, [emails, search])

  return (
    <>
      <nav className="notif__filters" aria-label="Recherche">
        <label className="notif__search notif__search--wide">
          <input
            type="search"
            placeholder="Email ou sujet…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </nav>

      {error && <p style={{ color: '#c00' }}>Erreur de chargement : {error}</p>}
      {loading && <OrdersTableSkeleton columns={4} rows={10} />}

      {!loading && emails && (
        <>
          <div className="notif__summary">
            <span>
              <strong>{rows.length}</strong> email{rows.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="compta-table-wrap">
            <table className="compta-table rapports-table notif-table">
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
                      Aucun email.
                    </td>
                  </tr>
                )}
                {rows.map((e) => {
                  const meta = histMeta(e.last_event)
                  return (
                    <tr key={e.id}>
                      <td className="notif-table__date">{formatDateTime(e.created_at)}</td>
                      <td className="notif-table__email">{recipient(e)}</td>
                      <td>{e.subject || <span className="reception-table__muted">—</span>}</td>
                      <td>
                        <span className={'notif-status ' + meta.cls}>{meta.label}</span>
                      </td>
                    </tr>
                  )
                })}
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
const TABS = [
  { id: 'suivi', label: 'Suivi' },
  { id: 'historique', label: 'Historique Resend' },
]

export default function Notifications() {
  const [tab, setTab] = useState('suivi')

  return (
    <div className="page notif">
      <header className="rapports__head">
        <h1 className="rapports__title">Notifications</h1>
      </header>

      <nav className="rapports__subpages" aria-label="Onglets">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'rapports__subpage' + (tab === t.id ? ' is-active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section className="rapports__panel">
        {tab === 'suivi' && <Suivi />}
        {tab === 'historique' && <Historique />}
      </section>
    </div>
  )
}
