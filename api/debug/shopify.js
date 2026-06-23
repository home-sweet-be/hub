// api/debug/shopify.js — proxy GraphQL Shopify LECTURE SEULE, diagnostic.
//
// Déployé UNE fois : permet d'exécuter n'importe quelle requête de lecture
// sur Shopify (commandes, clients, produits, transactions…) sans redéployer.
// Les mutations sont refusées. Protégé par ?key=.
//
// ⚠️ Endpoint de diagnostic — à retirer quand l'analyse est finie.
//
// Usage (GET, requête simple url-encodée) :
//   /api/debug/shopify?key=hs-debug-2026&query=<graphql url-encodé>
//
// Usage (POST, recommandé pour les grosses requêtes) :
//   curl -s "https://home-sweet.vercel.app/api/debug/shopify?key=hs-debug-2026" \
//        -H "Content-Type: application/json" \
//        -d '{"query":"{ orders(first:3){edges{node{name displayFinancialStatus}}} }"}'

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'
const DEFAULT_KEY = 'hs-debug-2026'

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

  let query = null
  let variables = {}
  if (req.method === 'POST') {
    let body
    try {
      body = await readJsonBody(req)
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }
    query = body.query
    variables = body.variables || {}
  } else {
    query = req.query.query
    if (req.query.variables) {
      try {
        variables = JSON.parse(req.query.variables)
      } catch {
        return res.status(400).json({ error: 'variables must be valid JSON' })
      }
    }
  }

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Provide a GraphQL "query" (POST body or ?query=)' })
  }

  // Lecture seule : on refuse toute mutation.
  if (/\bmutation\b/i.test(query)) {
    return res.status(403).json({ error: 'Mutations are not allowed on this endpoint' })
  }

  try {
    const r = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      }
    )
    const json = await r.json()
    return res.status(r.status).json(json)
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', message: err.message })
  }
}
