import { createContext, useContext } from 'react'

// Le hub sert deux boutiques Shopify de la même société : Dazzuro (PUSZMAN,
// ERELITA) et Home Sweet (INTERCOMMERCE, ELTAP). Commandes, Logistique et
// Rapports se consultent boutique par boutique ; le reste du hub reste sur
// Dazzuro.
export const STORES = [
  { id: 'dazzuro', label: 'Dazzuro' },
  { id: 'homesweet', label: 'Home Sweet' },
]

export const DEFAULT_STORE = 'dazzuro'

// Routes qui affichent les onglets de boutique.
export const STORE_SCOPED_PATHS = ['/commandes', '/logistique', '/rapports']

export function isStoreScopedPath(pathname) {
  return STORE_SCOPED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

const STORE_KEY = 'hub_store'

export function loadStoredStore() {
  try {
    const s = localStorage.getItem(STORE_KEY)
    return STORES.some((x) => x.id === s) ? s : DEFAULT_STORE
  } catch {
    return DEFAULT_STORE
  }
}

export function saveStoredStore(id) {
  try {
    localStorage.setItem(STORE_KEY, id)
  } catch {
    // stockage indisponible : le choix n'est simplement pas mémorisé
  }
}

// Boutique ciblée par les appels /api/* en cours. Lue par le fetch patché de
// hubAuth.js, qui ajoute `store=` à l'URL quand ce n'est pas Dazzuro.
let apiStore = DEFAULT_STORE

export function setApiStore(id) {
  apiStore = id || DEFAULT_STORE
}

export function getApiStore() {
  return apiStore
}

export const StoreContext = createContext({
  store: DEFAULT_STORE,
  setStore: () => {},
})

export const useStore = () => useContext(StoreContext)

// Onglets fournisseurs par boutique. `others` sert à l'onglet « fourre-tout »
// (catchAll) : il prend toute ligne dont le vendor n'est pas un autre
// fournisseur de la liste — c'est l'ancien comportement d'INTERCOMMERCE.
// Dazzuro garde INTERCOMMERCE et ELTAP pour les commandes passées avant la
// séparation des boutiques.
const SUPPLIERS = {
  dazzuro: [
    { id: 'puszman', vendor: 'PUSZMAN' },
    { id: 'erelita', vendor: 'ERELITA' },
    { id: 'intercommerce', vendor: 'INTERCOMMERCE', catchAll: true },
    { id: 'eltap', vendor: 'ELTAP' },
  ],
  homesweet: [
    { id: 'intercommerce', vendor: 'INTERCOMMERCE', catchAll: true },
    { id: 'eltap', vendor: 'ELTAP' },
  ],
}

export function suppliersFor(store) {
  const list = SUPPLIERS[store] || SUPPLIERS[DEFAULT_STORE]
  const named = list.filter((s) => !s.catchAll).map((s) => s.vendor)
  return list.map((s) => ({
    ...s,
    matches: s.catchAll
      ? (vendor) => !named.includes(vendor)
      : (vendor) => vendor === s.vendor,
  }))
}
