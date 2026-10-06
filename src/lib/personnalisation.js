// Personnalisation de tissu : ce qui ne doit PAS apparaître en comptabilité.
//
// La vente additionnelle de personnalisation de tissu est traitée à part : les
// rapports comptables ne montrent que les PRIX DE BASE. Elle prend trois formes
// dans les commandes Shopify :
//
//  1. Une ligne libre ajoutée à la main (sans variante) : « Tissu personnalisé
//     tilia 39 », « Personnalisation coussins », « Rose tilia 62 tissu
//     personnalisé »… -> retirée en entier.
//     Attention : des meubles vendus en ligne libre portent aussi le mot
//     « tissu » (« Giovanni COTTL tissu dove 15 legacy », « Pouf tissu dove 15
//     legacy personnalisé ») : ils restent. Seul compte un titre qui COMMENCE
//     par « tissu » / « personnalisation », ou qui contient « tissu personnalisé ».
//
//  2. La variante « Texture personnalisée — Gamme N » (depuis septembre 2026) :
//     le supplément est DANS le prix (gamme I +10 % … VII +70 %, cf. le thème,
//     scripts/gammes-variantes.js). Prix de base = montant / (1 + taux).
//     L'ancienne variante « Texture personnalisée » sans gamme était au prix
//     standard : rien à retirer.
//
//  3. Le configurateur 3D (produit « Canapé personnalisé ») : la gamme est
//     écrite à la fin de la propriété « Texture » (« Ocre Touch me 03 — Gamme II »).
//     Même calcul.

const TAUX_GAMME = { I: 10, II: 20, III: 30, IV: 40, V: 50, VI: 60, VII: 70 }

function montant(li) {
  const n = parseFloat(li?.discountedTotalSet?.shopMoney?.amount)
  return Number.isFinite(n) ? n : 0
}

// Suppléments saisis à la main sous un titre qui ne le dit pas (commande 1649,
// juillet 2026 : confirmé par la direction). Cas isolé, ne se reproduit plus ;
// le meuble de la même commande « Giovanni right arms tissu dove 15 legacy »
// (1 499 €), lui, est une vente.
const SUPPLEMENTS_NOMMES = new Set(['giovanni cottl tissu dove 15 legacy'])

/** Ligne entièrement dédiée à la personnalisation (forme 1). */
export function isLignePersonnalisation(li) {
  if (li?.variant) return false // un vrai produit du catalogue
  const t = (li?.title || '').normalize('NFC').trim()
  if (SUPPLEMENTS_NOMMES.has(t.toLowerCase())) return true
  return (
    /^(tissu|personnalisation)\b/i.test(t) ||
    (/\btissu\b/i.test(t) && /personnalis/i.test(t)) // « Pouf tissu dove 15 legacy personnalisé »
  )
}

/** Gamme de personnalisation portée par la ligne (formes 2 et 3), ou ''. */
export function gammeDeLigne(li) {
  // « iv » avant « i » : sinon « Gamme IV » se lirait « Gamme I » suivi d'un v.
  const m = String(li?.variantTitle || '').match(/gamme\s+(vii|vi|iv|v|iii|ii|i)(?![a-z])/i)
  if (m) return m[1].toUpperCase()
  const tex = (li?.customAttributes || []).find((a) => /^texture$/i.test(a.key))
  const c = String(tex?.value || '').match(/[—–-]\s*\S+\s+(VII|VI|IV|V|III|II|I)\s*$/)
  return c ? c[1].toUpperCase() : ''
}

/** Supplément de personnalisation contenu dans la ligne, en euros. */
export function supplementLigne(li) {
  if (isLignePersonnalisation(li)) return montant(li)
  const taux = TAUX_GAMME[gammeDeLigne(li)]
  if (!taux) return 0
  const brut = montant(li)
  return brut - brut / (1 + taux / 100)
}

/**
 * Prix de base d'un montant brut de cette ligne (pages qui calculent le
 * montant elles-mêmes) : 0 pour une ligne de personnalisation, montant ÷
 * (1 + taux) pour une ligne « Gamme N », inchangé sinon.
 */
export function prixDeBase(li, brut) {
  if (isLignePersonnalisation(li)) return 0
  const taux = TAUX_GAMME[gammeDeLigne(li)]
  return taux ? brut / (1 + taux / 100) : brut
}

/** Montant de la ligne au prix de base (sans personnalisation). */
export function montantBaseLigne(li) {
  return montant(li) - supplementLigne(li)
}

/**
 * Total de la commande au prix de base : le total encaissé (livraison
 * comprise) moins toute la personnalisation des lignes actives.
 * `lignesActives` = lignes dont la quantité courante est > 0.
 */
export function totalBaseCommande(order, lignesActives) {
  const brut = Number(order?.total) || 0
  const perso = lignesActives.reduce((s, li) => s + supplementLigne(li), 0)
  return Math.max(0, Math.round((brut - perso) * 100) / 100)
}
