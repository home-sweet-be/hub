const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

const QUERY = `
  query receptions($first: Int!, $query: String!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          tags
          totalPriceSet { shopMoney { amount currencyCode } }
          displayFinancialStatus
          shippingAddress {
            city
            province
            provinceCode
            zip
            countryCode
          }
          customer {
            firstName
            lastName
          }
          lineItems(first: 20) {
            edges {
              node {
                title
                quantity
                variantTitle
                vendor
                image { url altText }
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
  const filter = req.query.q || 'tag:SentToSupplier OR tag:ProduitEnStock'

  try {
    const response = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { first, query: filter },
        }),
      }
    )

    if (!response.ok) {
      const text = await response.text()
      return res.status(response.status).json({
        error: 'Shopify API error',
        status: response.status,
        details: text,
      })
    }

    const data = await response.json()
    if (data.errors) {
      return res
        .status(500)
        .json({ error: 'GraphQL errors', errors: data.errors })
    }

    const orders = (data.data?.orders?.edges || []).map((edge) => {
      const o = edge.node
      return {
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        tags: o.tags,
        total: o.totalPriceSet?.shopMoney?.amount,
        currency: o.totalPriceSet?.shopMoney?.currencyCode,
        financialStatus: o.displayFinancialStatus,
        shippingAddress: o.shippingAddress,
        customer: o.customer,
        lineItems: (o.lineItems?.edges || []).map((le) => le.node),
      }
    })

    res.setHeader('Cache-Control', 'private, max-age=10')
    return res.status(200).json({
      orders,
      pageInfo: data.data?.orders?.pageInfo,
    })
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Fetch failed', message: err.message })
  }
}
