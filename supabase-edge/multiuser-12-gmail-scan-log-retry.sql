-- Adds a bounded retry budget to gmail_scan_log, so a message that genuinely
-- can't be turned into a receipt stops being re-fetched and re-parsed on
-- every 15-minute tick for as long as it stays inside the scan window.
--
-- Deliberately NOT applied to rate-limit failures (429 from the LLM
-- provider) — those say nothing about whether the email is a valid receipt,
-- only that the request landed at a bad moment, and giving up on a perfectly
-- good receipt because of one bad-luck tick would be worse than the
-- redundant-rescan problem this migration fixes. See scan-gmail's logScan().
--
-- Run after multiuser-11-gmail-scan-log.sql. Safe to re-run.

begin;

alter table public.gmail_scan_log
  add column if not exists retry_count integer not null default 1;

-- gmail_scan_log shipped without a uniqueness guarantee, so a message that
-- failed on consecutive ticks before this migration existed may already have
-- several rows. Collapse to the most recent per (user_id, message_id) before
-- the unique index below can be created — the older duplicates carry no
-- information the newest one doesn't already have.
delete from public.gmail_scan_log t
where exists (
  select 1 from public.gmail_scan_log newer
  where newer.user_id = t.user_id
    and newer.message_id = t.message_id
    and (newer.scanned_at, newer.id) > (t.scanned_at, t.id)
);

create unique index if not exists gmail_scan_log_user_message_idx
  on public.gmail_scan_log (user_id, message_id);

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select message_id, reason, retry_count, scanned_at
--   from public.gmail_scan_log order by scanned_at desc limit 20;
