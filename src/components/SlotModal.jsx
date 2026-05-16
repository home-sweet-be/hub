import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { ZONES_BY_COUNTRY } from './ZoneModal'

const COUNTRY_FLAG = { Belgique: 'BE', Luxembourg: 'LU', France: 'FR', Autre: null }
const HOUR_MIN = 9
const HOUR_MAX = 22

function ymdLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hhmm(d) {
  return d.toTimeString().slice(0, 5)
}

function buildIso(dayStr, hhmmStr) {
  // local datetime — JS parses YYYY-MM-DDTHH:mm as local, then toISOString → UTC
  return new Date(`${dayStr}T${hhmmStr}:00`).toISOString()
}

export default function SlotModal({ open, editing, onClose, onSaved }) {
  const [day, setDay] = useState('')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('18:00')
  const [capacity, setCapacity] = useState(4)
  const [zones, setZones] = useState(new Set())
  const [notes, setNotes] = useState('')
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
      setStartTime(hhmm(start))
      setEndTime(hhmm(end))
      setCapacity(s.capacity)
      setZones(new Set(s.zones || []))
      setNotes(s.notes || '')
    } else {
      const d = editing?.day ? new Date(editing.day) : new Date()
      setDay(ymdLocal(d))
      setStartTime('10:00')
      setEndTime('18:00')
      setCapacity(4)
      setZones(new Set())
      setNotes('')
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
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  const toggleZone = (z) => {
    setZones((prev) => {
      const next = new Set(prev)
      if (next.has(z)) next.delete(z); else next.add(z)
      return next
    })
  }

  const validate = () => {
    if (!day) return 'Date requise.'
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    if (sh < HOUR_MIN || sh > HOUR_MAX || eh < HOUR_MIN || eh > HOUR_MAX) {
      return `Les heures doivent être entre ${HOUR_MIN}h et ${HOUR_MAX}h.`
    }
    if (sh * 60 + sm >= eh * 60 + em) return "L'heure de fin doit être après l'heure de début."
    if (capacity < 1 || capacity > 7) return 'Capacité entre 1 et 7.'
    if (zones.size === 0) return 'Sélectionne au moins une zone.'
    return null
  }

  const save = async () => {
    const v = validate()
    if (v) { setError(v); return }
    setError(null)
    setPending(true)
    try {
      const payload = {
        starts_at: buildIso(day, startTime),
        ends_at: buildIso(day, endTime),
        capacity,
        zones: [...zones],
        notes,
        updated_at: new Date().toISOString(),
      }
      const res = editing?.slot
        ? await supabase.from('delivery_slots').update(payload).eq('id', editing.slot.id)
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
      const { error } = await supabase.from('delivery_slots').delete().eq('id', editing.slot.id)
      if (error) throw error
      onSaved?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setPending(false)
    }
  }

  return createPortal(
    <div className="zone-modal__backdrop" onClick={() => !pending && onClose?.()} role="presentation">
      <div
        className="zone-modal__card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="zone-modal__header">
          <div>
            <h3>{editing?.slot ? 'Modifier le créneau' : 'Nouveau créneau'}</h3>
          </div>
          <button type="button" className="zone-modal__close" onClick={onClose} disabled={pending}>×</button>
        </header>

        <div className="zone-modal__body">
          <div className="slot-modal__row">
            <label className="slot-modal__field">
              <span>Date</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={pending} />
            </label>
            <label className="slot-modal__field">
              <span>Début</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                min={`${HOUR_MIN}:00`}
                max={`${HOUR_MAX}:00`}
                step="900"
                disabled={pending}
              />
            </label>
            <label className="slot-modal__field">
              <span>Fin</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                min={`${HOUR_MIN}:00`}
                max={`${HOUR_MAX}:00`}
                step="900"
                disabled={pending}
              />
            </label>
            <label className="slot-modal__field">
              <span>Capacité</span>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(Math.max(1, Math.min(7, parseInt(e.target.value, 10) || 1)))}
                min={1}
                max={7}
                disabled={pending}
              />
            </label>
          </div>

          <div className="slot-modal__section">
            <div className="slot-modal__section-title">Zones desservies</div>
            {Object.entries(ZONES_BY_COUNTRY).map(([country, list]) => (
              <div key={country} className="slot-modal__zone-group">
                <div className="slot-modal__country">{country}</div>
                <div className="slot-modal__zones">
                  {list.map((z) => (
                    <button
                      key={z}
                      type="button"
                      className={'slot-modal__zone' + (zones.has(z) ? ' is-active' : '')}
                      onClick={() => toggleZone(z)}
                      disabled={pending}
                    >
                      {z === 'LU' ? 'Pays entier' : z.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <label className="slot-modal__field slot-modal__field--full">
            <span>Notes (internes)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={pending}
              placeholder="Ex: livraison camion XL uniquement"
            />
          </label>
        </div>

        {error && <div className="zone-modal__error">{error}</div>}

        <footer className="stock-modal__footer">
          {editing?.slot ? (
            <button type="button" className="btn btn--ghost" onClick={remove} disabled={pending}>
              Supprimer
            </button>
          ) : <span />}
          <button type="button" className="btn btn--blue" onClick={save} disabled={pending}>
            {pending ? 'Enregistrement…' : editing?.slot ? 'Enregistrer' : 'Créer le créneau'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
