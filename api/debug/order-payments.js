// api/debug/order-payments.js — endpoint de diagnostic TEMPORAIRE.
//   Appel : /api/debug/order-payments?name=1636&key=hs-debug-2026
//
// But : lire le statut financier + montants + transactions d'une commande,
// pour vérifier comment les acomptes sont enregistrés dans Shopify et si la
// trace survit après paiement complet.
//
// ⚠️ À SUPPRIMER après usage. Protégé par une clé en query (?key=).
//
// Appel : /api/_debug/order-payments?name=1636&key=hs-debug-2026
//   name : numéro de commande (sans #)  — ou order_id numérique via ?id=
//   key  : doit valoir DEBUG_KEY (env) ou la valeur par défaut ci-dessous

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'
const DEFAULT_KEY = 'hs-debug-2026'

const QUERY = `
  query orderPayments($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          name
          createdAt
          displayFinancialStatus
          tags
          totalPriceSet { shopMoney { amount currencyCode } }
          totalReceivedSet { shopMoney { amount } }
          totalOutstandingSet { shopMoney { amount } }
          transactions(first: 30) {
            kind
            status
            amountSet { shopMoney { amount } }
            processedAt
            gateway
          }
        }
      }
    }
  }
`

export default async function handler(req, res) {
  const key = req.query.key
  const expected = process.env.DEBUG_KEY || DEFAULT_KEY
  if (key !== expected) {
    return res.status(401).json({ error: 'Unauthorized (bad or missing ?key=)' })
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return res
      .status(500)
      .json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN' })
  }

  const name = String(req.query.name || '').replace(/^#/, '').trim()
  const id = String(req.query.id || '').trim()
  if (!name && !id) {
    return res.status(400).json({ error: 'Provide ?name=1636 or ?id=<numeric>' })
  }
  const filter = id ? `id:${id}` : `name:${name}`

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
    const json = await r.json()
    if (!r.ok || json.errors) {
      return res
        .status(r.status || 500)
        .json({ error: 'Shopify error', details: json.errors || json })
    }

    const node = json.data?.orders?.edges?.[0]?.node
    if (!node) return res.status(404).json({ error: `Order "${name || id}" not found` })

    const PAY_KINDS = new Set(['SALE', 'CAPTURE'])
    const payTx = (node.transactions || []).filter(
      (t) => PAY_KINDS.has(t.kind) && t.status === 'SUCCESS'
    )
    const dates = [...new Set(payTx.map((t) => (t.processedAt || '').slice(0, 10)))]

    return res.status(200).json({
      name: node.name,
      createdAt: node.createdAt,
      financialStatus: node.displayFinancialStatus,
      tags: node.tags,
      total: node.totalPriceSet?.shopMoney?.amount,
      currency: node.totalPriceSet?.shopMoney?.currencyCode,
      received: node.totalReceivedSet?.shopMoney?.amount,
      outstanding: node.totalOutstandingSet?.shopMoney?.amount,
      paymentTransactionCount: payTx.length,
      paymentDates: dates,
      transactions: node.transactions,
      // Interprétation rapide :
      depositTraceableAfterFullPayment:
        Number(node.totalOutstandingSet?.shopMoney?.amount) === 0 &&
        payTx.length > 1,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', message: err.message })
  }
}
