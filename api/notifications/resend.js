// Manually (re)send the "your order is ready — pick a delivery slot" email to a
// single customer, from the Notifications "Suivi" table. Same template as the
// automatic notify-zone-slot send.
//
// POST /api/notifications/resend  { orderName, email, customerName, zone }

import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM || 'Home Sweet <livraison@send.home-sweet.be>'
const BOOKING_URL =
  process.env.PLANI_PUBLIC_URL || 'https://home-sweet.be/pages/planifier-ma-livraison'

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

function zoneLabel(zone) {
  if (!zone) return ''
  if (zone === 'LU') return 'Luxembourg'
  if (zone === 'LIV-Externe') return 'Externe'
  return zone.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
}

function buildBookingUrl(orderName, email) {
  const params = new URLSearchParams({
    order: String(orderName || '').replace(/^#/, ''),
    email: String(email || ''),
  })
  return `${BOOKING_URL}?${params.toString()}`
}

function renderEmail({ firstName, orderName, zoneName, url }) {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  const zoneBit = zoneName ? ` dans votre zone (${zoneName})` : ''
  return `
<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <h1 style="margin:0 0 18px;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;">
          Votre commande ${orderName} est prête à être livrée
        </h1>
        <p style="margin:0 0 14px;color:#1d1d1f;font-size:15px;">${greeting}</p>
        <p style="margin:0 0 16px;color:#4a4a4f;line-height:1.5;">
          Bonne nouvelle : votre commande <strong>${orderName}</strong> est prête.
          Un créneau de livraison est disponible${zoneBit}.
        </p>
        <p style="margin:0 0 20px;color:#4a4a4f;line-height:1.5;">
          Pour réserver votre créneau, cliquez sur le bouton ci-dessous, ou
          rendez-vous dans votre compte client.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
          <tr>
            <td style="padding-right:10px;">
              <a href="${url}" style="display:inline-block;background:#1c1a17;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:500;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;">
                Choisir mon créneau
              </a>
            </td>
            <td>
              <a href="https://home-sweet.be/account" style="display:inline-block;background:#ffffff;color:#1c1a17;text-decoration:none;padding:13px 27px;border:1px solid #1c1a17;border-radius:10px;font-weight:500;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;">
                Mon compte
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;color:#4a4a4f;font-size:13px;line-height:1.5;">
          Une question ? Écrivez-nous à
          <a href="mailto:contact@home-sweet.be" style="color:#1c1a17;">contact@home-sweet.be</a>,
          nous sommes là pour vous aider.
        </p>
        <p style="margin:0;color:#8a8a8e;font-size:12px;line-height:1.5;">
          Si vous avez déjà réservé un créneau, vous pouvez ignorer cet email.<br/>
          — L'équipe Home Sweet
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
  const email = (body.email || '').trim()
  const customerName = (body.customerName || '').trim()
  const zone = (body.zone || '').trim()

  if (!orderName) return res.status(400).json({ error: 'Missing orderName' })
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Missing or invalid email' })
  }

  const firstName = customerName.split(/\s+/)[0] || ''
  const url = buildBookingUrl(orderName, email)
  const html = renderEmail({
    firstName,
    orderName,
    zoneName: zoneLabel(zone),
    url,
  })

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Votre commande ${orderName} est prête — choisissez un créneau de livraison`,
      html,
    })
    if (error) {
      console.error('[notif-resend] resend error', error)
      return res.status(502).json({ error: error.message || String(error) })
    }
    return res.status(200).json({ ok: true, id: data?.id })
  } catch (e) {
    console.error('[notif-resend] threw', e)
    return res.status(500).json({ error: e.message || String(e) })
  }
}
