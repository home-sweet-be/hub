import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import SlotModal from '../components/SlotModal'
import { ZoneFlag, zoneCode } from '../components/ZoneFlag'
import BelgiumHeatmap from '../components/BelgiumHeatmap'
import { useReload } from '../lib/reload'

const DAY_LABELS_BY_DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

function extractZone(order) {
  const find = (tags) => (tags || []).find((t) => ZONE_TAG_PATTERN.test(t))
  return find(order?.tags) || find(order?.customer?.tags) || null
}

function zoneLabel(z) {
  if (!z) return 'Non défini'
  if (z === 'LU') return 'Luxembourg'
  if (/^LIV/i.test(z)) return 'Externe'
  return z.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
}

function shippingTier(title) {
  if (!title) return 'standard'
  if (/premium/i.test(title)) return 'premium'
  if (/confort/i.test(title)) return 'confort'
  return 'standard'
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function ymdLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDay(d) {
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })
}

function fmtTime(date) {
  return date.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

function isToday(d) {
  const t = new Date()
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  )
}

function zoneShort(z) {
  if (z === 'LU') return 'LU'
  return z.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
}

export default function LivraisonsPlanifier() {
  const [weekStart, setWeekStart] = useState(() => startOfToday())
  const [slots, setSlots] = useState(null)
  const [bookings, setBookings] = useState({})
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [waitingOrders, setWaitingOrders] = useState(null)
  const [upcomingSlots, setUpcomingSlots] = useState(null)
  const [upcomingBookings, setUpcomingBookings] = useState({})
  const [bookedOrders, setBookedOrders] = useState(() => new Map())
  const [priorityVersion, setPriorityVersion] = useState(0)
  // Brief toast shown after a slot is created, reporting how many waiting-list
  // customers were notified by email.
  const [notifyToast, setNotifyToast] = useState(null)
  // Hover tooltip listing the orders of a zone row (rendered in a portal so it
  // isn't clipped by the scrollable .hub-main__inner container).
  const [zoneTip, setZoneTip] = useState(null)
  const zoneTipTimer = useRef(null)

  const openZoneTip = useCallback((orders, el) => {
    if (zoneTipTimer.current) clearTimeout(zoneTipTimer.current)
    const r = el.getBoundingClientRect()
    setZoneTip({ orders, top: r.top, left: r.right })
  }, [])

  const scheduleCloseZoneTip = useCallback(() => {
    if (zoneTipTimer.current) clearTimeout(zoneTipTimer.current)
    zoneTipTimer.current = setTimeout(() => setZoneTip(null), 120)
  }, [])

  const cancelCloseZoneTip = useCallback(() => {
    if (zoneTipTimer.current) clearTimeout(zoneTipTimer.current)
  }, [])

  const refreshPriorities = useCallback(() => {
    setPriorityVersion((v) => v + 1)
  }, [])

  const { reloadKey } = useReload()

  // Header refresh button → trigger weekly load + priorities recompute
  useEffect(() => {
    if (reloadKey === 0) return
    refreshPriorities()
  }, [reloadKey, refreshPriorities])

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  const load = useCallback(async () => {
    setSlots(null)
    setError(null)
    const { data: slotData, error: err1 } = await supabase
      .from('delivery_slots')
      .select('*')
      .gte('starts_at', weekStart.toISOString())
      .lt('starts_at', weekEnd.toISOString())
      .order('starts_at', { ascending: true })
    if (err1) {
      setError(err1.message)
      return
    }
    setSlots(slotData || [])

    if (slotData && slotData.length > 0) {
      const ids = slotData.map((s) => s.id)
      const { data: bks } = await supabase
        .from('delivery_bookings')
        .select('slot_id, status')
        .in('slot_id', ids)
        .eq('status', 'confirmed')
      const map = {}
      ;(bks || []).forEach((b) => {
        map[b.slot_id] = (map[b.slot_id] || 0) + 1
      })
      setBookings(map)
    } else {
      setBookings({})
    }
  }, [weekStart, weekEnd])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // Load waiting-list orders + all upcoming slots to compute coverage
  useEffect(() => {
    let cancelled = false
    const nowIso = new Date().toISOString()
    const cutoff = new Date(Date.now() - 150 * 86400000)
      .toISOString()
      .slice(0, 10)

    setWaitingOrders(null)
    setUpcomingSlots(null)
    setUpcomingBookings({})

    fetch(
      '/api/shopify/receptions?q=' +
        encodeURIComponent(
          `created_at:>=${cutoff} AND tag:WaitingList AND NOT tag:removed AND status:open AND NOT fulfillment_status:fulfilled AND NOT financial_status:refunded AND NOT financial_status:partially_refunded`
        ) +
        '&first=100'
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setWaitingOrders(data.orders || [])
      })
      .catch(() => {
        if (!cancelled) setWaitingOrders([])
      })

    ;(async () => {
      const { data: slotData } = await supabase
        .from('delivery_slots')
        .select('*')
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
      if (cancelled) return
      const list = slotData || []
      setUpcomingSlots(list)
      if (list.length > 0) {
        const ids = list.map((s) => s.id)
        const slotStarts = new Map(list.map((s) => [s.id, s.starts_at]))
        const { data: bks } = await supabase
          .from('delivery_bookings')
          .select('slot_id, shopify_order_name, status')
          .in('slot_id', ids)
          .eq('status', 'confirmed')
        if (cancelled) return
        const map = {}
        const bookedMap = new Map()
        ;(bks || []).forEach((b) => {
          map[b.slot_id] = (map[b.slot_id] || 0) + 1
          if (b.shopify_order_name) {
            const key = String(b.shopify_order_name).replace(/^#/, '')
            bookedMap.set(key, slotStarts.get(b.slot_id) || null)
          }
        })
        setUpcomingBookings(map)
        setBookedOrders(bookedMap)
      } else {
        setUpcomingBookings({})
        setBookedOrders(new Map())
      }
    })()

    return () => {
      cancelled = true
    }
  }, [priorityVersion])

  const zonePriorities = useMemo(() => {
    if (!waitingOrders) return null
    const counts = new Map()
    const ordersByZone = new Map()
    let unknown = 0
    for (const o of waitingOrders) {
      const zone = extractZone(o)
      if (!zone) {
        unknown += 1
        continue
      }
      counts.set(zone, (counts.get(zone) || 0) + 1)
      if (!ordersByZone.has(zone)) ordersByZone.set(zone, [])
      ordersByZone.get(zone).push({ name: o.name, adminUrl: o.adminUrl })
    }

    const coverageFor = (zone) => {
      if (!upcomingSlots) return null
      return upcomingSlots
        .filter((s) => (s.zones || []).includes(zone))
        .reduce(
          (sum, s) =>
            sum + Math.max(0, s.capacity - (upcomingBookings[s.id] || 0)),
          0
        )
    }

    const rows = [...counts.entries()]
      .map(([zone, count]) => ({
        zone,
        count,
        coverage: coverageFor(zone),
        orders: ordersByZone.get(zone) || [],
      }))
      .sort((a, b) => b.count - a.count)

    return { rows, unknown, total: waitingOrders.length }
  }, [waitingOrders, upcomingSlots, upcomingBookings])

  const coveredZones = useMemo(() => {
    const set = new Set()
    for (const r of zonePriorities?.rows || []) {
      if (r.coverage !== null && r.coverage > 0) set.add(r.zone)
    }
    return set
  }, [zonePriorities])

  const waitingPins = useMemo(() => {
    if (!waitingOrders) return []
    return waitingOrders
      .map((o) => {
        const lat = o.shippingAddress?.latitude
        const lon = o.shippingAddress?.longitude
        if (typeof lat !== 'number' || typeof lon !== 'number') return null
        const active = (o.lineItems || []).filter(
          (li) => (li.currentQuantity ?? li.quantity ?? 0) > 0
        )
        const firstTitle = active[0]?.title || ''
        const product =
          active.length > 1
            ? `${firstTitle} +${active.length - 1}`
            : firstTitle
        const zone = extractZone(o)
        const covered = zone ? coveredZones.has(zone) : false
        const orderKey = String(o.name || '').replace(/^#/, '')
        const booked = bookedOrders.has(orderKey)
        const bookedAt = booked ? bookedOrders.get(orderKey) : null
        const cust = o.customer
        const customerName = cust
          ? [cust.firstName, cust.lastName].filter(Boolean).join(' ').trim()
          : ''
        return {
          lat,
          lon,
          key: o.id,
          orderName: o.name,
          city: o.shippingAddress?.city || '',
          product,
          covered,
          booked,
          bookedAt,
          customerName,
          tier: shippingTier(o.shippingLine?.title),
        }
      })
      .filter(Boolean)
  }, [waitingOrders, coveredZones, bookedOrders])

  const days = useMemo(() => {
    const arr = []
    for (let i = 0; i < 7; i++) arr.push(addDays(weekStart, i))
    return arr
  }, [weekStart])

  const slotsByDay = useMemo(() => {
    const map = new Map()
    days.forEach((d) => map.set(ymdLocal(d), []))
    if (!slots) return map
    for (const s of slots) {
      const k = ymdLocal(new Date(s.starts_at))
      if (map.has(k)) map.get(k).push(s)
    }
    return map
  }, [days, slots])

  const weekLabel = `${weekStart.toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'long',
  })} – ${addDays(weekStart, 6).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })}`

  return (
    <div className="livraisons">
      <div className="livraisons__toolbar">
        <div className="livraisons__nav">
          <button
            type="button"
            className="livraisons__nav-btn"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Semaine précédente"
          >
            ‹
          </button>
          <button
            type="button"
            className="livraisons__nav-btn livraisons__nav-btn--today"
            onClick={() => setWeekStart(startOfToday())}
          >
            Aujourd'hui
          </button>
          <button
            type="button"
            className="livraisons__nav-btn"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Semaine suivante"
          >
            ›
          </button>
          <h2 className="livraisons__title">{weekLabel}</h2>
        </div>
      </div>

      {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}

      <div className="livraisons__week">
        {days.map((d, i) => {
          const slotsForDay = slotsByDay.get(ymdLocal(d)) || []
          return (
            <div
              key={i}
              className={'livraisons__day' + (isToday(d) ? ' is-today' : '')}
            >
              <header className="livraisons__day-head">
                <span className="livraisons__day-name">{DAY_LABELS_BY_DOW[d.getDay()]}</span>
                <span className="livraisons__day-date">{fmtDay(d)}</span>
              </header>

              <div className="livraisons__day-slots">
                {slots === null && <div className="livraisons__skeleton" />}
                {slots !== null &&
                  slotsForDay.map((s) => {
                    const startD = new Date(s.starts_at)
                    const endD = new Date(s.ends_at)
                    const bookedCount = bookings[s.id] || 0
                    const full = bookedCount >= s.capacity
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={
                          'livraisons__slot' + (full ? ' is-full' : '')
                        }
                        onClick={() => setEditing({ slot: s })}
                      >
                        <div className="livraisons__slot-time">
                          {fmtTime(startD)} – {fmtTime(endD)}
                        </div>
                        <div className="livraisons__slot-zones">
                          {(s.zones || []).slice(0, 3).map((z) => (
                            <span key={z} className="livraisons__slot-zone">
                              {zoneShort(z)}
                            </span>
                          ))}
                          {(s.zones || []).length > 3 && (
                            <span className="livraisons__slot-zone livraisons__slot-zone--more">
                              +{s.zones.length - 3}
                            </span>
                          )}
                        </div>
                        <div className="livraisons__slot-cap">
                          {bookedCount}/{s.capacity}
                          {full && <span> · complet</span>}
                        </div>
                      </button>
                    )
                  })}
                {slots !== null && (
                  <button
                    type="button"
                    className="livraisons__add"
                    onClick={() => setEditing({ day: d })}
                  >
                    + Ajouter
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <section className="zone-priorities">
        <div className="zone-priorities__layout">
        <aside className="zone-priorities__map">
          <BelgiumHeatmap
            zoneCounts={
              new Map(
                (zonePriorities?.rows || []).map((r) => [r.zone, r.count])
              )
            }
            zoneCoverage={
              new Map(
                (zonePriorities?.rows || []).map((r) => [r.zone, r.coverage ?? 0])
              )
            }
            max={zonePriorities?.rows?.[0]?.count || 0}
            pins={waitingPins}
          />
        </aside>
        <div className="zone-priorities__main">
        <header className="zone-priorities__head">
          <div>
            <h3 className="zone-priorities__title">
              Priorités de planification
            </h3>
            <p className="zone-priorities__subtitle">
              Zones de la file d'attente classées par volume — pense à ouvrir
              des créneaux ici en priorité.
            </p>
          </div>
          {zonePriorities && (
            <span className="zone-priorities__total">
              {zonePriorities.total} en attente
            </span>
          )}
        </header>

        {zonePriorities === null && (
          <div className="zone-priorities__skeleton" />
        )}

        {zonePriorities && zonePriorities.rows.length === 0 && (
          <div className="zone-priorities__empty">
            {zonePriorities.unknown > 0
              ? `${zonePriorities.unknown} commande(s) en attente sans zone définie.`
              : 'Aucune commande en file d\'attente. Tout est sous contrôle.'}
          </div>
        )}

        {zonePriorities && zonePriorities.rows.length > 0 && (
          <ol className="zone-priorities__list">
            {zonePriorities.rows.map((z, i) => {
              const max = zonePriorities.rows[0].count
              const demandPct = (z.count / max) * 100
              const cov = z.coverage
              const status =
                cov === null
                  ? 'loading'
                  : cov > 0
                  ? 'covered'
                  : 'none'
              const coveredFraction =
                cov === null || z.count === 0
                  ? 0
                  : Math.min(cov, z.count) / z.count
              return (
                <li
                  key={z.zone}
                  className={'zone-priorities__row is-' + status}
                >
                  <span className="zone-priorities__rank">{i + 1}</span>
                  <span className="zone-priorities__zone">
                    {!/^LIV/i.test(z.zone) && (
                      <ZoneFlag code={zoneCode(z.zone)} />
                    )}
                    <span>{zoneLabel(z.zone)}</span>
                  </span>
                  <div
                    className="zone-priorities__bar"
                    title={
                      cov === null
                        ? ''
                        : `${z.count} en attente · ${cov} place${cov > 1 ? 's' : ''} planifiée${cov > 1 ? 's' : ''}`
                    }
                  >
                    <div
                      className="zone-priorities__bar-demand"
                      style={{ width: `${demandPct}%` }}
                    >
                      <div
                        className="zone-priorities__bar-covered"
                        style={{ width: `${coveredFraction * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="zone-priorities__count">{z.count}</span>
                  <span
                    className={
                      'zone-priorities__pill zone-priorities__pill--' + status
                    }
                    onMouseEnter={(e) =>
                      z.orders.length > 0 &&
                      openZoneTip(z.orders, e.currentTarget)
                    }
                    onMouseLeave={scheduleCloseZoneTip}
                  >
                    {status === 'loading' && '…'}
                    {status === 'covered' && '✓ couvert'}
                    {status === 'none' && 'à planifier'}
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        {zonePriorities &&
          zonePriorities.unknown > 0 &&
          zonePriorities.rows.length > 0 && (
            <p className="zone-priorities__note">
              + {zonePriorities.unknown} commande(s) sans zone définie
            </p>
          )}
        </div>
        </div>
      </section>

      {zoneTip &&
        createPortal(
          <div
            className="zone-tip"
            style={{ top: zoneTip.top, left: zoneTip.left }}
            onMouseEnter={cancelCloseZoneTip}
            onMouseLeave={scheduleCloseZoneTip}
          >
            <div className="zone-tip__title">
              {zoneTip.orders.length} commande
              {zoneTip.orders.length > 1 ? 's' : ''} en attente
            </div>
            <div className="zone-tip__orders">
              {zoneTip.orders.map((o) =>
                o.adminUrl ? (
                  <a
                    key={o.name}
                    href={o.adminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="zone-tip__order"
                  >
                    {o.name}
                  </a>
                ) : (
                  <span key={o.name} className="zone-tip__order">
                    {o.name}
                  </span>
                )
              )}
            </div>
          </div>,
          document.body
        )}

      <SlotModal
        open={!!editing}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(notify) => {
          setEditing(null)
          load()
          refreshPriorities()
          if (notify) {
            setNotifyToast(notify)
            setTimeout(() => setNotifyToast(null), 8000)
          }
        }}
        onChanged={() => {
          load()
          refreshPriorities()
        }}
      />

      {notifyToast && (
        <div
          className={`plani-toast ${notifyToast.error ? 'plani-toast--error' : notifyToast.sent > 0 ? 'plani-toast--success' : 'plani-toast--info'}`}
          role="status"
        >
          {notifyToast.error ? (
            <>
              <strong>Notification email échouée :</strong> {notifyToast.error}
            </>
          ) : notifyToast.sent > 0 ? (
            <>
              <strong>✓ {notifyToast.sent} email{notifyToast.sent > 1 ? 's' : ''} envoyé{notifyToast.sent > 1 ? 's' : ''}</strong>
              {' '}aux clients en attente sur cette zone.
              {notifyToast.failed > 0 && ` (${notifyToast.failed} échec${notifyToast.failed > 1 ? 's' : ''})`}
            </>
          ) : (
            <>Aucun client en attente sur cette zone — aucun email envoyé.</>
          )}
          <button
            className="plani-toast__close"
            type="button"
            onClick={() => setNotifyToast(null)}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
