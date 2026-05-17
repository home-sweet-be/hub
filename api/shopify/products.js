const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

const QUERY = `
  query products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: TITLE) {
      edges {
        node {
          id
          title
          status
          featuredImage { url altText }
          variants(first: 1) {
            edges {
              node {
                id
                sku
                price
                image { url altText }
                inventoryItem {
                  unitCost { amount currencyCode }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export default async function handler(req, res) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return res.status(500).json({
      error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars',
    })
  }

  const first = Math.min(Number(req.query.first) || 250, 250)
  const after = req.query.after || null

  try {
    const r = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { first, after },
        }),
      }
    )
    if (!r.ok) {
      const text = await r.text()
      return res
        .status(r.status)
        .json({ error: 'Shopify error', details: text })
    }
    const data = await r.json()
    if (data.errors) {
      const msg = data.errors.map((e) => e.message).join('; ')
      return res
        .status(500)
        .json({ error: `GraphQL: ${msg}`, errors: data.errors })
    }
    const products = (data.data?.products?.edges || []).map((edge) => {
      const p = edge.node
      const v = p.variants?.edges?.[0]?.node
      const numericId = (p.id || '').split('/').pop()
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        adminUrl: numericId
          ? `https://${domain}/admin/products/${numericId}`
          : null,
        bulkEditUrl: numericId
          ? `https://${domain}/admin/bulk/product?ids=${numericId}&edit=media%2Cvariants.cost%2Cvariants.sku`
          : null,
        imageUrl: v?.image?.url || p.featuredImage?.url || null,
        variant: v
          ? {
              id: v.id,
              sku: v.sku || '',
              price: Number(v.price) || 0,
              costHt: Number(v.inventoryItem?.unitCost?.amount) || 0,
              currency:
                v.inventoryItem?.unitCost?.currencyCode || 'EUR',
            }
          : null,
      }
    })
    return res.status(200).json({
      products,
      pageInfo: data.data?.products?.pageInfo,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', message: err.message })
  }
}
