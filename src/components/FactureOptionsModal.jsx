import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Personnalisation « à la volée » d'une facture : adresse de facturation
// remplacée et texte libre affiché sous l'adresse. Rien n'est enregistré —
// les valeurs partent en query params vers /facture/:orderName.

// Pré-remplit avec l'adresse de livraison Shopify.
function initialForm(order) {
  const a = order.shippingAddress || {}
  const c = order.customer
  return {
    billName:
      [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim() ||
      a.name ||
      '',
    address1: a.address1 || '',
    address2: a.address2 || '',
    zip: a.zip || '',
    city: a.city || '',
    country: a.country || '',
    note: '',
  }
}

// Monté uniquement à l'ouverture (le parent le rend conditionnellement), donc
// l'état est initialisé une fois pour la commande courante.
export default function FactureOptionsModal({ order, onClose }) {
  const [form, setForm] = useState(() => initialForm(order))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const orderName = String(order.name).replace(/^#/, '')

  const generate = (e) => {
    e?.preventDefault()
    const p = new URLSearchParams()
    if (form.billName.trim()) p.set('bn', form.billName.trim())
    p.set('a1', form.address1.trim())
    p.set('a2', form.address2.trim())
    p.set('zip', form.zip.trim())
    p.set('city', form.city.trim())
    p.set('country', form.country.trim())
    if (form.note.trim()) p.set('note', form.note.trim())
    window.open(`/facture/${orderName}?${p.toString()}`, '_blank', 'noopener')
    onClose?.()
  }

  return createPortal(
    <div
      className="facture-opts__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <form
        className="facture-opts__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="facture-opts-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={generate}
      >
        <header className="facture-opts__header">
          <div>
            <h3 id="facture-opts-title">Facture #{orderName}</h3>
            <p className="facture-opts__subtitle">
              Modifications ponctuelles — rien n'est enregistré.
            </p>
          </div>
          <button
            type="button"
            className="facture-opts__close"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        <div className="facture-opts__body">
          <label className="facture-opts__field facture-opts__field--full">
            <span>Facturé à</span>
            <input type="text" value={form.billName} onChange={set('billName')} />
          </label>
          <label className="facture-opts__field facture-opts__field--full">
            <span>Adresse</span>
            <input
              type="text"
              value={form.address1}
              onChange={set('address1')}
              placeholder="Rue et numéro"
            />
          </label>
          <label className="facture-opts__field facture-opts__field--full">
            <span>Complément</span>
            <input
              type="text"
              value={form.address2}
              onChange={set('address2')}
              placeholder="Boîte, étage… (optionnel)"
            />
          </label>
          <label className="facture-opts__field">
            <span>Code postal</span>
            <input type="text" value={form.zip} onChange={set('zip')} />
          </label>
          <label className="facture-opts__field">
            <span>Ville</span>
            <input type="text" value={form.city} onChange={set('city')} />
          </label>
          <label className="facture-opts__field facture-opts__field--full">
            <span>Pays</span>
            <input type="text" value={form.country} onChange={set('country')} />
          </label>
          <label className="facture-opts__field facture-opts__field--full">
            <span>Texte personnalisé (sous l'adresse)</span>
            <textarea
              rows={3}
              value={form.note}
              onChange={set('note')}
              placeholder="Ex. : N° TVA du client, bon de commande, mention particulière…"
            />
          </label>
        </div>

        <footer className="facture-opts__footer">
          <button
            type="button"
            className="facture-opts__btn facture-opts__btn--secondary"
            onClick={onClose}
          >
            Annuler
          </button>
          <button type="submit" className="btn btn--blue">
            📄 Générer la facture
          </button>
        </footer>
      </form>
    </div>,
    document.body
  )
}
