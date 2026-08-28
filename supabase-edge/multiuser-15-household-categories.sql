-- Household-custom expense categories, layered on top of the fixed base
-- list in webapp/src/lib/categories.ts (EXPENSE_CATEGORIES) — this table
-- only ever stores ADDITIONS, never the built-ins, so there's nothing here
-- that can shadow or delete 'Local Transfer' / 'Credit Card Bill Payment',
-- which stay hardcoded and untouched.
--
-- Safe to re-run.

begin;

create table if not exists public.household_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive: prevents "Pet Supplies" and "pet supplies" coexisting as
-- two different rows in the same household.
create unique index if not exists household_categories_household_name_idx
  on public.household_categories (household_id, lower(name));

alter table public.household_categories enable row level security;

drop policy if exists "Members read household categories" on public.household_categories;
drop policy if exists "Members insert household categories" on public.household_categories;
drop policy if exists "Members delete household categories" on public.household_categories;

-- Same shape as payment_methods' household-shared policies
-- (multiuser-04-rls.sql). No update policy: this feature is add/delete only.
create policy "Members read household categories"
  on public.household_categories for select to authenticated
  using (household_id in (select public.current_household_ids()));

create policy "Members insert household categories"
  on public.household_categories for insert to authenticated
  with check (household_id in (select public.current_household_ids()));

create policy "Members delete household categories"
  on public.household_categories for delete to authenticated
  using (household_id in (select public.current_household_ids()));

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select * from public.household_categories limit 5;
