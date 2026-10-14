// Résout la boutique Shopify visée par une requête du hub.
// Dossier préfixé « _ » : Vercel ne le déploie pas comme fonction (limite
// Hobby de 12 fonctions), il est seulement importé par les handlers.
//
// ?store=homesweet → boutique Home Sweet, clé SHOPIFY_ADMIN_TOKEN_HOMESWEET
// sinon (dazzuro)  → SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN
const HOMESWEET_DOMAIN = 'homesweet-eirsgivr.myshopify.com'

export function resolveStore(req) {
  const raw = String(req?.query?.store || '').toLowerCase()
  if (raw === 'homesweet') {
    return {
      id: 'homesweet',
      domain: HOMESWEET_DOMAIN,
      token: process.env.SHOPIFY_ADMIN_TOKEN_HOMESWEET,
      locationId: process.env.SHOPIFY_LOCATION_ID_HOMESWEET || null,
    }
  }
  return {
    id: 'dazzuro',
    domain: process.env.SHOPIFY_STORE_DOMAIN,
    token: process.env.SHOPIFY_ADMIN_TOKEN,
    locationId: process.env.SHOPIFY_LOCATION_ID || null,
  }
}
