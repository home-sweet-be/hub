import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { ZONES_BY_COUNTRY } from './ZoneModal'
import ZoneMapPicker from './ZoneMapPicker'

function zoneLabel(z) {
  if (z === 'LU') return 'Luxembourg'
  if (z === 'LIV-Externe') return 'Externe'
  return z.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
}

const HOUR_MIN = 9
const HOUR_MAX = 22
const SLOT_MIN = HOUR_MIN * 60 // minutes from midnight
const SLOT_MAX = HOUR_MAX * 60
const SLOT_STEP = 15

const MONTH_LABELS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function ymdLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmd(str) {
  if (!str) return null
  return new Date(`${str}T00:00:00`)
}

function dateToMinutes(d) {
  return d.getHours() * 60 + d.getMinutes()
}

function minutesToHHMM(m) {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function buildIso(dayStr, minutes) {
  const d = parseYmd(dayStr)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d.toISOString()
}

/* ------------------------------------------------------------------ */
/*  Custom calendar date picker                                        */
/* ------------------------------------------------------------------ */
function CalendarPicker({ value, onChange, disabled }) {
  const selected = value ? parseYmd(value) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [viewMonth, setViewMonth] = useState(() => {
    const base = selected || today
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  useEffect(() => {
    if (!selected) return
    if (
      selected.getMonth() !== viewMonth.getMonth() ||
      selected.getFullYear() !== viewMonth.getFullYear()
    ) {
      setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const monthStart = viewMonth
  const firstDayOffset = (monthStart.getDay() + 6) % 7

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(monthStart)
    d.setDate(d.getDate() - firstDayOffset + i)
    cells.push(d)
  }

  const monthLabel = `${MONTH_LABELS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`

  const goPrev = () =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
  const goNext = () =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))

  return (
    <div className="cal">
      <div className="cal__head">
        <button
          type="button"
          className="cal__nav"
          onClick={goPrev}
          disabled={disabled}
          aria-label="Mois précédent"
        >
          ‹
        </button>
        <div className="cal__month">{monthLabel}</div>
        <button
          type="button"
          className="cal__nav"
          onClick={goNext}
          disabled={disabled}
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>
      <div className="cal__weekdays">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={i} className="cal__weekday">{d}</div>
        ))}
      </div>
      <div className="cal__grid">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth.getMonth()
          const sel = selected && ymdLocal(d) === ymdLocal(selected)
          const isToday = ymdLocal(d) === ymdLocal(today)
          return (
            <button
              key={i}
              type="button"
              className={
                'cal__day' +
                (inMonth ? '' : ' is-other-month') +
                (sel ? ' is-selected' : '') +
                (isToday ? ' is-today' : '')
              }
              onClick={() => onChange(ymdLocal(d))}
              disabled={disabled}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Draggable time range slider                                        */
/* ------------------------------------------------------------------ */
function TimeRangeSlider({ startMin, endMin, onChange, disabled }) {
  const trackRef = useRef(null)
  const [dragging, setDragging] = useState(null)

  const total = SLOT_MAX - SLOT_MIN
  const startPct = ((startMin - SLOT_MIN) / total) * 100
  const endPct = ((endMin - SLOT_MIN) / total) * 100

  const minutesAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const m = SLOT_MIN + pct * total
    return Math.round(m / SLOT_STEP) * SLOT_STEP
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      const m = minutesAt(e.clientX)
      if (dragging === 'start') {
        onChange(Math.max(SLOT_MIN, Math.min(m, endMin - SLOT_STEP)), endMin)
      } else {
        onChange(startMin, Math.min(SLOT_MAX, Math.max(m, startMin + SLOT_STEP)))
      }
    }
    const onUp = () => setDragging(null)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, startMin, endMin])

  const onTrackDown = (e) => {
    if (disabled) return
    const m = minutesAt(e.clientX)
    // Whichever handle is closer wins
    const distStart = Math.abs(m - startMin)
    const distEnd = Math.abs(m - endMin)
    const which = distStart < distEnd ? 'start' : 'end'
    if (which === 'start') {
      onChange(Math.max(SLOT_MIN, Math.min(m, endMin - SLOT_STEP)), endMin)
    } else {
      onChange(startMin, Math.min(SLOT_MAX, Math.max(m, startMin + SLOT_STEP)))
    }
    setDragging(which)
  }

  const hours = []
  for (let h = HOUR_MIN; h <= HOUR_MAX; h++) hours.push(h)

  return (
    <div className={'trs' + (disabled ? ' is-disabled' : '')}>
      <div
        ref={trackRef}
        className="trs__track"
        onPointerDown={onTrackDown}
      >
        <div className="trs__rail" />
        <div
          className="trs__fill"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        <div
          className={'trs__handle' + (dragging === 'start' ? ' is-dragging' : '')}
          style={{ left: `${startPct}%` }}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (!disabled) setDragging('start')
          }}
        >
          <div className="trs__bubble">{minutesToHHMM(startMin)}</div>
        </div>
        <div
          className={'trs__handle' + (dragging === 'end' ? ' is-dragging' : '')}
          style={{ left: `${endPct}%` }}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (!disabled) setDragging('end')
          }}
        >
          <div className="trs__bubble">{minutesToHHMM(endMin)}</div>
        </div>
      </div>
      <div className="trs__ticks">
        {hours.map((h) => (
          <div key={h} className="trs__tick">
            <span>{h}h</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Capacity quick-selector                                            */
/* ------------------------------------------------------------------ */
function CapacitySelector({ value, onChange, disabled, min = 1, max = 7 }) {
  return (
    <div className="caps">
      <div className="caps__chips">
        {Array.from({ length: max }, (_, i) => i + min).map((n) => {
          const active = n <= value
          return (
            <button
              key={n}
              type="button"
              className={'caps__chip' + (active ? ' is-active' : '')}
              onClick={() => onChange(n)}
              disabled={disabled}
              aria-label={`${n} place${n > 1 ? 's' : ''}`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4.418 3.582-7 8-7s8 2.582 8 7v1H4v-1z" />
              </svg>
            </button>
          )
        })}
      </div>
      <div className="caps__count">
        <strong>{value}</strong> place{value > 1 ? 's' : ''}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main modal                                                         */
/* ------------------------------------------------------------------ */
export default function SlotModal({ open, editing, onClose, onSaved }) {
  const [day, setDay] = useState('')
  const [startMin, setStartMin] = useState(10 * 60)
  const [endMin, setEndMin] = useState(18 * 60)
  const [capacity, setCapacity] = useState(4)
  const [zones, setZones] = useState(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setPending(false)
    if (editing?.slot) {
      const s = editing.slot
      const start = new Date(s.starts_at)
      const end = new Date(s.ends_at)
      setDay(ymdLocal(start))
      setStartMin(dateToMinutes(start))
      setEndMin(dateToMinutes(end))
      setCapacity(s.capacity)
      setZones(new Set(s.zones || []))
    } else {
      const d = editing?.day ? new Date(editing.day) : new Date()
      setDay(ymdLocal(d))
      setStartMin(10 * 60)
      setEndMin(18 * 60)
      setCapacity(4)
      setZones(new Set())
    }
  }, [open, editing])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && !pending && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, pending])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const toggleZone = (z) => {
    setZones((prev) => {
      const next = new Set(prev)
      if (next.has(z)) next.delete(z)
      else next.add(z)
      return next
    })
  }

  const setRange = (s, e) => {
    setStartMin(s)
    setEndMin(e)
  }

  const validate = () => {
    if (!day) return 'Date requise.'
    if (startMin >= endMin) return "L'heure de fin doit être après l'heure de début."
    if (capacity < 1 || capacity > 7) return 'Capacité entre 1 et 7.'
    if (zones.size === 0) return 'Sélectionne au moins une zone.'
    return null
  }

  const save = async () => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setError(null)
    setPending(true)
    try {
      const payload = {
        starts_at: buildIso(day, startMin),
        ends_at: buildIso(day, endMin),
        capacity,
        zones: [...zones],
        updated_at: new Date().toISOString(),
      }
      const res = editing?.slot
        ? await supabase
            .from('delivery_slots')
            .update(payload)
            .eq('id', editing.slot.id)
        : await supabase.from('delivery_slots').insert(payload)
      if (res.error) throw res.error
      onSaved?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setPending(false)
    }
  }

  const remove = async () => {
    if (!editing?.slot) return
    if (!confirm('Supprimer ce créneau ?')) return
    setPending(true)
    setError(null)
    try {
      const { error } = await supabase
        .from('delivery_slots')
        .delete()
        .eq('id', editing.slot.id)
      if (error) throw error
      onSaved?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setPending(false)
    }
  }

  return createPortal(
    <div
      className="zone-modal__backdrop"
      onClick={() => !pending && onClose?.()}
      role="presentation"
    >
      <div
        className="zone-modal__card slot-modal__card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="zone-modal__header">
          <h3>{editing?.slot ? 'Modifier le créneau' : 'Nouveau créneau'}</h3>
          <button
            type="button"
            className="zone-modal__close"
            onClick={onClose}
            disabled={pending}
          >
            ×
          </button>
        </header>

        <div className="zone-modal__body slot-modal__body">
          <div className="slot-modal__grid">
            <section className="slot-modal__section slot-modal__col--date">
              <div className="slot-modal__section-title">Date</div>
              <CalendarPicker
                value={day}
                onChange={setDay}
                disabled={pending}
              />
            </section>

            <section className="slot-modal__section slot-modal__col--zones">
              <div className="slot-modal__section-title">Zones desservies</div>
              <div className="slot-modal__zones-summary">
                {zones.size === 0 ? (
                  <span className="slot-modal__zones-empty">
                    Clique sur la carte pour sélectionner les zones.
                  </span>
                ) : (
                  <>
                    <strong>{zones.size}</strong>{' '}
                    zone{zones.size > 1 ? 's' : ''} : {[...zones].map(zoneLabel).join(', ')}
                  </>
                )}
              </div>
              <ZoneMapPicker
                selected={zones}
                onToggle={toggleZone}
                disabled={pending}
              />
              <button
                type="button"
                className={
                  'slot-modal__zone slot-modal__zone--extra' +
                  (zones.has('LIV-Externe') ? ' is-active' : '')
                }
                onClick={() => toggleZone('LIV-Externe')}
                disabled={pending}
              >
                + Externe (hors carte)
              </button>
            </section>

            <div className="slot-modal__col--right">
              <section className="slot-modal__section">
                <div className="slot-modal__section-title">Horaires</div>
                <TimeRangeSlider
                  startMin={startMin}
                  endMin={endMin}
                  onChange={setRange}
                  disabled={pending}
                />
              </section>

              <section className="slot-modal__section">
                <div className="slot-modal__section-title">Capacité</div>
                <CapacitySelector
                  value={capacity}
                  onChange={setCapacity}
                  disabled={pending}
                />
              </section>
            </div>
          </div>
        </div>

        {error && <div className="zone-modal__error">{error}</div>}

        <footer className="stock-modal__footer">
          {editing?.slot ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={remove}
              disabled={pending}
            >
              Supprimer
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="btn btn--blue"
            onClick={save}
            disabled={pending}
          >
            {pending
              ? 'Enregistrement…'
              : editing?.slot
              ? 'Enregistrer'
              : 'Créer le créneau'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
