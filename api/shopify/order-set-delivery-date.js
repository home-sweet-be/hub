const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

const QUERY_ATTRS = `
  query orderAttrs($id: ID!) {
    order(id: $id) {
      id
      customAttributes { key value }
    }
  }
`

const ORDER_UPDATE = `
  mutation orderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order {
        id
        customAttributes { key value }
      }
      userErrors { field message }
    }
  }
`

async function shopifyGraphql(domain, token, query, variables) {
  const r = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json()
  return { ok: r.ok, status: r.status, json }
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

function toGid(rawId) {
  const s = String(rawId || '').trim()
  if (!s) return null
  if (s.startsWith('gid://')) return s
  if (/^\d+$/.test(s)) return `gid://shopify/Order/${s}`
  return null
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return res
      .status(500)
      .json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN' })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const orderId = toGid(body.orderId)
  const deliveryDate = (body.deliveryDate || '').trim()
  if (!orderId) {
    return res
      .status(400)
      .json({ error: 'Missing or invalid orderId (numeric id or gid)' })
  }
  if (!isValidDate(deliveryDate)) {
    return res
      .status(400)
      .json({ error: 'Missing or invalid deliveryDate (expected YYYY-MM-DD)' })
  }

  // 1. Read existing customAttributes so we don't wipe EasyRoutes etc.
  const read = await shopifyGraphql(domain, token, QUERY_ATTRS, { id: orderId })
  if (!read.ok || read.json.errors) {
    return res.status(read.status || 500).json({
      error: 'Failed to read order',
      details: read.json.errors || read.json,
    })
  }
  const existing = read.json.data?.order?.customAttributes || []
  if (!read.json.data?.order) {
    return res.status(404).json({ error: 'Order not found' })
  }

  // 2. Merge: replace 'Delivery Date' if present, otherwise append.
  const next = existing
    .filter((a) => a.key !== 'Delivery Date')
    .map((a) => ({ key: a.key, value: a.value }))
  next.push({ key: 'Delivery Date', value: deliveryDate })

  // 3. Push back.
  const upd = await shopifyGraphql(domain, token, ORDER_UPDATE, {
    input: { id: orderId, customAttributes: next },
  })
  const userErrors = upd.json.data?.orderUpdate?.userErrors || []
  if (!upd.ok || upd.json.errors || userErrors.length > 0) {
    return res.status(upd.status || 500).json({
      error: 'orderUpdate failed',
      errors: upd.json.errors,
      userErrors,
    })
  }

  return res.status(200).json({
    ok: true,
    customAttributes: upd.json.data.orderUpdate.order.customAttributes,
  })
}
