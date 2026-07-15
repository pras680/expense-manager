-- Run this in Supabase SQL Editor to support card last-4 lookup and reporting.

-- Store card metadata and original receipt values on saved receipts.
-- `total` is the reporting amount in the app default currency (SGD by default).
-- `receipt_amount` and `receipt_currency` preserve what was printed on the receipt.
alter table public.receipts
  add column if not exists card_last4 text,
  add column if not exists card_bank text,
  add column if not exists default_currency text not null default 'SGD',
  add column if not exists receipt_amount numeric,
  add column if not exists receipt_currency text,
  add column if not exists conversion_rate numeric,
  add column if not exists converted_total numeric;

update public.receipts
set receipt_currency = coalesce(receipt_currency, currency, default_currency, 'SGD'),
    receipt_amount = coalesce(receipt_amount, total),
    conversion_rate = coalesce(conversion_rate, 1),
    converted_total = coalesce(converted_total, total),
    default_currency = coalesce(default_currency, 'SGD')
where receipt_currency is null
   or receipt_amount is null
   or conversion_rate is null
   or converted_total is null
   or default_currency is null;

create index if not exists receipts_card_bank_last4_idx
  on public.receipts(card_bank, card_last4);

create index if not exists receipts_default_currency_idx
  on public.receipts(default_currency);

-- Refresh PostgREST's schema cache after adding receipt columns.
notify pgrst, 'reload schema';

-- Lookup table maintained by the app owner.
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  last_digits text not null unique check (last_digits ~ '^[0-9]{4}$'),
  bank_name text not null,
  card_name text,
  created_at timestamptz not null default now()
);

create index if not exists payment_methods_last_digits_idx
  on public.payment_methods(last_digits);

-- Example lookup rows. Replace these with your real cards.
insert into public.payment_methods (last_digits, bank_name, card_name)
values
  ('4242', 'DBS', 'DBS Visa'),
  ('1234', 'OCBC', 'OCBC Mastercard'),
  ('9876', 'UOB', 'UOB Visa')
on conflict (last_digits) do update
set bank_name = excluded.bank_name,
    card_name = excluded.card_name;

-- SECURITY / RLS NOTE:
-- The current iOS app is anon-first for a single-user setup and does not require
-- Supabase Auth. If you enable RLS without Auth, auth.uid() is NULL, so per-user
-- policies will block the app. Use `rls-single-user-anon-policies.sql` for the
-- current single-user anon mode.
--
-- Caveat: broad anon policies are only acceptable for this private single-user
-- setup because every holder of the app key would share the same access. Do not
-- use broad anon read/write policies for a multi-user/private production app.
--
-- Recommended production model:
--   1. Add Supabase Auth to the app.
--   2. Add a user_id owner column to receipts and payment_methods.
--   3. Store receipt files under a user-scoped storage prefix such as <uid>/<file>.
--   4. Enable the policies below.
--
-- If older receipts disappeared after switching to Auth-backed RLS, they probably
-- have NULL user_id. Run `supabase-edge/rls-backfill-existing-receipts.sql` to
-- assign existing rows to the intended Supabase Auth user.
--
-- Example Auth-backed RLS migration:
-- alter table public.receipts
--   add column if not exists user_id uuid references auth.users(id) on delete cascade;
--
-- alter table public.payment_methods
--   add column if not exists user_id uuid references auth.users(id) on delete cascade;
--
-- alter table public.receipts
--   alter column user_id set default auth.uid();
--
-- alter table public.payment_methods
--   alter column user_id set default auth.uid();
--
-- create index if not exists receipts_user_id_idx on public.receipts(user_id);
-- create index if not exists payment_methods_user_id_idx on public.payment_methods(user_id);
--
-- alter table public.receipts enable row level security;
-- alter table public.payment_methods enable row level security;
--
-- create policy "Users can read own receipts"
--   on public.receipts for select
--   using (auth.uid() = user_id);
--
-- create policy "Users can insert own receipts"
--   on public.receipts for insert
--   with check (auth.uid() = user_id);
--
-- create policy "Users can update own receipts"
--   on public.receipts for update
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
--
-- create policy "Users can delete own receipts"
--   on public.receipts for delete
--   using (auth.uid() = user_id);
--
-- create policy "Users can read own payment methods"
--   on public.payment_methods for select
--   using (auth.uid() = user_id);
--
-- create policy "Users can insert own payment methods"
--   on public.payment_methods for insert
--   with check (auth.uid() = user_id);
--
-- create policy "Users can update own payment methods"
--   on public.payment_methods for update
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
--
-- create policy "Users can delete own payment methods"
--   on public.payment_methods for delete
--   using (auth.uid() = user_id);
--
-- Storage RLS example for bucket receipt-documents, when file paths begin with uid/:
-- create policy "Users can read own receipt files"
--   on storage.objects for select
--   using (bucket_id = 'receipt-documents' and (storage.foldername(name))[1] = auth.uid()::text);
--
-- create policy "Users can upload own receipt files"
--   on storage.objects for insert
--   with check (bucket_id = 'receipt-documents' and (storage.foldername(name))[1] = auth.uid()::text);
--
-- create policy "Users can update own receipt files"
--   on storage.objects for update
--   using (bucket_id = 'receipt-documents' and (storage.foldername(name))[1] = auth.uid()::text)
--   with check (bucket_id = 'receipt-documents' and (storage.foldername(name))[1] = auth.uid()::text);
--
-- create policy "Users can delete own receipt files"
--   on storage.objects for delete
--   using (bucket_id = 'receipt-documents' and (storage.foldername(name))[1] = auth.uid()::text);
