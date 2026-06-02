// Reconciliation for the hub "Notifications" space.
//
// "Who SHOULD be notified" = orders tagged WaitingList in a zone (these are the
// customers that get an email when a slot opens in their zone).
// "Who WAS notified"       = emails sent through Resend (with delivery status).
//
// This endpoint joins the two (plus upcoming slots, to flag zones that already
// have availability) so the team can spot customers whose email never went out
// or bounced — something the raw Resend list can't show on its own.
//
// GET /api/notifications/overview

import { createClient } from '@supabase/supabase-js'

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'
const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i
const RESEND_LIST_URL = 'https://api.resend.com/emails'
const RESEND_PAGES = 10

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
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
