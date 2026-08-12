-- Schedules scan-gmail every 15 minutes, offset from process-sms-inbox so the
-- two don't contend for Gemini quota in the same second.
--
-- timeout_milliseconds is NOT optional: pg_net defaults to 5s, and a scan makes
-- a Gemini call per message. Without it every tick is abandoned mid-flight while
-- cron.job_run_details still reports 'succeeded' — the failure that left the SMS
-- pipeline silently broken for weeks.

select cron.unschedule('scan-gmail-every-15-min')
where exists (select 1 from cron.job where jobname = 'scan-gmail-every-15-min');

select cron.schedule(
  'scan-gmail-every-15-min',
  '7,22,37,52 * * * *',
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
