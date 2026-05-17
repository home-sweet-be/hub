const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

const QUERY = `
  query verifyOrder($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          email
          contactEmail
          createdAt
          tags
          customer {
            id
            firstName
            lastName
            tags
          }
          shippingAddress {
            name
            address1
            address2
            city
            zip
            country
          }
        }
      }
    }
  }
`

function extractZone(order) {
  const find = (tags) => (tags || []).find((t) => ZONE_TAG_PATTERN.test(t))
  return find(order?.tags) || find(order?.customer?.tags) || null
}

function normalizeName(raw) {
  if (!raw) return ''
  return String(raw).trim().replace(/^#/, '')
}

function normalizeEmail(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return res.status(500).json({ error: 'Missing Shopify env vars' })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  const orderName = normalizeName(body.orderName)
  const email = normalizeEmail(body.email)

  if (!orderName || !email) {
    return res.status(400).json({ ok: false, code: 'missing_fields' })
  }

  // Shopify search by order name (HOMESWEET orders have no # prefix)
  const filter = `name:${orderName}`

  try {
    const r = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: QUERY, variables: { query: filter } }),
      }
    )
    if (!r.ok) {
      const text = await r.text()
      return res.status(r.status).json({ error: 'Shopify error', details: text })
    }
    const data = await r.json()
    if (data.errors) {
      const msg = data.errors.map((e) => e.message).join('; ')
      return res
        .status(500)
        .json({ error: `GraphQL: ${msg}`, errors: data.errors })
    }

    const edges = data.data?.orders?.edges || []
    // Find one with matching email (order.email or order.contactEmail)
    const matched = edges
      .map((e) => e.node)
      .find((o) => {
        const candidates = [o.email, o.contactEmail].map(normalizeEmail)
        return candidates.includes(email)
      })

    if (!matched) {
      return res.status(200).json({ ok: false, code: 'not_found' })
    }

    if (!matched.tags?.includes('PretPourLaLivraison')) {
      return res
        .status(200)
        .json({ ok: false, code: 'not_ready', name: matched.name })
    }

    const zone = extractZone(matched)
    if (!zone) {
      return res
        .status(200)
        .json({ ok: false, code: 'no_zone', name: matched.name })
    }

    // Check if already booked
    return res.status(200).json({
      ok: true,
      order: {
        id: matched.id,
        name: matched.name,
        zone,
        customerName: [
          matched.customer?.firstName,
          matched.customer?.lastName,
        ]
          .filter(Boolean)
          .join(' ')
          .trim(),
        email,
        address: matched.shippingAddress
          ? [
              matched.shippingAddress.name,
              matched.shippingAddress.address1,
              matched.shippingAddress.address2,
              [matched.shippingAddress.zip, matched.shippingAddress.city]
                .filter(Boolean)
                .join(' '),
              matched.shippingAddress.country,
            ]
              .filter(Boolean)
              .join(', ')
          : '',
      },
    })
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Fetch failed', message: err.message })
  }
}
