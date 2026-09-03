// Emails envoyés à chaque réservation de créneau sur la page publique de
// planification : (1) notification interne à l'équipe, (2) confirmation au
// client. Best-effort : le front appelle cette route après avoir déjà
// enregistré la réservation, donc un échec ici ne bloque jamais le client.

import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM || 'Dazzuro <livraison@send.home-sweet.be>'
// Accepte plusieurs destinataires séparés par des virgules.
const NOTIFY_TO = (process.env.BOOKING_NOTIFY_TO || 'direction@home-sweet.be')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'contact@home-sweet.be'
const SUPPORT_PHONE = (process.env.SUPPORT_PHONE || '+32 71 18 88 63').trim()

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'
  )
}

// Palier de livraison extrait du titre du shipping line Shopify — même règle
// que src/pages/PlanificationLivraison.jsx.
function shippingTier(title) {
  if (!title) return null
  if (/premium/i.test(title)) return 'premium'
  if (/confort/i.test(title)) return 'confort'
  if (/standard/i.test(title)) return 'standard'
  return null
}

const TIER_LABEL = {
  standard: 'Standard',
  confort: 'Confort',
  premium: 'Premium',
}

const TIER_BODY = {
  standard:
    'Votre article est livré au pied du camion, devant chez vous.',
  confort:
    'Nos livreurs déposent votre article dans la pièce de votre choix, au rez-de-chaussée ou à l’étage.',
  premium:
    'Nos livreurs déposent votre article dans la pièce de votre choix, le déballent et l’installent.',
}

function row(label, value) {
  if (!value) return ''
  return `<tr>
    <td style="padding:6px 16px 6px 0;color:#8a8a8e;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;color:#1d1d1f;font-size:14px;font-weight:500;">${esc(value)}</td>
  </tr>`
}

// Encart mis en avant (fond coloré) dans l'email client.
function notice({ bg, border, title, body }) {
  return `<div style="margin:0 0 16px;padding:16px 18px;background:${bg};border:1px solid ${border};border-radius:12px;">
    <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#1d1d1f;">${title}</p>
    <div style="margin:0;color:#4a4a4f;font-size:14px;line-height:1.55;">${body}</div>
  </div>`
}

function customerHtml({
  orderName,
  customerName,
  address,
  dateLine,
  tier,
  monteCharge,
}) {
  const greeting = customerName
    ? `Bonjour ${esc(customerName.split(' ')[0])},`
    : 'Bonjour,'

  // Confort / Premium : les livreurs entrent dans le logement, l'accès du
  // camion et le stationnement deviennent critiques.
  const accessBlock =
    tier === 'confort' || tier === 'premium'
      ? notice({
          bg: '#fff8ec',
          border: '#f3dfc0',
          title: '🅿️ Prévoyez un accès pour le camion',
          body: `Votre livraison <strong>${TIER_LABEL[tier]}</strong> implique que nos livreurs entrent chez vous
            avec votre article. Merci de prévoir, si possible, <strong>une place de stationnement devant
            chez vous</strong> ou un accès simple pour le camion.<br/><br/>
            Rue à sens unique, zone piétonne, stationnement interdit, travaux, cour intérieure ou accès
            étroit : <strong>signalez-le nous à l’avance</strong>. Sans emplacement proche, le camion doit
            parfois se garer à plus de 10 minutes à pied, ce qui rallonge fortement la livraison.`,
        })
      : ''

  const monteChargeBlock = monteCharge
    ? notice({
        bg: '#fdf2f2',
        border: '#f0d5d5',
        title: '🛗 Monte-charges réservé',
        body: `Le monte-charges est <strong>à régler en espèces le jour de la livraison</strong>, directement
          au livreur. Les paiements par carte bancaire et par virement ne sont pas acceptés.<br/><br/>
          Prévoyez également <strong>un espace dégagé suffisant devant la façade</strong> pour que le camion
          monte-charges puisse stationner et déployer son bras jusqu’à votre fenêtre ou balcon
          (véhicules garés, poubelles, chantier, branches basses : merci de libérer la zone si vous le
          pouvez).`,
      })
    : ''

  const phoneLine = SUPPORT_PHONE
    ? `Une question, un imprévu, un changement d’adresse ? Appelez-nous au
       <a href="tel:${esc(SUPPORT_PHONE.replace(/\s/g, ''))}" style="color:#1c1a17;font-weight:600;">${esc(SUPPORT_PHONE)}</a>
       ou écrivez-nous à <a href="mailto:${SUPPORT_EMAIL}" style="color:#1c1a17;">${SUPPORT_EMAIL}</a>.`
    : `Une question, un imprévu, un changement d’adresse ? Écrivez-nous à
       <a href="mailto:${SUPPORT_EMAIL}" style="color:#1c1a17;">${SUPPORT_EMAIL}</a>.`

  return `
<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <h1 style="margin:0 0 18px;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;">
          Votre livraison est confirmée
        </h1>
        <p style="margin:0 0 14px;color:#1d1d1f;font-size:15px;">${greeting}</p>
        <p style="margin:0 0 20px;color:#4a4a4f;font-size:15px;line-height:1.5;">
          Nous avons bien enregistré votre créneau de livraison pour la commande
          <strong>${esc(orderName)}</strong>.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 22px;">
          ${row('Créneau', dateLine)}
          ${row('Adresse', address)}
          ${row('Formule', tier ? TIER_LABEL[tier] : '')}
          ${row('Monte-charges', monteCharge ? 'Oui' : '')}
        </table>

        ${tier && TIER_BODY[tier] ? `<p style="margin:0 0 18px;color:#4a4a4f;font-size:14px;line-height:1.55;">${TIER_BODY[tier]}</p>` : ''}

        ${accessBlock}
        ${monteChargeBlock}

        <p style="margin:18px 0 14px;color:#4a4a4f;font-size:14px;line-height:1.55;">
          Le jour J, merci de veiller à ce que <strong>le chemin soit dégagé</strong> et qu’une personne
          majeure soit présente pour réceptionner la commande.
        </p>

        <p style="margin:0 0 16px;color:#4a4a4f;font-size:14px;line-height:1.55;">
          ${phoneLine}
        </p>

        <p style="margin:0;color:#8a8a8e;font-size:12px;line-height:1.5;">
          À très bientôt,<br/>— L’équipe Dazzuro
        </p>
      </div>
    </div>
  </body>
</html>`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const orderName = (body.orderName || '').trim()
  if (!orderName) {
    return res.status(400).json({ error: 'Missing orderName' })
  }

  const customerName = (body.customerName || '').trim()
  const email = (body.email || '').trim()
  const zone = (body.zone || '').trim()
  const address = (body.address || '').trim()
  const shippingLine = (body.shippingLine || '').trim()
  const monteCharge = body.monteChargeRequired === true
  const tier = shippingTier(shippingLine)
  const dateLine = [fmtDate(body.slotStart), fmtTime(body.slotStart) && `${fmtTime(body.slotStart)} – ${fmtTime(body.slotEnd)}`]
    .filter(Boolean)
    .join(' · ')

  const html = `
<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#1d1d1f;">
          Nouvelle réservation de livraison
        </h1>
        <p style="margin:0 0 20px;color:#4a4a4f;font-size:14px;">
          Commande <strong>${esc(orderName)}</strong>
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          ${row('Créneau', dateLine)}
          ${row('Zone', zone)}
          ${row('Client', customerName)}
          ${row('E-mail', email)}
          ${row('Adresse', address)}
          ${row('Livraison', shippingLine)}
          ${row('Monte-charge', monteCharge ? 'Oui — à réserver' : 'Non')}
        </table>
      </div>
      <p style="text-align:center;color:#b0b0b4;font-size:11px;margin:16px 0 0;">
        Notification automatique — Dazzuro Hub
      </p>
    </div>
  </body>
</html>`

  try {
    const resend = new Resend(apiKey)

    // 1. Notification interne (équipe).
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: NOTIFY_TO,
      subject: `Nouvelle réservation — ${orderName}${dateLine ? ` (${fmtDate(body.slotStart)})` : ''}`,
      html,
    })
    if (error) {
      console.error('[booking-notify] resend error', error)
      return res.status(502).json({ error: error.message || String(error) })
    }

    // 2. Confirmation client. Un échec ici ne doit pas faire échouer la
    // notification interne déjà partie : on le remonte sans 5xx.
    let customerId = null
    let customerError = null
    if (email) {
      try {
        const sent = await resend.emails.send({
          from: FROM,
          to: email,
          subject: `Votre livraison est confirmée — ${orderName}`,
          html: customerHtml({
            orderName,
            customerName,
            address,
            dateLine,
            tier,
            monteCharge,
          }),
        })
        if (sent.error) throw new Error(sent.error.message || String(sent.error))
        customerId = sent.data?.id || null
      } catch (e) {
        customerError = e.message || String(e)
        console.error('[booking-notify] customer email failed', e)
      }
    }

    return res.status(200).json({ ok: true, id: data?.id, customerId, customerError })
  } catch (e) {
    console.error('[booking-notify] threw', e)
    return res.status(500).json({ error: e.message || String(e) })
  }
}
