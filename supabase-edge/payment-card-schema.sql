-- Run this in Supabase SQL Editor to support card last-4 lookup and reporting.

-- Store card metadata on saved receipts.
alter table public.receipts
  add column if not exists card_last4 text,
  add column if not exists card_bank text;

create index if not exists receipts_card_bank_last4_idx
  on public.receipts(card_bank, card_last4);

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

-- Development note:
-- If RLS is enabled, add select policy for payment_methods and insert/update/select
-- policies for receipts, or keep RLS disabled while testing without user auth.
