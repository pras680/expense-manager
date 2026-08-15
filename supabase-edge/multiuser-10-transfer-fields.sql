-- Adds structured fields for the new 'Money Transfer' category — a bank/PayNow/
-- PayLah transfer needs from-bank/to-bank/self-or-external, not a merchant-shaped
-- card_last4/card_bank pair. Nullable and only ever populated when
-- category = 'Money Transfer'; every other category leaves these null.
--
-- 'Money Transfer' and 'Credit Card Bill Payment' are both excluded from
-- expense totals client-side (see webapp/src/lib/categories.ts
-- NON_EXPENSE_CATEGORIES) — this migration only adds the transfer detail
-- columns, the exclusion logic itself has no DB component.

alter table public.receipts add column if not exists transfer_from_bank text;
alter table public.receipts add column if not exists transfer_to_bank text;
alter table public.receipts add column if not exists transfer_kind text;

alter table public.receipts drop constraint if exists receipts_transfer_kind_check;
alter table public.receipts add constraint receipts_transfer_kind_check
  check (transfer_kind is null or transfer_kind in ('self', 'external'));
