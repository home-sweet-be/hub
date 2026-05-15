const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

const TAGS_ADD = `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`

const TAGS_REMOVE = `
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN' })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const orderIds = Array.isArray(body.orderIds) ? body.orderIds : []
  const add = Array.isArray(body.add) ? body.add : []
  const remove = Array.isArray(body.remove) ? body.remove : []

  if (orderIds.length === 0 || (add.length === 0 && remove.length === 0)) {
    return res.status(400).json({
      error: 'orderIds and at least one of add/remove are required',
    })
  }

  const results = []
  for (const id of orderIds) {
    const r = { id, addErrors: [], removeErrors: [] }
    if (remove.length > 0) {
      const { json } = await shopifyGraphql(domain, token, TAGS_REMOVE, { id, tags: remove })
      r.removeErrors =
        json.errors || json.data?.tagsRemove?.userErrors || []
    }
    if (add.length > 0) {
      const { json } = await shopifyGraphql(domain, token, TAGS_ADD, { id, tags: add })
      r.addErrors =
        json.errors || json.data?.tagsAdd?.userErrors || []
    }
    results.push(r)
  }

  const hasErrors = results.some(
    (r) => (r.addErrors?.length || 0) + (r.removeErrors?.length || 0) > 0
  )

  return res.status(hasErrors ? 207 : 200).json({ results, hasErrors })
}
