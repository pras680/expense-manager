-- Single-user anon RLS policies for Bill Skills.
--
-- Use this only for your current single-user setup with no Supabase Auth.
-- The iOS app sends the publishable/anon key as both `apikey` and bearer token,
-- so these policies allow that anon role to read/write the app tables.
--
-- Security caveat: anyone with the app publishable key has the same access.
-- This is not appropriate for multi-user or highly private production data.
-- When you later add Supabase Auth, replace these policies with per-user
-- `auth.uid() = user_id` policies and run the auth backfill script.

begin;

alter table public.receipts enable row level security;
alter table public.payment_methods enable row level security;

-- Remove prior single-user anon policies so this script can be rerun safely.
drop policy if exists "Single user anon can read receipts" on public.receipts;
drop policy if exists "Single user anon can insert receipts" on public.receipts;
drop policy if exists "Single user anon can update receipts" on public.receipts;
drop policy if exists "Single user anon can delete receipts" on public.receipts;

drop policy if exists "Single user anon can read payment methods" on public.payment_methods;
drop policy if exists "Single user anon can insert payment methods" on public.payment_methods;
drop policy if exists "Single user anon can update payment methods" on public.payment_methods;
drop policy if exists "Single user anon can delete payment methods" on public.payment_methods;

create policy "Single user anon can read receipts"
  on public.receipts for select
  to anon
  using (true);

create policy "Single user anon can insert receipts"
  on public.receipts for insert
  to anon
  with check (true);

create policy "Single user anon can update receipts"
  on public.receipts for update
  to anon
  using (true)
  with check (true);

create policy "Single user anon can delete receipts"
  on public.receipts for delete
  to anon
  using (true);

create policy "Single user anon can read payment methods"
  on public.payment_methods for select
  to anon
  using (true);

create policy "Single user anon can insert payment methods"
  on public.payment_methods for insert
  to anon
  with check (true);

create policy "Single user anon can update payment methods"
  on public.payment_methods for update
  to anon
  using (true)
  with check (true);

create policy "Single user anon can delete payment methods"
  on public.payment_methods for delete
  to anon
  using (true);

notify pgrst, 'reload schema';

commit;
