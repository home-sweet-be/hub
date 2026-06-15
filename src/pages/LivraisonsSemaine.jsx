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
  const [days, setDays] = useState(null)
  const [error, setError] = useState(null)
  const { reloadKey } = useReload()

  const load = useCallback(async () => {
    setDays(null)
    setError(null)
    try {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const horizon = new Date(start)
      horizon.setDate(horizon.getDate() + 7)

      const { data: slots, error: slotErr } = await supabase
        .from('delivery_slots')
        .select('id, starts_at, ends_at, zones, capacity')
        .gte('starts_at', start.toISOString())
        .lt('starts_at', horizon.toISOString())
        .order('starts_at', { ascending: true })
      if (slotErr) throw slotErr

      if (!slots?.length) {
        setDays([])
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
        setDays([])
        return
      }

      const names = [...new Set(bookings.map((b) => b.shopify_order_name))]
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

      const slotMap = new Map(slots.map((s) => [s.id, s]))
      const entries = bookings
        .map((b) => {
          const slot = slotMap.get(b.slot_id)
          if (!slot) return null
          const order = ordersByName.get(
            String(b.shopify_order_name).replace(/^#/, '')
          )
          return { booking: b, slot, order }
        })
        .filter(Boolean)

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
          items: d.items.sort(
            (a, b) => new Date(a.slot.starts_at) - new Date(b.slot.starts_at)
          ),
        }))
        .sort((a, b) => a.date - b.date)

      setDays(grouped)
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  if (error) {
    return <div className="semaine__error">Erreur : {error}</div>
  }
  if (days === null) {
    return <div className="semaine__loading">Chargement des livraisons…</div>
  }
  if (days.length === 0) {
    return (
      <div className="semaine__empty">
        <h3>Aucune livraison planifiée</h3>
        <p>
          Personne n'a réservé de créneau dans les 7 prochains jours. Va dans
          l'onglet <strong>Planifier</strong> pour ouvrir de nouveaux créneaux.
        </p>
      </div>
    )
  }

  const totalCount = days.reduce((s, d) => s + d.items.length, 0)

  return (
    <div className="semaine">
      <div className="semaine__header">
        <div className="semaine__summary">
          <span className="semaine__summary-count">{totalCount}</span>
          <span className="semaine__summary-label">
            livraison{totalCount > 1 ? 's' : ''} sur les 7 prochains jours
          </span>
        </div>
        <a
          href="https://admin.shopify.com/store/homesweetbe/apps/easyroutes"
          target="_blank"
          rel="noopener noreferrer"
          className="semaine__easyroutes"
          title="Ouvrir EasyRoutes"
        >
          <img src="/btn%20easy%20routes.jpg" alt="EasyRoutes" />
        </a>
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
    </div>
  )
}
