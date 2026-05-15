const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

const LOCATIONS_QUERY = `
  query primaryLocation {
    locations(first: 10, includeInactive: false) {
      edges { node { id name isActive } }
    }
  }
`

const ADJUST_MUTATION = `
  mutation adjust($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup {
        reason
        changes { delta quantityAfterChange }
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

async function getLocationId(domain, token) {
  if (process.env.SHOPIFY_LOCATION_ID) return process.env.SHOPIFY_LOCATION_ID
  const { json } = await shopifyGraphql(domain, token, LOCATIONS_QUERY, {})
  const nodes = (json.data?.locations?.edges || []).map((e) => e.node)
  const active = nodes.find((n) => n.isActive) || nodes[0]
  if (!active) throw new Error('No active Shopify location found')
  return active.id
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

  const items = Array.isArray(body.items) ? body.items : []
  const reason = body.reason || 'received'
  if (items.length === 0) {
    return res.status(400).json({ error: 'items array required' })
  }

  let locationId
  try {
    locationId = await getLocationId(domain, token)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  // Aggregate deltas per inventoryItemId (in case the same SKU appears multiple times)
  const byItem = new Map()
  for (const it of items) {
    if (!it.inventoryItemId || !Number.isFinite(Number(it.delta))) continue
    byItem.set(
      it.inventoryItemId,
      (byItem.get(it.inventoryItemId) || 0) + Number(it.delta)
    )
  }

  const changes = [...byItem.entries()].map(([inventoryItemId, delta]) => ({
    inventoryItemId,
    locationId,
    delta,
  }))

  if (changes.length === 0) {
    return res.status(400).json({ error: 'No valid (inventoryItemId, delta) pairs in items' })
  }

  const { json } = await shopifyGraphql(domain, token, ADJUST_MUTATION, {
    input: { reason, name: 'available', changes },
  })

  const userErrors = json.data?.inventoryAdjustQuantities?.userErrors || []
  if (userErrors.length > 0 || json.errors) {
    return res.status(207).json({
      ok: false,
      errors: json.errors,
      userErrors,
      locationId,
      changes,
    })
  }

  return res.status(200).json({
    ok: true,
    locationId,
    applied: json.data?.inventoryAdjustQuantities?.inventoryAdjustmentGroup?.changes || [],
  })
}
