const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

// withTx ajoute les transactions + montants reçus/dus (diagnostic paiements,
// activé via ?withTx=1). Off par défaut pour ne pas alourdir la liste normale.
const buildQuery = (withTx) => `
  query receptions($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true, after: $after) {
      edges {
        node {
          id
          name
          email
          phone
          createdAt
          tags
          totalPriceSet { shopMoney { amount currencyCode } }
          displayFinancialStatus
          ${withTx ? `
          totalReceivedSet { shopMoney { amount } }
          totalOutstandingSet { shopMoney { amount } }
          transactions(first: 20) {
            kind
            status
            gateway
            processedAt
            amountSet { shopMoney { amount } }
          }
          ` : ''}
          coutBackfill: metafield(namespace: "custom", key: "cout_backfill") { value }
          shippingAddress {
            name
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCode
            latitude
            longitude
          }
          customer {
            id
            firstName
            lastName
            tags
          }
          shippingLines(first: 1) {
            edges {
              node {
                title
                code
              }
            }
          }
          lineItems(first: 20) {
            edges {
              node {
                id
                title
                quantity
                currentQuantity
                variantTitle
                vendor
                sku
                image { url altText }
                discountedTotalSet { shopMoney { amount currencyCode } }
                originalUnitPriceSet { shopMoney { amount } }
                customAttributes { key value }
                variant {
                  id
                  sku
                  inventoryQuantity
                  inventoryItem {
                    id
                    unitCost { amount currencyCode }
                  }
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
  const withTx = !!req.query.withTx
  const filter =
    req.query.q ||
    '(tag:SentToSupplier OR tag:ProduitEnStock) AND NOT tag:removed AND NOT fulfillment_status:fulfilled AND NOT financial_status:refunded AND NOT financial_status:partially_refunded AND total_price:>1'

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
          query: buildQuery(withTx),
          variables: { first, query: filter, after },
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

    const orders = (data.data?.orders?.edges || [])
      .map((edge) => {
        const o = edge.node
        const numericId = (o.id || '').split('/').pop()
        const customerNumericId = (o.customer?.id || '').split('/').pop()
        return {
          id: o.id,
          name: o.name,
          email: o.email,
          phone: o.phone,
          createdAt: o.createdAt,
          tags: o.tags,
          total: o.totalPriceSet?.shopMoney?.amount,
          currency: o.totalPriceSet?.shopMoney?.currencyCode,
          financialStatus: o.displayFinancialStatus,
          // Order-level manual cost backfill (HT) from the custom.cout_backfill
          // metafield — overrides the per-line-item cost when present.
          costBackfill: (() => {
            const raw = o.coutBackfill?.value
            if (raw == null || raw === '') return null
            const n = parseFloat(String(raw).replace(',', '.'))
            return Number.isFinite(n) ? n : null
          })(),
          shippingAddress: o.shippingAddress,
          customer: o.customer
            ? {
                ...o.customer,
                adminUrl: customerNumericId
                  ? `https://${domain}/admin/customers/${customerNumericId}`
                  : null,
              }
            : null,
          adminUrl: numericId
            ? `https://${domain}/admin/orders/${numericId}`
            : null,
          shippingLine: o.shippingLines?.edges?.[0]?.node || null,
          lineItems: (o.lineItems?.edges || []).map((le) => le.node),
          ...(withTx
            ? {
                received: o.totalReceivedSet?.shopMoney?.amount,
                outstanding: o.totalOutstandingSet?.shopMoney?.amount,
                transactions: o.transactions || [],
              }
            : {}),
        }
      })
      .filter((o) => Number(o.total) > 1)

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
