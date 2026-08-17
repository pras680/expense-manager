-- Diagnostic log for scan-gmail: records every email the scanner actually
-- fetched and then rejected, with the reason. Deliberately NOT a log of every
-- message scan-gmail ever looked at — most of Gmail's search results are
-- filtered out by Gmail's own query before scan-gmail sees them at all, and
-- the ones it re-lists every run because they were already imported (the
-- overlap-window dedup) would flood this table with non-findings. Only
-- "found this, read it, decided it doesn't belong in your receipts, here's
-- why" is logged — the case the user actually asked to see.
--
-- Run after multiuser-10-transfer-fields.sql. Safe to re-run.

begin;

create table if not exists public.gmail_scan_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  subject text,
  sender text,
  email_date timestamptz,
  reason text not null,
  scanned_at timestamptz not null default now()
);

create index if not exists gmail_scan_log_user_scanned_idx
  on public.gmail_scan_log (user_id, scanned_at desc);

alter table public.gmail_scan_log enable row level security;

drop policy if exists "Users read own gmail scan log" on public.gmail_scan_log;
drop policy if exists "Users delete own gmail scan log" on public.gmail_scan_log;

-- Read and clear only, same posture as gmail_connections — a client must never
-- write a log entry itself, only the service_role scanner does that.
create policy "Users read own gmail scan log"
  on public.gmail_scan_log for select to authenticated
  using (user_id = auth.uid());

create policy "Users delete own gmail scan log"
  on public.gmail_scan_log for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select subject, reason, scanned_at from public.gmail_scan_log
--   order by scanned_at desc limit 20;
