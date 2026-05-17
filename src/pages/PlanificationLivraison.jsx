import { useEffect, useMemo, useState } from 'react'
import logo from '../assets/homesweet.png'
import { supabase } from '../lib/supabase'

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTH_LABELS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
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

function fmtTime(date) {
  return date.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

function fmtFullDate(d) {
  return `${DAY_LABELS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`
}

function isPast(date) {
  return date.getTime() < Date.now()
}

function zoneLabel(z) {
  if (z === 'LU') return 'Luxembourg'
  return z.replace(/^[A-Z]{2}-/, '').replace(/^LIV-/, '').replace(/-/g, ' ')
}

export default function PlanificationLivraison() {
  const [step, setStep] = useState('auth') // auth | pick | done
  const [orderName, setOrderName] = useState('')
  const [email, setEmail] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [order, setOrder] = useState(null)

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [slots, setSlots] = useState(null)
  const [bookings, setBookings] = useState({})
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState(null)

  const [selectedSlot, setSelectedSlot] = useState(null)
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState(null)

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  // ---- Step 1: verify order ----
  const submitAuth = async (e) => {
    e?.preventDefault?.()
    if (verifying) return
    setAuthError(null)
    setVerifying(true)
    try {
      const r = await fetch('/api/shopify/verify-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderName, email }),
      })
      let data = null
      try {
        data = await r.json()
      } catch {
        data = null
      }
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error('verify-order error:', r.status, data)
        const detail =
          data?.error || data?.message || `HTTP ${r.status}`
        setAuthError(`Erreur serveur — ${detail}`)
        return
      }
      if (!data?.ok) {
        const map = {
          not_found:
            "Aucune commande trouvée avec ce numéro et cet e-mail. Vérifie l'orthographe ou contacte-nous.",
          not_ready:
            "Cette commande n'est pas encore prête à être livrée. Tu recevras un nouvel e-mail dès qu'elle le sera.",
          no_zone:
            "Impossible de déterminer la zone de livraison pour cette commande. Contacte-nous à contact@homesweet.be.",
          missing_fields: 'Merci de remplir les deux champs.',
        }
        // eslint-disable-next-line no-console
        console.warn('verify-order not ok:', data)
        setAuthError(
          map[data?.code] ||
            `Une erreur est survenue${data?.code ? ` (${data.code})` : ''}. Réessaie ou contacte-nous.`
        )
        return
      }
      setOrder(data.order)
      setStep('pick')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('verify-order network:', err)
      setAuthError(err.message || 'Erreur réseau, réessaie.')
    } finally {
      setVerifying(false)
    }
  }

  // ---- Step 2: load slots for the visible week, filtered by zone ----
  useEffect(() => {
    if (step !== 'pick' || !order) return
    let cancelled = false
    const load = async () => {
      setLoadingSlots(true)
      setSlotsError(null)
      try {
        const { data: slotData, error } = await supabase
          .from('delivery_slots')
          .select('*')
          .gte('starts_at', weekStart.toISOString())
          .lt('starts_at', weekEnd.toISOString())
          .contains('zones', [order.zone])
          .order('starts_at', { ascending: true })
        if (error) throw error
        if (cancelled) return
        setSlots(slotData || [])
        if (slotData && slotData.length) {
          const ids = slotData.map((s) => s.id)
          const { data: bks } = await supabase
            .from('delivery_bookings')
            .select('slot_id, status')
            .in('slot_id', ids)
            .eq('status', 'confirmed')
          if (cancelled) return
          const map = {}
          ;(bks || []).forEach((b) => {
            map[b.slot_id] = (map[b.slot_id] || 0) + 1
          })
          setBookings(map)
        } else {
          setBookings({})
        }
      } catch (e) {
        if (!cancelled) setSlotsError(e.message || String(e))
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [step, order, weekStart, weekEnd])

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
      const startD = new Date(s.starts_at)
      if (isPast(startD)) continue
      const k = ymdLocal(startD)
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

  // ---- Step 3: confirm booking ----
  const confirmBooking = async () => {
    if (!selectedSlot || booking) return
    setBooking(true)
    setBookingError(null)
    try {
      const { error } = await supabase.from('delivery_bookings').insert({
        slot_id: selectedSlot.id,
        shopify_order_id: order.id,
        shopify_order_name: order.name,
        customer_email: order.email,
        customer_name: order.customerName,
        address: order.address,
        zone: order.zone,
        status: 'confirmed',
      })
      if (error) throw error
      setStep('done')
    } catch (e) {
      setBookingError(e.message || String(e))
    } finally {
      setBooking(false)
    }
  }

  return (
    <div className="plani">
      <div className="plani__bg" aria-hidden="true" />

      <header className="plani__header">
        <img src={logo} alt="HOMESWEET BRUXELLES" className="plani__logo" />
      </header>

      <main className="plani__main">
        {step === 'auth' && (
          <section className="plani__card">
            <h1 className="plani__title">Planifie ta livraison</h1>
            <p className="plani__lead">
              Ta commande est prête ! Renseigne ton numéro et ton e-mail pour
              choisir un créneau de livraison.
            </p>
            <form className="plani__form" onSubmit={submitAuth}>
              <label className="plani__field">
                <span>Numéro de commande</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="1234"
                  value={orderName}
                  onChange={(e) => setOrderName(e.target.value)}
                  disabled={verifying}
                  required
                />
              </label>
              <label className="plani__field">
                <span>E-mail utilisé pour la commande</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="prenom@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={verifying}
                  required
                />
              </label>
              {authError && <div className="plani__error">{authError}</div>}
              <button
                type="submit"
                className="plani__cta"
                disabled={verifying || !orderName || !email}
              >
                {verifying ? 'Vérification…' : 'Continuer'}
              </button>
            </form>
            <p className="plani__help">
              Besoin d'aide ? Écris-nous à{' '}
              <a href="mailto:contact@homesweet.be">contact@homesweet.be</a>.
            </p>
          </section>
        )}

        {step === 'pick' && order && (
          <section className="plani__card plani__card--wide">
            <div className="plani__order-recap">
              <div>
                <div className="plani__recap-label">Commande</div>
                <div className="plani__recap-value">{order.name}</div>
              </div>
              <div>
                <div className="plani__recap-label">Adresse de livraison</div>
                <div className="plani__recap-value">{order.address}</div>
              </div>
              <div>
                <div className="plani__recap-label">Zone</div>
                <div className="plani__recap-value">{zoneLabel(order.zone)}</div>
              </div>
            </div>

            <h2 className="plani__step-title">Choisis un créneau</h2>

            <div className="plani__week-nav">
              <button
                type="button"
                className="plani__nav-btn"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                disabled={weekStart <= startOfWeek(new Date())}
                aria-label="Semaine précédente"
              >
                ‹
              </button>
              <div className="plani__week-label">{weekLabel}</div>
              <button
                type="button"
                className="plani__nav-btn"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                aria-label="Semaine suivante"
              >
                ›
              </button>
            </div>

            {slotsError && <div className="plani__error">{slotsError}</div>}

            <div className="plani__week">
              {days.map((d, i) => {
                const list = slotsByDay.get(ymdLocal(d)) || []
                return (
                  <div key={i} className="plani__day">
                    <header className="plani__day-head">
                      <span className="plani__day-name">{DAY_LABELS[i]}</span>
                      <span className="plani__day-date">{d.getDate()}</span>
                    </header>
                    <div className="plani__day-slots">
                      {loadingSlots && <div className="plani__skeleton" />}
                      {!loadingSlots && list.length === 0 && (
                        <div className="plani__day-empty">—</div>
                      )}
                      {!loadingSlots &&
                        list.map((s) => {
                          const startD = new Date(s.starts_at)
                          const endD = new Date(s.ends_at)
                          const used = bookings[s.id] || 0
                          const full = used >= s.capacity
                          const active = selectedSlot?.id === s.id
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={
                                'plani__slot' +
                                (full ? ' is-full' : '') +
                                (active ? ' is-active' : '')
                              }
                              disabled={full}
                              onClick={() => setSelectedSlot(s)}
                            >
                              <div className="plani__slot-time">
                                {fmtTime(startD)} – {fmtTime(endD)}
                              </div>
                              {full && (
                                <div className="plani__slot-status">complet</div>
                              )}
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )
              })}
            </div>

            <footer className="plani__footer">
              {bookingError && (
                <div className="plani__error">{bookingError}</div>
              )}
              <div className="plani__footer-row">
                <div className="plani__selected">
                  {selectedSlot ? (
                    <>
                      <span className="plani__selected-label">Créneau choisi</span>
                      <span className="plani__selected-value">
                        {fmtFullDate(new Date(selectedSlot.starts_at))} ·{' '}
                        {fmtTime(new Date(selectedSlot.starts_at))} –{' '}
                        {fmtTime(new Date(selectedSlot.ends_at))}
                      </span>
                    </>
                  ) : (
                    <span className="plani__selected-empty">
                      Sélectionne un créneau pour continuer
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="plani__cta"
                  onClick={confirmBooking}
                  disabled={!selectedSlot || booking}
                >
                  {booking ? 'Confirmation…' : 'Confirmer la livraison'}
                </button>
              </div>
            </footer>
          </section>
        )}

        {step === 'done' && selectedSlot && order && (
          <section className="plani__card plani__card--done">
            <div className="plani__success">
              <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                <circle cx="32" cy="32" r="30" fill="#34c759" />
                <path
                  d="M19 33 l9 9 l17 -19"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="plani__title">Livraison planifiée !</h1>
            <p className="plani__lead">
              On se voit le{' '}
              <strong>
                {fmtFullDate(new Date(selectedSlot.starts_at))}
              </strong>{' '}
              entre{' '}
              <strong>
                {fmtTime(new Date(selectedSlot.starts_at))} et{' '}
                {fmtTime(new Date(selectedSlot.ends_at))}
              </strong>
              .
            </p>
            <div className="plani__done-recap">
              <div>
                <div className="plani__recap-label">Commande</div>
                <div className="plani__recap-value">{order.name}</div>
              </div>
              <div>
                <div className="plani__recap-label">Adresse</div>
                <div className="plani__recap-value">{order.address}</div>
              </div>
            </div>
            <p className="plani__help">
              Un e-mail de confirmation va t'être envoyé. Pour toute question,
              écris-nous à{' '}
              <a href="mailto:contact@homesweet.be">contact@homesweet.be</a>.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
