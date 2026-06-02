// Internal notification email sent to the team every time a customer books a
// delivery slot on the public planification page. Best-effort: the frontend
// calls this after the booking is already saved, so a failure here never
// blocks the customer's booking.

import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM || 'Home Sweet <livraison@send.home-sweet.be>'
const NOTIFY_TO = process.env.BOOKING_NOTIFY_TO || 'direction@home-sweet.be'

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

function row(label, value) {
  if (!value) return ''
  return `<tr>
    <td style="padding:6px 16px 6px 0;color:#8a8a8e;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;color:#1d1d1f;font-size:14px;font-weight:500;">${esc(value)}</td>
  </tr>`
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
        Notification automatique — Home Sweet Hub
      </p>
    </div>
  </body>
</html>`

  try {
    const resend = new Resend(apiKey)
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
    return res.status(200).json({ ok: true, id: data?.id })
  } catch (e) {
    console.error('[booking-notify] threw', e)
    return res.status(500).json({ error: e.message || String(e) })
  }
}
