import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import SlotModal from '../components/SlotModal'

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

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

export default function Livraisons() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [slots, setSlots] = useState(null)
  const [bookings, setBookings] = useState({})
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)

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
  }, [load])

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
            onClick={() => setWeekStart(startOfWeek(new Date()))}
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
        <button
          type="button"
          className="btn btn--blue"
          onClick={() => setEditing({ day: new Date() })}
        >
          + Créer un créneau
        </button>
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
                <span className="livraisons__day-name">{DAY_LABELS[i]}</span>
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

      <SlotModal
        open={!!editing}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
    </div>
  )
}
