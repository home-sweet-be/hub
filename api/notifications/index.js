// Notifications endpoint — combines two operations on one Serverless Function to
// stay under the Hobby plan's 12-function limit:
//
//   GET  /api/notifications  → reconciliation overview (who should be notified
//                              vs who was, with delivery status)
//   POST /api/notifications  → manually (re)send the "your order is ready" email
//                              to a single customer
//
// "Who SHOULD be notified" = orders tagged WaitingList in a zone (these are the
// customers that get an email when a slot opens in their zone).
// "Who WAS notified"       = emails sent through Resend (with delivery status).
//
// The GET join (plus upcoming slots, to flag zones that already have
// availability) lets the team spot customers whose email never went out or
// bounced — something the raw Resend list can't show on its own.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'
const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i
const RESEND_LIST_URL = 'https://api.resend.com/emails'
const RESEND_PAGES = 10

const FROM = process.env.EMAIL_FROM || 'Home Sweet <livraison@send.home-sweet.be>'
const BOOKING_URL =
  process.env.PLANI_PUBLIC_URL || 'https://home-sweet.be/pages/planifier-ma-livraison'

const ORDERS_QUERY = `
  query waitingOrders($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true, after: $after) {
      edges {
        node {
          id
          name
          email
          createdAt
          tags
          customer { firstName lastName email tags }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

function extractZone(order) {
  const find = (tags) => (tags || []).find((t) => ZONE_TAG_PATTERN.test(t))
  return find(order?.tags) || find(order?.customer?.tags) || null
}

function customerName(o) {
  return [o?.customer?.firstName, o?.customer?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
}

function normName(name) {
  return String(name || '').replace(/^#/, '').trim().toLowerCase()
}

// Pull the order reference out of a notification subject like
// "Votre commande #1234 est prête — choisissez un créneau de livraison".
function orderFromSubject(subject) {
  const m = /commande\s+#?([A-Za-z0-9._-]+)/i.exec(subject || '')
  return m ? normName(m[1]) : null
}

function toAddresses(email) {
  const to = email?.to
  if (Array.isArray(to)) return to.map((s) => String(s).toLowerCase())
  if (to) return [String(to).toLowerCase()]
  return []
}

async function fetchWaitingOrders(domain, token) {
  const cutoff = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10)
  const filter = `created_at:>=${cutoff} AND tag:WaitingList AND NOT tag:removed AND status:open AND NOT financial_status:refunded AND NOT financial_status:partially_refunded`
  const out = []
  let after = null
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { first: 100, query: filter, after },
      }),
    })
    const json = await r.json()
    if (!r.ok || json.errors) {
      throw new Error('Shopify error: ' + JSON.stringify(json.errors || json))
    }
    const edges = json.data?.orders?.edges || []
    for (const e of edges) out.push(e.node)
    const page = json.data?.orders?.pageInfo
    if (!page?.hasNextPage) break
    after = page.endCursor
  }
  return out
}

async function fetchResendEmails(apiKey) {
  const emails = []
  let after = null
  for (let i = 0; i < RESEND_PAGES; i++) {
    const url = new URL(RESEND_LIST_URL)
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error('Resend list failed: ' + JSON.stringify(json))
    const page = Array.isArray(json.data) ? json.data : []
    emails.push(...page)
    if (!json.has_more || page.length === 0) break
    after = page[page.length - 1]?.id
    if (!after) break
  }
  return emails
}

// ── GET: reconciliation overview ───────────────────────────────────────────

async function handleOverview(req, res) {
  const apiKey = process.env.RESEND_API_KEY
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supaKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY

  if (!apiKey) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  if (!domain || !token) return res.status(500).json({ error: 'Missing Shopify env vars' })
  if (!supaUrl || !supaKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const supabase = createClient(supaUrl, supaKey)

  let waiting, resendEmails
  try {
    ;[waiting, resendEmails] = await Promise.all([
      fetchWaitingOrders(domain, token),
      fetchResendEmails(apiKey),
    ])
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) })
  }

  // Confirmed bookings → exclude already-booked orders + their zones don't need notifying.
  const bookedRes = await supabase
    .from('delivery_bookings')
    .select('shopify_order_name')
    .eq('status', 'confirmed')
  const bookedNames = new Set(
    (bookedRes.data || []).map((r) => normName(r.shopify_order_name))
  )

  // Zones that currently have an upcoming slot (availability already opened).
  const nowIso = new Date().toISOString()
  const slotsRes = await supabase
    .from('delivery_slots')
    .select('zones, starts_at')
    .gte('starts_at', nowIso)
  const zonesWithSlot = new Set()
  for (const s of slotsRes.data || []) {
    for (const z of s.zones || []) zonesWithSlot.add(z)
  }

  // Index Resend emails by order ref (from subject) and by recipient address.
  const byOrder = new Map()
  const byTo = new Map()
  for (const e of resendEmails) {
    const ord = orderFromSubject(e.subject)
    if (ord) {
      if (!byOrder.has(ord)) byOrder.set(ord, [])
      byOrder.get(ord).push(e)
    }
    for (const addr of toAddresses(e)) {
      if (!byTo.has(addr)) byTo.set(addr, [])
      byTo.get(addr).push(e)
    }
  }
  const mostRecent = (list) =>
    (list || []).reduce((best, e) => {
      if (!best) return e
      return new Date(e.created_at || 0) > new Date(best.created_at || 0) ? e : best
    }, null)

  const rows = []
  for (const o of waiting) {
    const nameNorm = normName(o.name)
    if (bookedNames.has(nameNorm)) continue
    const zone = extractZone(o)
    const email = (o.email || o.customer?.email || '').trim()

    // Match the most precise notification email: by order ref first, else by
    // recipient address.
    let match = mostRecent(byOrder.get(nameNorm))
    if (!match && email) match = mostRecent(byTo.get(email.toLowerCase()))

    rows.push({
      orderName: o.name,
      customerName: customerName(o),
      email,
      zone: zone || null,
      createdAt: o.createdAt || null,
      zoneHasSlot: zone ? zonesWithSlot.has(zone) : false,
      notified: !!match,
      lastEvent: match?.last_event || null,
      sentAt: match?.created_at || null,
      resendId: match?.id || null,
    })
  }

  return res.status(200).json({
    count: rows.length,
    zonesWithSlot: [...zonesWithSlot],
    rows,
  })
}

// ── POST: manual (re)send ──────────────────────────────────────────────────

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

async function handleResend(req, res) {
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
  const name = (body.customerName || '').trim()
  const zone = (body.zone || '').trim()

  if (!orderName) return res.status(400).json({ error: 'Missing orderName' })
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Missing or invalid email' })
  }

  const firstName = name.split(/\s+/)[0] || ''
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

// ── Router ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'GET') return handleOverview(req, res)
  if (req.method === 'POST') return handleResend(req, res)
  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method not allowed' })
}
