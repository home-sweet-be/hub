-- ================================================================
--  deposit_orders — cache des commandes ayant eu un acompte
-- ================================================================
-- But : éviter de recalculer « cette commande a-t-elle eu un acompte ? »
-- à la volée partout dans le hub (ce calcul nécessite de charger les
-- transactions Shopify). Le hub remplit cette table au chargement
-- (src/lib/depositSync.js) à partir d'un fetch receptions?withTx=1, et les
-- pages se contentent ensuite de tester l'appartenance par numéro de commande.
--
-- On ne stocke QUE l'identité de la commande, pas son contenu (Shopify reste
-- la source de vérité). Détection d'un acompte = encaissée en >=2 versements
-- (trace permanente même une fois PAID) OU encore PARTIALLY_PAID.
--
-- À exécuter une fois dans l'éditeur SQL Supabase. Ré-exécutable sans risque
-- (IF NOT EXISTS).
-- ================================================================

create table if not exists public.deposit_orders (
  order_id         text        primary key,   -- id numérique Shopify, ex "10869174501699"
  order_number     text        not null,       -- numéro affiché, ex "1596"
  financial_status text,                        -- snapshot (PARTIALLY_PAID / PAID…)
  order_created_at timestamptz,                 -- date de création de la commande
  updated_at       timestamptz not null default now()
);

create index if not exists deposit_orders_number_idx
  on public.deposit_orders (order_number);

-- Comme les autres tables du hub : le navigateur lit/écrit avec la clé anon.
alter table public.deposit_orders enable row level security;

drop policy if exists "deposit_orders anon all" on public.deposit_orders;
create policy "deposit_orders anon all"
  on public.deposit_orders for all
  to anon, authenticated
  using (true) with check (true);
