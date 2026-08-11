-- One-time migration: move the process-sms-inbox cron job's service_role key
-- out of the cron.job SQL text (visible in plaintext to anyone with SQL/dashboard
-- access via `select * from cron.job` or `cron.job_run_details`) into Supabase
-- Vault, an encrypted secret store. After this runs, the cron job's command only
-- references the secret by name — the literal key value is never stored in job
-- definitions or run history again.
--
-- Run this in the Supabase SQL editor. Assumes the job was already created via
-- schedule-process-sms-inbox-cron.sql.
--
-- Before running: replace both placeholders below.
--   <SUPABASE_URL>       e.g. https://lxxetltpuuwjtxmeemhx.supabase.co
--   <SERVICE_ROLE_KEY>   Project Settings -> API -> service_role secret key
--                        (used once here to seed Vault — after this migration,
--                        you won't need to paste it into SQL again)

begin;

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

select cron.unschedule('process-sms-inbox-every-15-min');

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

commit;

-- To verify the job no longer contains the literal key:
--   select command from cron.job where jobname = 'process-sms-inbox-every-15-min';
--   (should show the vault.decrypted_secrets subquery, not a raw key string)
--
-- To verify the secret is stored (this never shows the decrypted value):
--   select id, name, description, created_at from vault.secrets
--   where name = 'process_sms_inbox_service_role_key';
--
-- If you ever need to rotate the service_role key later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'process_sms_inbox_service_role_key'),
--     '<NEW_SERVICE_ROLE_KEY>'
--   );
--   (no need to touch the cron job again — it looks the value up by name each run)
