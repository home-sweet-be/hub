import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const DAY_LABELS_BY_DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MONTH_LABELS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

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

function fmtTime(date) {
  return date.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

function fmtFullDate(d) {
  return `${DAY_LABELS_BY_DOW[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`
}

function isPast(date) {
  return date.getTime() < Date.now()
}

function zoneLabel(z) {
  if (z === 'LU') return 'Luxembourg'
  return z.replace(/^[A-Z]{2}-/, '').replace(/^LIV-/, '').replace(/-/g, ' ')
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const SHIPPING_TERMS_URL = 'https://home-sweet.be/pages/livraison'

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 17V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" />
      <path d="M14 17H9" />
      <path d="M19 17h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.22-.62l-3.5-4.4A1 1 0 0 0 17.5 7H14" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </svg>
  )
}
function PorterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="4" r="2" />
      <path d="M8 6v6" />
      <path d="M5 21l3-9 3 9" />
      <rect x="12" y="7" width="9" height="7" rx="1" />
      <path d="M12 10.5h9" />
    </svg>
  )
}
function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a3.5 3.5 0 0 0 4 4l-1.8 1.8L20 15.2a2 2 0 1 1-2.8 2.8L14 14.8l-1.8 1.8a3.5 3.5 0 0 0-4-4z" />
    </svg>
  )
}

const SHIPPING_DETAILS = {
  standard: {
    label: 'Standard',
    icons: [<TruckIcon key="t" />],
    body: (
      <>
        Votre article est livré <strong>au pied du camion</strong>, devant
        chez vous.
      </>
    ),
    needsTerms: false,
  },
  confort: {
    label: 'Confort',
    icons: [<TruckIcon key="t" />, <PorterIcon key="p" />],
    body: (
      <>
        Nos livreurs <strong>déposent l'article dans la pièce de votre
        choix</strong>, au rez-de-chaussée ou à l'étage.
      </>
    ),
    needsTerms: true,
  },
  premium: {
    label: 'Premium',
    icons: [<TruckIcon key="t" />, <PorterIcon key="p" />, <ToolsIcon key="w" />],
    body: (
      <>
        Nos livreurs livrent dans la pièce de votre choix,{' '}
        <strong>déballent et installent</strong> votre article.
      </>
    ),
    needsTerms: true,
  },
}

function shippingTierKey(title) {
  if (!title) return null
  if (/premium/i.test(title)) return 'premium'
  if (/confort/i.test(title)) return 'confort'
  if (/standard/i.test(title)) return 'standard'
  return 'other'
}

export default function PlanificationLivraison() {
  const [step, setStep] = useState('auth') // auth | pick | done
  const [orderName, setOrderName] = useState('')
  const [email, setEmail] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [order, setOrder] = useState(null)

  const [weekStart, setWeekStart] = useState(() => startOfToday())
  const [slots, setSlots] = useState(null)
  const [bookings, setBookings] = useState({})
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState(null)

  const [selectedSlot, setSelectedSlot] = useState(null)
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState(null)

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  // Iframe auto-resize: notify parent of height changes
  useEffect(() => {
    if (window === window.parent) return // not iframed
    const post = () => {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      )
      try {
        window.parent.postMessage(
          { type: 'homesweet:plani-height', height: h },
          '*'
        )
      } catch {
        // ignore
      }
    }
    post()
    const ro = new ResizeObserver(post)
    ro.observe(document.body)
    window.addEventListener('load', post)
    return () => {
      ro.disconnect()
      window.removeEventListener('load', post)
    }
  }, [])

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
            "Aucune commande trouvée avec ce numéro et cet e-mail. Vérifiez l'orthographe ou contactez-nous.",
          not_ready:
            "Cette commande n'est pas encore prête à être livrée. Vous recevrez un nouvel e-mail dès qu'elle le sera.",
          no_zone:
            "Impossible de déterminer la zone de livraison pour cette commande. Contactez-nous à contact@home-sweet.be.",
          missing_fields: 'Merci de remplir les deux champs.',
        }
        // eslint-disable-next-line no-console
        console.warn('verify-order not ok:', data)
        setAuthError(
          map[data?.code] ||
            `Une erreur est survenue${data?.code ? ` (${data.code})` : ''}. Réessayez ou contactez-nous.`
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

  // ---- Step 2: load ALL upcoming slots for this zone (once per order) ----
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
          .gte('starts_at', new Date().toISOString())
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
  }, [step, order])

  const totalAvailable = useMemo(() => {
    if (!slots) return 0
    return slots.filter(
      (s) => !isPast(new Date(s.starts_at)) && (bookings[s.id] || 0) < s.capacity
    ).length
  }, [slots, bookings])

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
        shopify_order_name: order.name.replace(/^#/, ''),
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
      <main className="plani__main">
        {step === 'auth' && (
          <section className="plani__card">
            <h1 className="plani__title">Planifiez votre livraison</h1>
            <p className="plani__lead">
              Votre commande est prête ! Renseignez votre numéro et votre
              e-mail pour choisir un créneau de livraison.
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
              Besoin d'aide ? Écrivez-nous à{' '}
              <a href="mailto:contact@home-sweet.be">contact@home-sweet.be</a>.
            </p>
          </section>
        )}

        {step === 'pick' && order && (
          <section className="plani__card plani__card--wide">
            <div className="plani__pick-layout">
            <aside className="plani__pick-recap">
              <div className="plani__order-recap plani__order-recap--stack">
                <div className="plani__recap-top">
                  <div>
                    <div className="plani__recap-label">Commande</div>
                    <div className="plani__recap-value">{order.name}</div>
                  </div>
                  <div>
                    <div className="plani__recap-label">Zone</div>
                    <div className="plani__recap-value">{zoneLabel(order.zone)}</div>
                  </div>
                </div>
                <div>
                  <div className="plani__recap-label">Adresse de livraison</div>
                  <div className="plani__recap-value">{order.address}</div>
                  {MAPBOX_TOKEN && order.lat && order.lon && (
                    <img
                      className="plani__recap-map"
                      src={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+ea4335(${order.lon},${order.lat})/${order.lon},${order.lat},14/520x280@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`}
                      alt={`Carte de l'adresse de livraison`}
                      loading="lazy"
                    />
                  )}
                </div>
                {order.shippingLine && (() => {
                  const tier = shippingTierKey(order.shippingLine)
                  const details = SHIPPING_DETAILS[tier]
                  return (
                    <div>
                      <div className="plani__recap-label">Type de livraison</div>
                      <div className="plani__shipping-details">
                        <span
                          className={
                            'reception-shipping__chip is-' +
                            (tier || 'standard')
                          }
                          title={order.shippingLine}
                        >
                          <span className="reception-shipping__label">
                            {details?.label || order.shippingLine}
                          </span>
                          {details?.icons?.length > 0 && (
                            <span className="reception-shipping__icons">
                              {details.icons.map((icon, i) => (
                                <span key={i} className="reception-shipping__icon">
                                  {icon}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        {details && (
                          <>
                            <p className="plani__shipping-details-body">
                              {details.body}
                            </p>
                            {details.needsTerms && (
                              <p className="plani__shipping-details-warn">
                                <strong>Important</strong> · si vous habitez en
                                étage sans ascenseur conforme aux dimensions
                                minimales, consultez les{' '}
                                <a
                                  href={SHIPPING_TERMS_URL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  conditions de livraison en logement
                                </a>
                                .
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </aside>
            <div className="plani__pick-main">

            <div className="plani__step-header">
              <h2 className="plani__step-title">Choisissez un créneau</h2>
              {!loadingSlots && (
                <span className="plani__available-count">
                  {totalAvailable}{' '}
                  créneau{totalAvailable > 1 ? 'x' : ''} disponible
                  {totalAvailable > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {!loadingSlots && totalAvailable === 0 && (
              <div className="plani__no-slots">
                <div className="plani__no-slots-icon" aria-hidden="true">
                  📭
                </div>
                <div className="plani__no-slots-title">
                  Aucun créneau actuellement disponible sur la zone{' '}
                  <strong>{zoneLabel(order.zone)}</strong>.
                </div>
                <div className="plani__no-slots-sub">
                  De nouveaux créneaux sont ajoutés chaque semaine — reviens
                  bientôt ou écris-nous à{' '}
                  <a href="mailto:contact@home-sweet.be">contact@home-sweet.be</a>.
                </div>
              </div>
            )}

            {totalAvailable > 0 && (
              <div className="plani__week-nav">
                <button
                  type="button"
                  className="plani__nav-btn"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                  disabled={weekStart <= startOfToday()}
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
            )}

            {slotsError && <div className="plani__error">{slotsError}</div>}

            <div
              className="plani__week"
              style={totalAvailable === 0 ? { display: 'none' } : undefined}
            >
              {days.map((d, i) => {
                const list = slotsByDay.get(ymdLocal(d)) || []
                return (
                  <div key={i} className="plani__day">
                    <header className="plani__day-head">
                      <span className="plani__day-name">{DAY_LABELS_BY_DOW[d.getDay()]}</span>
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

            {totalAvailable > 0 && (
              <aside className="plani__note">
                <div className="plani__note-row">
                  <span aria-hidden="true">📝</span>
                  <span>
                    Les <strong>horaires sont larges</strong> pour couvrir
                    les imprévus et le trafic — rendez-vous disponible
                    durant tout le créneau pour ne pas manquer votre
                    livraison.
                  </span>
                </div>
                <div className="plani__note-row">
                  <span aria-hidden="true">📧</span>
                  <span>
                    Vous recevrez en temps réel un e-mail pour suivre la
                    position de votre livreur.
                  </span>
                </div>
              </aside>
            )}

            {totalAvailable > 0 && (
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
                        Sélectionnez un créneau pour continuer
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
            )}
            </div>
            </div>
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
            <h1 className="plani__title">Livraison planifiée</h1>
            <p className="plani__lead">
              Livraison prévue le{' '}
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
              {MAPBOX_TOKEN && order.lat && order.lon ? (
                <img
                  className="plani__done-map"
                  src={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+ea4335(${order.lon},${order.lat})/${order.lon},${order.lat},14/520x280@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`}
                  alt="Carte de l'adresse de livraison"
                  loading="lazy"
                />
              ) : (
                <div />
              )}
              <div>
                <div className="plani__recap-label">Adresse</div>
                <div className="plani__recap-value">{order.address}</div>
              </div>
            </div>
            <p className="plani__help">
              Un e-mail de confirmation va vous être envoyé. Pour toute
              question, écrivez-nous à{' '}
              <a href="mailto:contact@home-sweet.be">contact@home-sweet.be</a>.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
