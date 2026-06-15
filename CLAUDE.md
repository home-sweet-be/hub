# homesweet-hub

Hub interne de gestion logistique/livraison pour **HomeSweet** (boutique Shopify de meubles, Belgique). SPA React embarquée en iframe dans l'admin Shopify. UI en **français** (locale `fr-BE`).

## Stack
- **Vite 8** + **React 19** (JSX, pas de TypeScript) + **React Router v7**
- **Supabase** (`@supabase/supabase-js`) — uniquement créneaux & réservations de livraison
- **API serverless Vercel** (`api/**/*.js`) — proxy vers Shopify Admin API, Resend, Supabase service-role
- **Mapbox GL** — heatmap zones, picker de zone, affichage d'adresse
- **Resend** — emails de notification clients
- **xlsx-js-style** — export tableur (Rapports)
- Déployé sur **Vercel**. `vercel.json` : rewrite SPA (sauf `/api/`) + CSP `frame-ancestors` pour l'embed Shopify.

## Commandes
```bash
npm run dev        # Vite (front seul)
npm run dev:api    # vercel dev (front + fonctions /api)
npm run build      # build prod -> dist/
npm run preview
npm run lint       # eslint
```
Note : les routes `/api/*` ne tournent **pas** sous `npm run dev` seul — utiliser `npm run dev:api`.

## Architecture clé
- **Shopify = source de vérité** pour commandes / clients / produits / stock. Le hub lit via GraphQL (principalement) et REST.
- **Les tags Shopify portent l'état** des commandes (machine à états, voir ci-dessous).
- **Supabase ne stocke que** : créneaux (`delivery_slots`), réservations (`delivery_bookings`), et coûts mensuels (`monthly_costs` — pour Rentabilité → Calendrier). Aucune commande en base. Schéma géré à la main dans Supabase (pas de dossier migrations ; cf. `db/*.sql` pour les scripts à exécuter).
- **Embed iframe** : `App.jsx` mesure `.hub-shell` et `postMessage('homesweet:hub-height')` au parent pour ajuster la hauteur (évite double scrollbar / iframe grise).

### Tags Shopify = états de commande
| Tag | Sens |
|-----|------|
| `SentToSupplier` | Envoyée au fournisseur, en attente de stock |
| `ProduitEnStock` | Produit reçu / en stock |
| `PretPourLaLivraison` | Prête à livrer — le client peut réserver un créneau |
| `WaitingList` | En attente d'ouverture de créneau (notifiée quand dispo) |
| `removed` | Retirée — exclue de toutes les vues |

### Tags de zone (géo livraison)
Format `{PAYS}-{REGION}` posé sur la **commande** ou le **client** (le tag client sert de fallback). Ex : `BE-Bruxelles`, `FR-Nord`, `LU`, `LIV-Externe`. Provinces BE : Anvers, Bruxelles, Flandre-Occidentale/Orientale, Hainaut-Est/Ouest, Limbourg, Liège, Luxembourg, Namur.

### Attributs custom de commande (Shopify)
- `Delivery Date` (YYYY-MM-DD) — posé par le planificateur / la page publique
- `Monte-charge` (Oui/Non)
- Les attributs existants (EasyRoutes, etc.) sont **préservés** lors des updates.

### Fournisseurs / paliers
- Fournisseurs : **INTERCOMMERCE** (défaut) et **ELTAP** (distingués par vendor de line item).
- Paliers de livraison : Standard / Confort / Premium (extraits du titre du shipping line Shopify).

## Routing (`src/App.jsx`)
Modules sidebar : Commandes · Logistique · Livraisons · Compta · Rapports.
- `/commandes` — toutes les commandes (~150 derniers jours)
- `/logistique` — workflow Fournisseurs → Réceptions → Prêtes (onglets). `/receptions` et `/fournisseurs` redirigent ici.
- `/livraisons` → `waitinglist` (WaitingList) / `planifier` (planning carte) / `semaine` (agenda hebdo)
- `/compta` — compta mensuelle
- `/notifications` — réconciliation emails (Suivi) + renvoi manuel. `/emails` redirige ici.
- `/rapports` — meilleures ventes
- `/rentabilite` — onglets **Calendrier** (rentabilité par mois sur 12 mois, coûts marketing + frais fixes éditables stockés dans `monthly_costs`) et **Calculateur** (marge par commande / par produit)
- `/planification-livraison` — **page publique** de réservation client (hors shell)

## API (`api/`)
**Shopify** (`api/shopify/`, toutes via `SHOPIFY_ADMIN_TOKEN`) :
- `receptions.js` — **liste principale** des commandes (GraphQL, filtrée/paginée)
- `orders.js` — liste REST simple ; `products.js` — produits + SKU/prix/coût
- `verify-order.js` — valide une commande (nom + email) pour la réservation publique
- `order-set-delivery-date.js` — pose `Delivery Date` / `Monte-charge` (merge attributs)
- `orders/tags.js` — ajout/retrait de tags en masse (commandes **ou** clients)
- `inventory/adjust.js` — ajuste le stock (delta sur inventory item)

**Email / notifs** :
- `email/notify-zone-slot.js` — notifie en masse les WaitingList d'une zone (Resend + exclut déjà réservés via Supabase)
- `email/booking-notify.js` — notif interne équipe après réservation
- `email/status.js` / `email/list.js` — statut / historique Resend
- `notifications/index.js` — GET réconciliation (Shopify WaitingList × Resend × Supabase) / POST renvoi

## Variables d'env
Front (`VITE_`, exposées navigateur) : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPBOX_TOKEN`.
Back (serveur uniquement) : `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_API_VERSION`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `BOOKING_URL`, `BOOKING_NOTIFY_TO`.
⚠️ Ne jamais préfixer un secret serveur avec `VITE_` (sinon exposé au navigateur).

## Composants / lib partagés
- `lib/supabase.js` (singleton client) · `lib/reload.js` (contexte de refresh global, bouton header)
- `components/` : ZoneModal/ZoneMapPicker/ZoneFlag (zones), SlotModal (créneaux→Supabase), StockAdjustModal (→ inventory/adjust), AddressModal & BelgiumHeatmap (Mapbox), ConfirmModal, ErrorBoundary, OrdersTableSkeleton.

## Conventions
- Pas de TypeScript — JSX pur. Suivre le style des fichiers voisins.
- Git : branche courante `master`, branche principale `main`. Commits conventionnels (`feat(scope): …`).
