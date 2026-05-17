import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'
const FROM = process.env.EMAIL_FROM || 'Home Sweet <livraison@home-sweet.be>'
const BOOKING_URL =
  process.env.PLANI_PUBLIC_URL || 'https://home-sweet.be/pages/planifier-ma-livraison'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

const ORDERS_QUERY = `
  query waitingOrders($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true, after: $after) {
      edges {
        node {
          id
          name
          email
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

function zoneLabel(zone) {
  if (!zone) return ''
  if (zone === 'LU') return 'Luxembourg'
  if (zone === 'LIV-Externe') return 'Externe'
  return zone.replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ')
}

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

function buildBookingUrl(orderName, email) {
  const params = new URLSearchParams({
    order: String(orderName || '').replace(/^#/, ''),
    email: String(email || ''),
  })
  return `${BOOKING_URL}?${params.toString()}`
}

function renderEmail({ firstName, orderName, zoneName, slotDate, url }) {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  const dateLine = slotDate
    ? `<p style="margin:0 0 16px;color:#4a4a4f;">Un nouveau créneau de livraison est disponible <strong>${slotDate}</strong> dans votre zone (${zoneName}).</p>`
    : `<p style="margin:0 0 16px;color:#4a4a4f;">Un nouveau créneau de livraison vient d'être ouvert dans votre zone (${zoneName}).</p>`
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
        </p>
        ${dateLine}
        <p style="margin:0 0 24px;color:#4a4a4f;line-height:1.5;">
          Cliquez ci-dessous pour choisir le créneau qui vous arrange.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${url}" style="display:inline-block;background:#1c1a17;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:500;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;">
            Choisir mon créneau
          </a>
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

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const zones = Array.isArray(body.zones) ? body.zones.filter(Boolean) : []
  const slotDate = (body.slotDate || '').trim() || null
  if (zones.length === 0) {
    return res.status(400).json({ error: 'zones must be a non-empty array' })
  }

  const supabase = createClient(supaUrl, supaKey)
  const resend = new Resend(apiKey)

  // 1. Fetch all waiting-list orders.
  let orders
  try {
    orders = await fetchWaitingOrders(domain, token)
  } catch (e) {
    return res.status(500).json({ error: 'fetchWaitingOrders failed', message: e.message })
  }

  // 2. Fetch confirmed bookings to skip.
  const bookedRes = await supabase
    .from('delivery_bookings')
    .select('shopify_order_name')
    .eq('status', 'confirmed')
  const bookedNames = new Set(
    (bookedRes.data || []).map((r) => String(r.shopify_order_name || '').replace(/^#/, ''))
  )

  // 3. Filter: match zone + not booked + has email.
  const zoneSet = new Set(zones)
  const targets = []
  for (const o of orders) {
    const zone = extractZone(o)
    if (!zone || !zoneSet.has(zone)) continue
    const nameNoHash = String(o.name || '').replace(/^#/, '')
    if (bookedNames.has(nameNoHash)) continue
    const email = (o.email || o.customer?.email || '').trim()
    if (!email) continue
    targets.push({
      orderName: o.name,
      email,
      firstName: o.customer?.firstName || '',
      zone,
    })
  }

  if (targets.length === 0) {
    return res.status(200).json({ sent: 0, skipped: orders.length, targets: [] })
  }

  // 4. Send one email per target. Sequential to stay within Resend rate limits.
  const slotDateFr = slotDate
    ? new Date(`${slotDate}T00:00:00`).toLocaleDateString('fr-BE', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : null

  const results = []
  for (const t of targets) {
    const url = buildBookingUrl(t.orderName, t.email)
    const html = renderEmail({
      firstName: t.firstName,
      orderName: t.orderName,
      zoneName: zoneLabel(t.zone),
      slotDate: slotDateFr,
      url,
    })
    try {
      const { data, error } = await resend.emails.send({
        from: FROM,
        to: t.email,
        subject: `Votre commande ${t.orderName} est prête — choisissez un créneau de livraison`,
        html,
      })
      if (error) {
        results.push({ email: t.email, ok: false, error: error.message || String(error) })
      } else {
        results.push({ email: t.email, ok: true, id: data?.id })
      }
    } catch (e) {
      results.push({ email: t.email, ok: false, error: e.message || String(e) })
    }
  }

  const sent = results.filter((r) => r.ok).length
  const failed = results.length - sent
  return res.status(200).json({
    sent,
    failed,
    skipped: orders.length - targets.length,
    results,
  })
}
