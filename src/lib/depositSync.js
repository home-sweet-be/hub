// depositSync — alimente et lit le cache Supabase `deposit_orders`.
//
// Le hub appelle syncDepositOrders() au chargement (App.jsx). On fait UN fetch
// receptions?withTx=1 sur une fenêtre récente, on détecte les commandes ayant
// eu un acompte, et on upsert juste leur id/numéro dans deposit_orders. Les
// pages lisent ensuite fetchDepositOrderNumbers() (set de numéros) au lieu de
// recharger les transactions et recalculer à la volée.
import { supabase } from './supabase'

// Détection d'un acompte, sans dépendre du tag depo : encaissée en >=2
// versements (acompte + solde — trace permanente même une fois PAID) OU encore
// PARTIALLY_PAID (acompte versé, solde pas encore fait). Nécessite o.transactions
// (renvoyées par receptions?withTx=1).
export function hadDeposit(o) {
  const paid = (o.transactions || []).filter(
    (t) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS'
  )
  const installments = new Set(
    paid.map((t) => (t.processedAt || '').slice(0, 10))
  ).size
  return installments >= 2 || o.financialStatus === 'PARTIALLY_PAID'
}

const ymd = (d) => d.toISOString().slice(0, 10)

// Scanne les commandes récentes, détecte les acomptes et upsert (par order_id)
// leur identité dans deposit_orders. Best-effort : toute erreur est avalée pour
// ne jamais casser le chargement du hub. Additif (on n'efface pas).
export async function syncDepositOrders({ days = 180 } = {}) {
  try {
    const since = new Date(Date.now() - days * 86400000)
    const q = `created_at:>=${ymd(since)} AND NOT tag:removed`
    const r = await fetch(
      '/api/shopify/receptions?withTx=1&first=250&q=' + encodeURIComponent(q)
    )
    if (!r.ok) return
    const data = await r.json()
    const deposits = (data.orders || []).filter(hadDeposit)
    if (!deposits.length) return

    const now = new Date().toISOString()
    const rows = deposits.map((o) => ({
      order_id: String(o.id || '').split('/').pop(),
      order_number: o.name,
      financial_status: o.financialStatus || null,
      order_created_at: o.createdAt || null,
      updated_at: now,
    }))
    await supabase
      .from('deposit_orders')
      .upsert(rows, { onConflict: 'order_id' })
  } catch {
    // best effort — ne jamais propager
  }
}

// Renvoie l'ensemble des numéros de commande ayant eu un acompte (cache).
export async function fetchDepositOrderNumbers() {
  try {
    const { data, error } = await supabase
      .from('deposit_orders')
      .select('order_number')
    if (error || !data) return new Set()
    return new Set(data.map((row) => row.order_number))
  } catch {
    return new Set()
  }
}
