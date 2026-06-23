import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import logo from '../assets/homesweet.png'

const VAT_RATE = 0.21

// Coordonnées légales de l'émetteur de la facture.
// ⚠️ IBAN encore à compléter.
const SELLER = {
  name: 'HomeSweet',
  legalName: 'SILK ROAD INVEST',
  address: ['54 Rue du Bon Pasteur Box A01', '1140 Evere', 'Belgique'],
  company: '1003.835.578',
  vat: 'BE1003835578',
  iban: 'BE00 0000 0000 0000 0000',
  email: 'contact@home-sweet.be',
  site: 'home-sweet.be',
}

function formatMoney(amount, currency = 'EUR') {
  const n = Number(amount)
  if (Number.isNaN(n)) return ''
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency }).format(n)
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function effectiveQuantity(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

export default function Facture() {
  const { orderName } = useParams()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const name = String(orderName || '').replace(/^#/, '')
    fetch(
      '/api/shopify/receptions?first=1&withTx=1&q=' +
        encodeURIComponent(`name:${name}`)
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const o = data.orders?.[0]
        if (!o) throw new Error(`Commande ${name} introuvable`)
        setOrder(o)
      })
      .catch((e) => setError(e.message || String(e)))
  }, [orderName])

  const computed = useMemo(() => {
    if (!order) return null
    const currency = order.currency || 'EUR'
    const items = (order.lineItems || [])
      .filter((li) => effectiveQuantity(li) > 0)
      .map((li) => {
        const qty = effectiveQuantity(li)
        const totalTtc = Number(li.discountedTotalSet?.shopMoney?.amount || 0)
        const totalHt = totalTtc / (1 + VAT_RATE)
        return {
          title: li.title,
          variant:
            li.variantTitle && !/texture/i.test(li.variantTitle)
              ? li.variantTitle
              : null,
          qty,
          unitHt: qty ? totalHt / qty : totalHt,
          totalHt,
          totalTtc,
        }
      })
    // Livraison (port) — ligne séparée, prix TTC depuis le shipping line Shopify.
    const ship = order.shippingLine
    const shipTtc = Number(ship?.discountedPriceSet?.shopMoney?.amount || 0)
    const shipping = ship
      ? {
          title: ship.title || 'Livraison',
          totalTtc: shipTtc,
          totalHt: shipTtc / (1 + VAT_RATE),
        }
      : null

    const productsTtc = items.reduce((s, i) => s + i.totalTtc, 0)
    const subtotalTtc = productsTtc + shipTtc
    const totalHt = subtotalTtc / (1 + VAT_RATE)
    const tva = subtotalTtc - totalHt
    const received = Number(order.received || 0)
    const outstanding = Number(order.outstanding || 0)
    return {
      currency,
      items,
      shipping,
      subtotalTtc,
      totalHt,
      tva,
      received,
      outstanding,
    }
  }, [order])

  if (error) {
    return (
      <div className="facture-page">
        <p className="facture-error">Erreur : {error}</p>
      </div>
    )
  }
  if (!order || !computed) {
    return (
      <div className="facture-page">
        <p className="facture-loading">Génération de la facture…</p>
      </div>
    )
  }

  const {
    currency,
    items,
    shipping,
    subtotalTtc,
    totalHt,
    tva,
    received,
    outstanding,
  } = computed
  const hasDeposit = received > 0 && outstanding > 0
  const cust = order.customer
  const addr = order.shippingAddress
  const billName =
    [cust?.firstName, cust?.lastName].filter(Boolean).join(' ').trim() ||
    addr?.name ||
    '—'

  return (
    <div className="facture-page">
      <div className="facture-toolbar">
        <button type="button" className="facture-print" onClick={() => window.print()}>
          Imprimer / Enregistrer en PDF
        </button>
      </div>

      <article className="facture" id="facture">
        <header className="facture__head">
          <div className="facture__seller">
            <img src={logo} alt={SELLER.name} className="facture__logo" />
            <div className="facture__seller-lines">
              <strong>{SELLER.legalName}</strong>
              {SELLER.address.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
              <span>N° entreprise : {SELLER.company}</span>
              <span>TVA : {SELLER.vat}</span>
              <span>{SELLER.email} · {SELLER.site}</span>
            </div>
          </div>
          <div className="facture__meta">
            <h1 className="facture__title">FACTURE</h1>
            <div className="facture__meta-row">
              <span>N° de facture</span>
              <strong>{order.name}</strong>
            </div>
            <div className="facture__meta-row">
              <span>Date</span>
              <strong>{formatDate(new Date())}</strong>
            </div>
            <div className="facture__meta-row">
              <span>Date de commande</span>
              <strong>{formatDate(order.createdAt)}</strong>
            </div>
          </div>
        </header>

        <section className="facture__bill-to">
          <div className="facture__bill-label">Facturé à</div>
          <div className="facture__bill-name">{billName}</div>
          {addr && (
            <div className="facture__bill-addr">
              {[addr.address1, addr.address2].filter(Boolean).join(', ')}
              <br />
              {[addr.zip, addr.city].filter(Boolean).join(' ')}
              {addr.country ? `, ${addr.country}` : ''}
            </div>
          )}
          {order.email && (
            <div className="facture__bill-addr">{order.email}</div>
          )}
        </section>

        <table className="facture__table">
          <thead>
            <tr>
              <th className="facture__col-desc">Désignation</th>
              <th className="num">Qté</th>
              <th className="num">P.U. HT</th>
              <th className="num">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>
                  <div className="facture__item-title">{it.title}</div>
                  {it.variant && (
                    <div className="facture__item-variant">{it.variant}</div>
                  )}
                </td>
                <td className="num">{it.qty}</td>
                <td className="num">{formatMoney(it.unitHt, currency)}</td>
                <td className="num">{formatMoney(it.totalHt, currency)}</td>
              </tr>
            ))}
            {shipping && (
              <tr>
                <td>
                  <div className="facture__item-title">Livraison</div>
                  <div className="facture__item-variant">{shipping.title}</div>
                </td>
                <td className="num">1</td>
                <td className="num">
                  {shipping.totalTtc > 0
                    ? formatMoney(shipping.totalHt, currency)
                    : 'Offerte'}
                </td>
                <td className="num">
                  {shipping.totalTtc > 0
                    ? formatMoney(shipping.totalHt, currency)
                    : formatMoney(0, currency)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="facture__totals-wrap">
          <table className="facture__totals">
            <tbody>
              <tr>
                <td>Total HT</td>
                <td className="num">{formatMoney(totalHt, currency)}</td>
              </tr>
              <tr>
                <td>TVA (21 %)</td>
                <td className="num">{formatMoney(tva, currency)}</td>
              </tr>
              <tr className="facture__totals-grand">
                <td>Total TTC</td>
                <td className="num">{formatMoney(subtotalTtc, currency)}</td>
              </tr>
              {hasDeposit && (
                <>
                  <tr className="facture__totals-paid">
                    <td>Acompte déjà versé</td>
                    <td className="num">
                      − {formatMoney(received, currency)}
                    </td>
                  </tr>
                  <tr className="facture__totals-due">
                    <td>Solde à payer à la livraison</td>
                    <td className="num">{formatMoney(outstanding, currency)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {hasDeposit && (
          <p className="facture__cod">
            Le solde de <strong>{formatMoney(outstanding, currency)}</strong> est
            payable <strong>en espèces uniquement</strong> à la livraison (cash
            on delivery). Les paiements par carte et virement ne sont pas
            acceptés à la livraison.
          </p>
        )}

        <footer className="facture__foot">
          <div>
            <strong>Coordonnées de paiement</strong>
            <br />
            IBAN : {SELLER.iban}
          </div>
          <div className="facture__foot-thanks">
            Merci pour votre confiance — {SELLER.name}
          </div>
        </footer>
      </article>
    </div>
  )
}
