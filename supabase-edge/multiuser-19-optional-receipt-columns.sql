-- Makes the "optional" receipt columns part of the numbered migration chain.
--
-- multiuser-01-schema.sql was written against a live schema where these
-- columns did NOT exist (their data lived only inside raw_ocr_json), and no
-- numbered migration ever created them — yet they're present on the live
-- project now (backfill-null-optional-receipt-columns.sql writes to them),
-- added at some point outside this chain. That left a fresh environment
-- built from multiuser-0N-*.sql without them, which is why insertReceipt
-- still retries without these columns on a missing-column error.
--
-- `add column if not exists` makes this a no-op wherever they already exist.
-- The client-side retry fallback is deliberately left in place — harmless,
-- and still protects any environment this hasn't been run on yet.
--
-- Run after multiuser-18-rename-household-category.sql. Safe to re-run.

begin;

alter table public.receipts
  add column if not exists receipt_amount numeric,
  add column if not exists receipt_currency text,
  add column if not exists conversion_rate numeric,
  add column if not exists converted_total numeric,
  add column if not exists default_currency text;

notify pgrst, 'reload schema';

commit;
