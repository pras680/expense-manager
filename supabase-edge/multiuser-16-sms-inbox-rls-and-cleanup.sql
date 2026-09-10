-- Two fixes prompted by the same investigation (a reversal SMS that should
-- have matched its original charge but silently failed, with no way for the
-- user to see why without a manual DB query):
--
-- 1. sms_inbox's current policies (rls-authenticated-household-policies.sql)
--    grant every authenticated user read+update on EVERY household's rows,
--    not just their own — `using (true)` for both. That was fine back when
--    sms_inbox was single-user (rls-single-user-anon-policies.sql's anon
--    policies, which these replaced, had the same shape for the same
--    single-user reason), but it's a real cross-household privacy leak now:
--    any signed-in user could read another family's raw SMS body text
--    (amounts, merchants, card last-4) via a direct REST call. Scope both to
--    user_id = auth.uid(), matching every other per-user table
--    (gmail_connections, gmail_scan_log, sms_ingest_tokens).
--
-- 2. sms_inbox has no delete policy at all yet. The new SMS processing log
--    page (Settings -> SMS -> Log) needs one for its "Clear" action, same
--    shape as gmail_scan_log's.
--
-- sms_inbox itself doubles as its own diagnostic log — status/error_message/
-- retry_count already record what happened to every message — so unlike
-- gmail_scan_log this needs no new table, just RLS the webapp can safely
-- read through.
--
-- Run after multiuser-15-household-categories.sql. Safe to re-run.

begin;

drop policy if exists "Household authenticated can read sms inbox" on public.sms_inbox;
drop policy if exists "Household authenticated can update sms inbox" on public.sms_inbox;
drop policy if exists "Users read own sms inbox" on public.sms_inbox;
drop policy if exists "Users update own sms inbox" on public.sms_inbox;
drop policy if exists "Users delete own sms inbox" on public.sms_inbox;

create policy "Users read own sms inbox"
  on public.sms_inbox for select to authenticated
  using (user_id = auth.uid());

-- Update stays scoped the same way; this is what lets the log page's
-- "Retry" action reset a row back to pending (status='pending',
-- retry_count=0, error_message=null) without a service-role call.
create policy "Users update own sms inbox"
  on public.sms_inbox for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete own sms inbox"
  on public.sms_inbox for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select status, error_message, retry_count, received_at
--   from public.sms_inbox
--   where status in ('skipped', 'failed')
--   order by received_at desc limit 20;
