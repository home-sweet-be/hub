-- ================================================================
--  monthly_costs — Rentabilité → Calendrier
-- ================================================================
-- Two cost categories per month:
--   'marketing' : a single value (Facebook ad spend)
--   'fixed'     : a list of named monthly fixed costs (+ to add)
-- One row per cost. `month` is the first day of the month (date).
--
-- Run this once in the Supabase SQL editor. It is safe to re-run:
-- the table/policy use IF NOT EXISTS and the backfill is guarded.
-- ================================================================

create table if not exists public.monthly_costs (
  id         uuid        primary key default gen_random_uuid(),
  month      date        not null,
  category   text        not null check (category in ('marketing', 'fixed')),
  label      text        not null default '',
  amount     numeric     not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists monthly_costs_month_idx on public.monthly_costs (month);

-- Match the app's other tables: the browser uses the anon key to read/write.
alter table public.monthly_costs enable row level security;

drop policy if exists "monthly_costs anon all" on public.monthly_costs;
create policy "monthly_costs anon all"
  on public.monthly_costs for all
  to anon, authenticated
  using (true) with check (true);

-- ----------------------------------------------------------------
--  Backfill the last 12 months (relative to today):
--    5000 € marketing (Meta) + fixed: Divers 2000 € + Loyer 1000 € + Essence 500 €.
--  Guarded so re-running the script doesn't duplicate rows.
-- ----------------------------------------------------------------
insert into public.monthly_costs (month, category, label, amount)
select gs::date, 'marketing', 'Meta', 5000
from generate_series(
  date_trunc('month', now()) - interval '11 months',
  date_trunc('month', now()),
  interval '1 month'
) as gs
where not exists (
  select 1 from public.monthly_costs where category = 'marketing'
);

insert into public.monthly_costs (month, category, label, amount)
select gs::date, 'fixed', f.label, f.amount
from generate_series(
  date_trunc('month', now()) - interval '11 months',
  date_trunc('month', now()),
  interval '1 month'
) as gs
cross join (values ('Divers', 2000), ('Loyer', 1000), ('Essence', 500)) as f(label, amount)
where not exists (
  select 1 from public.monthly_costs where category = 'fixed'
);
