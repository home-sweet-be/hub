import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ZoneFlag, zoneCode } from '../components/ZoneFlag'
import { useReload } from '../lib/reload'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

function extractZone(order) {
  const find = (tags) => (tags || []).find((t) => ZONE_TAG_PATTERN.test(t))
  return find(order?.tags) || find(order?.customer?.tags) || null
}

function effectiveQty(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

function activeLineItems(order) {
  if (!order) return []
  return order.lineItems.filter((li) => effectiveQty(li) > 0)
}

function shippingTier(title) {
  if (!title) return 'standard'
  if (/premium/i.test(title)) return 'premium'
  if (/confort/i.test(title)) return 'confort'
  return 'standard'
}

const TIER_LABEL = {
  standard: 'Standard',
  confort: 'Confort',
  premium: 'Premium',
}

function ymdLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayLabel(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (ymdLocal(date) === ymdLocal(today)) return "Aujourd'hui"
  if (ymdLocal(date) === ymdLocal(tomorrow)) return 'Demain'
  return date.toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function customerName(c) {
  if (!c) return ''
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
}

function formatAddress(a) {
  if (!a) return ''
  return [a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
}

export default function LivraisonsSemaine() {
  const [tab, setTab] = useState('prochaines')
  // Un seul état qui mémorise à quel onglet/refresh le résultat correspond, pour
  // pouvoir dériver `loading` sans jamais faire de setState synchrone dans
  // l'effet (règle react-hooks/set-state-in-effect).
  const [result, setResult] = useState({ tab: null, key: null, days: null, error: null })
  const { reloadKey } = useReload()

  const load = useCallback(async (which, key) => {
    const isPast = which === 'passees'
    const done = (patch) => setResult({ tab: which, key, days: null, error: null, ...patch })
    try {
      let slots, slotErr
      if (isPast) {
        // Livraisons déjà terminées (créneau clos), les plus récentes d'abord.
        ;({ data: slots, error: slotErr } = await supabase
          .from('delivery_slots')
          .select('id, starts_at, ends_at, zones, capacity')
          .lt('ends_at', new Date().toISOString())
          .order('starts_at', { ascending: false })
          .limit(60))
      } else {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        const horizon = new Date(start)
        horizon.setDate(horizon.getDate() + 7)
        ;({ data: slots, error: slotErr } = await supabase
          .from('delivery_slots')
          .select('id, starts_at, ends_at, zones, capacity')
          .gte('starts_at', start.toISOString())
          .lt('starts_at', horizon.toISOString())
          .order('starts_at', { ascending: true }))
      }
      if (slotErr) throw slotErr

      if (!slots?.length) {
        done({ days: [] })
        return
      }

      const slotIds = slots.map((s) => s.id)
      const { data: bookings, error: bkErr } = await supabase
        .from('delivery_bookings')
        .select('id, slot_id, shopify_order_name, monte_charge_required, status, created_at')
        .in('slot_id', slotIds)
        .eq('status', 'confirmed')
      if (bkErr) throw bkErr

      if (!bookings?.length) {
        done({ days: [] })
        return
      }

      const slotMap = new Map(slots.map((s) => [s.id, s]))

      // Associe chaque réservation à son créneau, puis restreint à ce que
      // l'onglet actif doit montrer.
      let paired = bookings
        .map((b) => {
          const slot = slotMap.get(b.slot_id)
          return slot ? { booking: b, slot } : null
        })
        .filter(Boolean)

      if (isPast) {
        // Les 10 dernières livraisons, ordre anté-chronologique.
        paired.sort(
          (a, b) => new Date(b.slot.starts_at) - new Date(a.slot.starts_at)
        )
        paired = paired.slice(0, 10)
      } else {
        // Hide a delivery 2h after its slot end time (not just once the day is
        // over) — a morning slot drops off the list in the early afternoon.
        const hideBefore = Date.now() - 2 * 60 * 60 * 1000
        paired = paired.filter(
          (p) => new Date(p.slot.ends_at).getTime() >= hideBefore
        )
      }

      if (!paired.length) {
        done({ days: [] })
        return
      }

      // Ne récupère les commandes Shopify que pour les réservations conservées.
      const names = [...new Set(paired.map((p) => p.booking.shopify_order_name))]
      const q = names.map((n) => `name:${n.replace(/^#/, '')}`).join(' OR ')
      const r = await fetch(
        `/api/shopify/receptions?q=${encodeURIComponent(q)}&first=100`
      )
      if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
      const orderData = await r.json()
      const ordersByName = new Map()
      for (const o of orderData.orders || []) {
        ordersByName.set(String(o.name).replace(/^#/, ''), o)
      }

      const entries = paired.map((p) => ({
        ...p,
        order: ordersByName.get(
          String(p.booking.shopify_order_name).replace(/^#/, '')
        ),
      }))

      const byDay = new Map()
      for (const e of entries) {
        const date = new Date(e.slot.starts_at)
        const key = ymdLocal(date)
        if (!byDay.has(key)) {
          const d = new Date(date)
          d.setHours(0, 0, 0, 0)
          byDay.set(key, { date: d, items: [] })
        }
        byDay.get(key).items.push(e)
      }

      const grouped = [...byDay.values()]
        .map((d) => ({
          ...d,
          items: d.items.sort((a, b) =>
            isPast
              ? new Date(b.slot.starts_at) - new Date(a.slot.starts_at)
              : new Date(a.slot.starts_at) - new Date(b.slot.starts_at)
          ),
        }))
        .sort((a, b) => (isPast ? b.date - a.date : a.date - b.date))

      done({ days: grouped })
    } catch (e) {
      done({ error: e.message || String(e) })
    }
  }, [])

  useEffect(() => {
    load(tab, reloadKey)
  }, [load, tab, reloadKey])

  const isPast = tab === 'passees'
  // Le résultat courant n'est fiable que s'il correspond à l'onglet + refresh
  // actifs ; sinon on est en cours de (re)chargement.
  const loading = result.tab !== tab || result.key !== reloadKey
  const days = loading ? null : result.days
  const error = loading ? null : result.error

  const subtabs = (
    <div className="semaine__subtabs">
      <button
        type="button"
        className={`semaine__subtab${!isPast ? ' is-active' : ''}`}
        onClick={() => setTab('prochaines')}
      >
        Prochaines
      </button>
      <button
        type="button"
        className={`semaine__subtab${isPast ? ' is-active' : ''}`}
        onClick={() => setTab('passees')}
      >
        Passées
      </button>
    </div>
  )

  let content
  if (error) {
    content = <div className="semaine__error">Erreur : {error}</div>
  } else if (days === null) {
    content = <div className="semaine__loading">Chargement des livraisons…</div>
  } else if (days.length === 0) {
    content = isPast ? (
      <div className="semaine__empty">
        <h3>Aucune livraison passée</h3>
        <p>Aucune livraison n'a encore été effectuée.</p>
      </div>
    ) : (
      <div className="semaine__empty">
        <h3>Aucune livraison planifiée</h3>
        <p>
          Personne n'a réservé de créneau dans les 7 prochains jours. Va dans
          l'onglet <strong>Planifier</strong> pour ouvrir de nouveaux créneaux.
        </p>
      </div>
    )
  } else {
    const totalCount = days.reduce((s, d) => s + d.items.length, 0)
    content = (
      <>
        <div className="semaine__header">
          <div className="semaine__summary">
            <span className="semaine__summary-count">{totalCount}</span>
            <span className="semaine__summary-label">
              {isPast
                ? `dernière${totalCount > 1 ? 's' : ''} livraison${
                    totalCount > 1 ? 's' : ''
                  }`
                : `livraison${totalCount > 1 ? 's' : ''} sur les 7 prochains jours`}
            </span>
          </div>
          {!isPast && (
            <a
              href="https://admin.shopify.com/store/homesweetbe/apps/easyroutes"
              target="_blank"
              rel="noopener noreferrer"
              className="semaine__easyroutes"
              title="Ouvrir EasyRoutes"
            >
              <img src="/btn%20easy%20routes.jpg" alt="EasyRoutes" />
            </a>
          )}
        </div>

        {days.map((day) => (
        <section key={ymdLocal(day.date)} className="semaine__day">
          <header className="semaine__day-head">
            <h2 className="semaine__day-title">{dayLabel(day.date)}</h2>
            <span className="semaine__day-count">
              {day.items.length} livraison{day.items.length > 1 ? 's' : ''}
            </span>
          </header>

          <div className="semaine__cards">
            {day.items.map(({ booking, slot, order }) => {
              const zone = order ? extractZone(order) : null
              const tier = shippingTier(order?.shippingLine?.title)
              const items = activeLineItems(order)
              const name = customerName(order?.customer)
              return (
                <article
                  key={booking.id}
                  className={`semaine__card semaine__card--${tier}${
                    booking.monte_charge_required ? ' semaine__card--mc' : ''
                  }`}
                >
                  <aside className="semaine__time">
                    <div className="semaine__time-start">
                      {fmtTime(slot.starts_at)}
                    </div>
                    <div className="semaine__time-sep">→</div>
                    <div className="semaine__time-end">
                      {fmtTime(slot.ends_at)}
                    </div>
                  </aside>

                  <div className="semaine__col semaine__col--id">
                    <div className="semaine__tags">
                      <span className={`semaine__tier semaine__tier--${tier}`}>
                        {TIER_LABEL[tier]}
                      </span>
                      {booking.monte_charge_required && (
                        <span className="semaine__badge semaine__badge--mc">
                          🛗 Monte-charges
                        </span>
                      )}
                      {zone && (
                        <span className="semaine__zone">
                          <ZoneFlag code={zoneCode(zone)} />
                          <span>{zone.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')}</span>
                        </span>
                      )}
                    </div>
                    <span className="semaine__customer">{name || '—'}</span>
                    {order?.shippingAddress && (
                      <div className="semaine__address">
                        <span aria-hidden="true">📍</span>
                        <span>{formatAddress(order.shippingAddress)}</span>
                      </div>
                    )}
                  </div>

                  <div className="semaine__col semaine__col--product">
                    {items.length > 0 && (
                      <ul className="semaine__items">
                        {items.map((li) => (
                          <li key={li.id} className="semaine__item">
                            {li.image?.url ? (
                              <img
                                src={li.image.url}
                                alt=""
                                className="semaine__item-img"
                                loading="lazy"
                              />
                            ) : (
                              <div className="semaine__item-img semaine__item-img--placeholder" />
                            )}
                            <div className="semaine__item-info">
                              <div className="semaine__item-title">
                                <span className="semaine__item-qty">
                                  {effectiveQty(li)}×
                                </span>{' '}
                                {li.title}
                              </div>
                              {li.variantTitle && (
                                <div className="semaine__item-variant">
                                  {li.variantTitle}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="semaine__col semaine__col--side">
                    {order?.adminUrl ? (
                      <a
                        href={order.adminUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="semaine__order"
                        title="Ouvrir dans Shopify"
                      >
                        {order.name}
                      </a>
                    ) : (
                      <span className="semaine__order">
                        {booking.shopify_order_name}
                      </span>
                    )}

                    <div className="semaine__contact">
                      {order?.email && (
                        <a href={`mailto:${order.email}`} className="semaine__chip">
                          ✉️ {order.email}
                        </a>
                      )}
                      {order?.phone && (
                        <a href={`tel:${order.phone}`} className="semaine__chip">
                          📞 {order.phone}
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
        ))}
      </>
    )
  }

  return (
    <div className="semaine">
      {subtabs}
      {content}
    </div>
  )
}
