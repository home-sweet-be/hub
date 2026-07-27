const TOKEN_KEY = 'hub_token'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // stockage indisponible (navigation privée...) : session non persistée
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

// Le token est "exp.signature" (voir middleware.js) : l'expiration se lit
// sans aller-retour serveur.
export function isTokenValid(token) {
  if (!token) return false
  const [exp] = token.split('.')
  const n = Number(exp)
  return Number.isFinite(n) && Date.now() < n
}

export function isLoggedIn() {
  return isTokenValid(getToken())
}

export async function login(password) {
  const r = await fetch('/api/__login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.token) {
    throw new Error(data.error === 'invalid password' ? 'Mot de passe incorrect.' : 'Connexion impossible.')
  }
  setToken(data.token)
}

export function logout() {
  clearToken()
}

// Attache le token du hub aux appels /api/* faits par l'app (le shell
// interne). Les pages publiques (planification-livraison, facture) tournent
// sans token : les endpoints qu'elles appellent sont laissés ouverts par
// middleware.js, l'en-tête est simplement ignoré côté serveur.
export function installHubAuthFetch() {
  if (typeof window === 'undefined' || window.__hubAuthFetchInstalled) return
  window.__hubAuthFetchInstalled = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    const token = getToken()
    if (token && url.startsWith('/api/')) {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
      headers.set('Authorization', `Bearer ${token}`)
      return nativeFetch(input, { ...init, headers })
    }
    return nativeFetch(input, init)
  }
}
