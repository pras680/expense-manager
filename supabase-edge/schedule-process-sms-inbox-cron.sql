-- Schedules the process-sms-inbox Edge Function to run automatically every
-- 15 minutes via Supabase's built-in Cron (pg_cron + pg_net), so sms_inbox
-- rows get drained into receipts regardless of whether the iOS app or the
-- web app is open.
--
-- Run this in the Supabase SQL editor AFTER deploying process-sms-inbox
-- (`supabase functions deploy process-sms-inbox`).
--
-- Before running: replace both placeholders below.
--   <SUPABASE_URL>          e.g. https://lxxetltpuuwjtxmeemhx.supabase.co
--   <SERVICE_ROLE_KEY>      Project Settings -> API -> service_role secret key
--                           (NOT the anon/publishable key — this needs to bypass RLS)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'process-sms-inbox-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/process-sms-inbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
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
