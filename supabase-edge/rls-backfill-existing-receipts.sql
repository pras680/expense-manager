-- Auth-backed RLS repair script for receipts hidden after enabling Supabase RLS.
--
-- IMPORTANT: do NOT run this for the current single-user anon-policy setup.
-- Use `rls-single-user-anon-policies.sql` instead if you are not using Supabase Auth yet.
--
-- Symptom in Auth-backed mode: the app can save new receipts, but older receipts
-- no longer appear.
-- Cause: older rows usually have NULL user_id, while Auth-backed RLS policies only
-- allow reading rows where user_id = auth.uid().
--
-- Run this in the Supabase SQL Editor as the project owner only after adding
-- Supabase Auth to the app. Replace the email below with the Supabase Auth email
-- used by the app user.

begin;

-- 1) Ensure owner columns exist. These are safe if already present.
alter table public.receipts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.payment_methods
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2) Backfill old rows to the intended app user.
--    IMPORTANT: set this to the user's Supabase Auth email.
with target_user as (
  select id
  from auth.users
  where email = 'REPLACE_WITH_USER_EMAIL@example.com'
  limit 1
)
update public.receipts r
set user_id = target_user.id
from target_user
where r.user_id is null;

with target_user as (
  select id
  from auth.users
  where email = 'REPLACE_WITH_USER_EMAIL@example.com'
  limit 1
)
update public.payment_methods p
set user_id = target_user.id
from target_user
where p.user_id is null;

-- 3) Make future authenticated inserts get an owner automatically.
alter table public.receipts
  alter column user_id set default auth.uid();

alter table public.payment_methods
  alter column user_id set default auth.uid();

-- 4) Add supporting indexes.
create index if not exists receipts_user_id_idx on public.receipts(user_id);
create index if not exists payment_methods_user_id_idx on public.payment_methods(user_id);

-- 5) Enable RLS and recreate owner-based policies.
alter table public.receipts enable row level security;
alter table public.payment_methods enable row level security;

drop policy if exists "Users can read own receipts" on public.receipts;
drop policy if exists "Users can insert own receipts" on public.receipts;
drop policy if exists "Users can update own receipts" on public.receipts;
drop policy if exists "Users can delete own receipts" on public.receipts;

create policy "Users can read own receipts"
  on public.receipts for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own receipts"
  on public.receipts for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own receipts"
  on public.receipts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own receipts"
  on public.receipts for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can read own payment methods" on public.payment_methods;
drop policy if exists "Users can insert own payment methods" on public.payment_methods;
drop policy if exists "Users can update own payment methods" on public.payment_methods;
drop policy if exists "Users can delete own payment methods" on public.payment_methods;

create policy "Users can read own payment methods"
  on public.payment_methods for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own payment methods"
  on public.payment_methods for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own payment methods"
  on public.payment_methods for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own payment methods"
  on public.payment_methods for delete
  to authenticated
  using (auth.uid() = user_id);

-- 6) Confirm backfill before committing. These counts should be 0.
do $$
declare
  missing_receipts bigint;
  missing_payment_methods bigint;
begin
  select count(*) into missing_receipts from public.receipts where user_id is null;
  select count(*) into missing_payment_methods from public.payment_methods where user_id is null;

  if missing_receipts > 0 or missing_payment_methods > 0 then
    raise exception 'Backfill incomplete. receipts missing owner: %, payment_methods missing owner: %. Check the email placeholder.',
      missing_receipts, missing_payment_methods;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- For the current single-user app without Supabase Auth, use anon policies instead
-- of this script. See `rls-single-user-anon-policies.sql`.
-- Caveat: anon policies give every holder of the app publishable key the same
-- table access, so migrate to Auth-backed per-user RLS before multi-user use.
