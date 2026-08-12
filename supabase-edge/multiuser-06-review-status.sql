-- Adds provenance and review status to receipts.
--
-- Auto-imported receipts (SMS alerts, Gmail) are parsed by an LLM with no human
-- in the loop, so they need checking — dates and amounts do get misread. A
-- receipt the user typed in themselves needs no such check.
--
-- `reviewed_at` is household-wide rather than per-user on purpose: once one
-- member has confirmed a receipt is correct, it is correct for everyone, and
-- making each person tick the same box would be busywork.
--
-- Safe to re-run.

begin;

alter table public.receipts
  add column if not exists source text not null default 'manual',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'receipts_source_check') then
    alter table public.receipts
      add constraint receipts_source_check
      check (source in ('manual','photo','sms','gmail'));
  end if;
end $$;

-- Partial index: the "needs review" query is the one the app runs on every load,
-- and it only ever looks at the unreviewed rows.
create index if not exists receipts_needs_review_idx
  on public.receipts (household_id, created_at desc)
  where reviewed_at is null;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Anything already linked from sms_inbox came in through the SMS pipeline.
update public.receipts r
set source = 'sms'
from public.sms_inbox s
where s.receipt_id = r.id and r.source = 'manual';

-- Gmail-sourced rows are identifiable by the header the iOS scanner prefixes
-- onto the extracted text before parsing.
update public.receipts
set source = 'gmail'
where source = 'manual'
  and raw_ocr_json->>'raw_text' like 'Email Subject:%';

-- Receipts with an uploaded image came from the camera/photo flow.
update public.receipts
set source = 'photo'
where source = 'manual' and file_url is not null;

-- Everything that already exists has been living in the app for a while and is
-- effectively already vetted — marking it all unreviewed would bury the genuinely
-- new arrivals in a backlog of 46 and defeat the point of the feature.
update public.receipts
set reviewed_at = coalesce(updated_at, created_at, now())
where reviewed_at is null;

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select source, count(*), count(*) filter (where reviewed_at is null) as unreviewed
--   from public.receipts group by source order by source;
