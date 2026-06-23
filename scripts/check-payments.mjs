// scripts/check-payments.mjs — diagnostic acomptes / paiements Shopify.
//
// But : vérifier comment les acomptes sont enregistrés, et si la trace
// (acompte + solde) survit une fois la commande marquée PAID.
//
// Prérequis : ajouter dans .env.local (en plus des clés Supabase) :
//   SHOPIFY_STORE_DOMAIN=xxxx.myshopify.com
//   SHOPIFY_ADMIN_TOKEN=shpat_...
//   SHOPIFY_API_VERSION=2025-04   (optionnel)
// Ces valeurs se récupèrent dans l'env Vercel du projet (Settings → Environment Variables).
//
// Usage :
//   node scripts/check-payments.mjs                  100 dernières commandes (résumé)
//   node scripts/check-payments.mjs --limit 250
//   node scripts/check-payments.mjs --tag depo       filtre sur un tag
//   node scripts/check-payments.mjs --order 1636     diagnostic détaillé d'UNE commande
//   node scripts/check-payments.mjs --json           sortie brute

try {
  process.loadEnvFile(new URL('../.env.local', import.meta.url))
} catch {
  console.error('⚠️  Impossible de lire .env.local')
  process.exit(1)
}

const domain = process.env.SHOPIFY_STORE_DOMAIN
const token = process.env.SHOPIFY_ADMIN_TOKEN
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-04'

if (!domain || !token) {
  console.error(
    '⚠️  SHOPIFY_STORE_DOMAIN ou SHOPIFY_ADMIN_TOKEN manquant dans .env.local.\n' +
      '   Récupère-les dans Vercel → Settings → Environment Variables.'
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const getOpt = (name, def) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : def
}
const limit = Math.min(Number(getOpt('--limit', 100)) || 100, 250)
const tag = getOpt('--tag', null)
const orderName = getOpt('--order', null) // ex: 1636 ou #1636

const queryParts = ['NOT tag:removed', 'total_price:>1']
if (tag) queryParts.push(`tag:${tag}`)
if (orderName) {
  // recherche par numéro de commande (name)
  queryParts.length = 0
  queryParts.push(`name:${String(orderName).replace(/^#/, '')}`)
}
const filter = queryParts.join(' AND ')

const QUERY = `
  query payments($first: Int!, $query: String!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          createdAt
          displayFinancialStatus
          tags
          totalPriceSet { shopMoney { amount currencyCode } }
          totalReceivedSet { shopMoney { amount } }
          totalOutstandingSet { shopMoney { amount } }
          transactions(first: 20) {
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

const r = await fetch(
  `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
  {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: QUERY, variables: { first: limit, query: filter } }),
  }
)
const json = await r.json()
if (!r.ok || json.errors) {
  console.error('✗ Shopify error', JSON.stringify(json.errors || json, null, 2))
  process.exit(1)
}

const orders = (json.data?.orders?.edges || []).map((e) => e.node)

if (flags.has('--json')) {
  console.log(JSON.stringify(orders, null, 2))
  process.exit(0)
}

// Une transaction "encaissante" = paiement effectivement reçu.
const PAY_KINDS = new Set(['SALE', 'CAPTURE'])
const isPaid = (t) => PAY_KINDS.has(t.kind) && t.status === 'SUCCESS'

const fmt = (n) => Number(n || 0).toFixed(2)
const day = (iso) => (iso ? iso.slice(0, 10) : '—')

// Mode détaillé : une seule commande, on déballe chaque transaction.
if (orderName) {
  const o = orders[0]
  if (!o) {
    console.error(`✗ Commande "${orderName}" introuvable.`)
    process.exit(1)
  }
  console.log(`\n=== Commande ${o.name} ===`)
  console.log(`Créée le        : ${day(o.createdAt)}`)
  console.log(`Statut financier: ${o.displayFinancialStatus}`)
  console.log(`Tags            : ${(o.tags || []).join(', ') || '—'}`)
  console.log(`Total           : ${fmt(o.totalPriceSet?.shopMoney?.amount)} ${o.totalPriceSet?.shopMoney?.currencyCode || ''}`)
  console.log(`Reçu            : ${fmt(o.totalReceivedSet?.shopMoney?.amount)}`)
  console.log(`Reste dû        : ${fmt(o.totalOutstandingSet?.shopMoney?.amount)}`)
  console.log(`\nTransactions (${(o.transactions || []).length}) :`)
  for (const t of o.transactions || []) {
    console.log(
      `  • ${day(t.processedAt)}  ${String(t.kind).padEnd(12)} ${String(t.status).padEnd(8)} ` +
        `${fmt(t.amountSet?.shopMoney?.amount).padStart(9)}  (${t.gateway || '—'})`
    )
  }
  const payTx = (o.transactions || []).filter(isPaid)
  const dates = [...new Set(payTx.map((t) => day(t.processedAt)))]
  console.log(
    `\n→ ${payTx.length} paiement(s) encaissé(s) sur ${dates.length} date(s) : ${dates.join(', ')}`
  )
  console.log(
    payTx.length > 1
      ? '✅ Payée en plusieurs fois → acompte détectable via transactions, même si statut = PAID.'
      : 'ℹ️  Un seul paiement encaissé → pas de trace "acompte" côté transactions.'
  )
  process.exit(0)
}

let nbAcompteVisibleApresPaiement = 0

console.log(`\n${orders.length} commande(s) — domaine ${domain}\n`)
console.log(
  'Commande   Statut            Total    Reçu     Dû       Tx paiement (dates)        depo?'
)
console.log('-'.repeat(110))

for (const o of orders) {
  const total = o.totalPriceSet?.shopMoney?.amount
  const received = o.totalReceivedSet?.shopMoney?.amount
  const outstanding = o.totalOutstandingSet?.shopMoney?.amount
  const payTx = (o.transactions || []).filter(isPaid)
  const dates = [...new Set(payTx.map((t) => day(t.processedAt)))]
  const hasDepoTag = (o.tags || []).some((t) => /^depo$/i.test(t))

  // Cas qui nous intéresse : commande SOLDÉE mais payée en plusieurs fois
  // => la trace de l'acompte n'existe QUE dans les transactions.
  const fullyPaid = Number(outstanding) === 0 && Number(received) > 0
  const multiPayment = payTx.length > 1
  if (fullyPaid && multiPayment) nbAcompteVisibleApresPaiement++

  const flag =
    fullyPaid && multiPayment ? ' ⬅ acompte tracé via transactions' : ''

  console.log(
    `${(o.name || '').padEnd(10)} ${(o.displayFinancialStatus || '').padEnd(17)} ` +
      `${fmt(total).padStart(8)} ${fmt(received).padStart(8)} ${fmt(outstanding).padStart(8)}  ` +
      `${String(payTx.length)}× [${dates.join(', ')}]`.padEnd(26) +
      ` ${hasDepoTag ? 'oui' : '—'}${flag}`
  )
}

console.log('\n─── Synthèse ───')
console.log(
  `Commandes soldées (PAID) payées en plusieurs transactions : ${nbAcompteVisibleApresPaiement}`
)
console.log(
  nbAcompteVisibleApresPaiement > 0
    ? '✅ Les acomptes laissent une trace permanente dans transactions, même après paiement complet.'
    : 'ℹ️  Aucune commande soldée multi-paiements trouvée sur cet échantillon —\n' +
        '   soit les acomptes ne sont pas encore soldés, soit ils ne sont pas enregistrés comme transactions Shopify.'
)
