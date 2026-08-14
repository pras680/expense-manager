-- Two sms_inbox pipeline fixes:
--
-- 1. Transient failures (e.g. parse-receipt briefly 502ing) previously stuck a
--    row in status='failed' forever — process-sms-inbox only ever re-fetches
--    status='pending'. retry_count lets a bounded number of retries happen on
--    later ticks instead of requiring someone to manually reset the row.
--
-- 2. Reversal SMS were detected but only ever skipped, leaving the original
--    charge's receipt uncancelled in totals. reversal_of_receipt_id lets a
--    reversal insert an offsetting negative receipt tied back to the original,
--    and stops the same original from being offset twice.

alter table public.sms_inbox
  add column if not exists retry_count int not null default 0;

alter table public.receipts
  add column if not exists reversal_of_receipt_id uuid references public.receipts(id) on delete set null;

create index if not exists receipts_reversal_of_receipt_id_idx
  on public.receipts (reversal_of_receipt_id)
  where reversal_of_receipt_id is not null;
