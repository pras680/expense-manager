-- Schedules scan-gmail twice a day (07:07 and 19:07) rather than every 15
-- minutes. Email receipts aren't as time-sensitive as bank SMS alerts, and
-- this account has hit rate/quota limits with three different LLM providers
-- already — 96 scans/day was spending that budget on polling, not on finding
-- receipts. The in-app "Scan now" button (Settings > Gmail import) covers the
-- case where you want something picked up immediately rather than waiting for
-- the next scheduled run.
--
-- timeout_milliseconds is NOT optional: pg_net defaults to 5s, and a scan makes
-- an LLM call per message. Without it every tick is abandoned mid-flight while
-- cron.job_run_details still reports 'succeeded' — the failure that left the SMS
-- pipeline silently broken for weeks.
--
-- Renamed from scan-gmail-every-15-min, so the old job is explicitly
-- unscheduled here too — otherwise it keeps firing forever alongside this one.

select cron.unschedule('scan-gmail-every-15-min')
where exists (select 1 from cron.job where jobname = 'scan-gmail-every-15-min');

select cron.unschedule('scan-gmail-twice-daily')
where exists (select 1 from cron.job where jobname = 'scan-gmail-twice-daily');

select cron.schedule(
  'scan-gmail-twice-daily',
  '7 7,19 * * *',
  $$
  select net.http_post(
    url := 'https://lxxetltpuuwjtxmeemhx.supabase.co/functions/v1/scan-gmail',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'process_sms_inbox_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname like 'scan-gmail%';
