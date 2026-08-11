-- Schedules the process-sms-inbox Edge Function to run automatically every
-- 15 minutes via Supabase's built-in Cron (pg_cron + pg_net), so sms_inbox
-- rows get drained into receipts regardless of whether the iOS app or the
-- web app is open.
--
-- Run this in the Supabase SQL editor AFTER deploying process-sms-inbox
-- (`supabase functions deploy process-sms-inbox`).
--
-- The service_role key is stored in Supabase Vault (encrypted) rather than
-- embedded as a literal string in the cron job, which pg_cron would otherwise
-- keep in plaintext in cron.job/cron.job_run_details indefinitely. If this
-- job already exists from before Vault was introduced, use
-- migrate-cron-secret-to-vault.sql instead of re-running this.
--
-- Before running: replace both placeholders below.
--   <SUPABASE_URL>          e.g. https://lxxetltpuuwjtxmeemhx.supabase.co
--   <SERVICE_ROLE_KEY>      Project Settings -> API -> service_role secret key
--                           (NOT the anon/publishable key — this needs to bypass RLS.
--                           Used once here to seed Vault — never stored as a literal
--                           string in the cron job itself.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'process_sms_inbox_service_role_key') then
    perform vault.create_secret(
      '<SERVICE_ROLE_KEY>',
      'process_sms_inbox_service_role_key',
      'service_role key used by the process-sms-inbox cron job to call the Edge Function'
    );
  end if;
end $$;

select cron.schedule(
  'process-sms-inbox-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/process-sms-inbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'process_sms_inbox_service_role_key'
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    -- Without this, pg_net's 5s default aborts the call mid-flight: every tick
    -- reports 'succeeded' (http_post only queues the request) while the response
    -- is discarded and the invocation torn down, so nothing is ever drained.
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- To check the job is registered:
--   select * from cron.job where jobname = 'process-sms-inbox-every-15-min';
--
-- To see recent run history/results:
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'process-sms-inbox-every-15-min')
--   order by start_time desc limit 20;
--
-- To pause/remove the schedule later:
--   select cron.unschedule('process-sms-inbox-every-15-min');
--
-- To rotate the service_role key later without touching the cron job:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'process_sms_inbox_service_role_key'),
--     '<NEW_SERVICE_ROLE_KEY>'
--   );
