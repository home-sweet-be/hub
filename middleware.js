import { next } from '@vercel/functions'

// Vercel Routing Middleware — tourne AVANT les fonctions api/*.js, sur une
// couche à part qui ne compte pas dans la limite de 12 fonctions Hobby.
// Protège les endpoints internes du hub par un token partagé ; laisse
// passer les endpoints utilisés par les pages publiques (réservation
// client, facture) sans authentification.
// Runtime Edge (par défaut) : Web Crypto uniquement, pas d'API Node.
export const config = {
  matcher: ['/api/:path*'],
}

const LOGIN_PATH = '/api/__login'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 jours

// Endpoints appelés directement par les pages publiques (planification
// livraison, facture) — pas de mot de passe Alessandro à ce stade.
const PUBLIC_API_PATHS = new Set([
  '/api/shopify/verify-order',
  '/api/shopify/order-set-delivery-date',
  '/api/email/booking-notify',
])

const encoder = new TextEncoder()

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return toHex(sig)
}

async function makeToken(secret) {
  const exp = Date.now() + SESSION_TTL_MS
  return `${exp}.${await sign(String(exp), secret)}`
}

async function verifyToken(token, secret) {
  if (!token) return false
  const [exp, sig] = String(token).split('.')
  if (!exp || !sig) return false
  if (!Number.isFinite(Number(exp)) || Date.now() > Number(exp)) return false
  const expected = await sign(exp, secret)
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}

function unauthorized(message) {
  return new Response(JSON.stringify({ error: message || 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

export default async function middleware(request) {
  const url = new URL(request.url)
  const { pathname } = url

  // Lookup facture publique : un seul numéro de commande à la fois.
  if (pathname === '/api/shopify/receptions') {
    const q = url.searchParams.get('q') || ''
    if (/^name:/.test(q)) return next()
  } else if (PUBLIC_API_PATHS.has(pathname)) {
    return next()
  }

  const secret = process.env.HUB_AUTH_SECRET
  const password = process.env.HUB_PASSWORD
  if (!secret || !password) {
    // Pas configuré : ne pas casser le hub tant que les variables d'env
    // ne sont pas posées côté Vercel.
    return next()
  }

  if (pathname === LOGIN_PATH) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      })
    }
    let supplied
    try {
      const body = await request.json()
      supplied = String(body?.password || '')
    } catch {
      return unauthorized('bad request')
    }
    if (supplied !== password) return unauthorized('invalid password')
    return new Response(JSON.stringify({ token: await makeToken(secret) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!(await verifyToken(token, secret))) return unauthorized()

  return next()
}
