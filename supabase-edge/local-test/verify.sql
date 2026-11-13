-- Local test backend checklist: every row should say PASS.
with checks(item, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
  from unnest(array['households','household_members','user_settings','receipts',
    'sms_inbox','sms_ingest_tokens','gmail_connections','gmail_scan_log',
    'payment_methods','receipt_correction_rules','household_categories',
    'llm_quota_status']) t
  union all
  select 'RLS on ' || c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('households','household_members','user_settings','receipts',
      'sms_inbox','payment_methods','receipt_correction_rules','household_categories')
  union all
  select 'function ' || f, exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname = 'public' and p.proname = f)
  from unnest(array['set_receipt_owner','is_visible_receipt','household_peer_ids',
    'current_household_ids','learn_receipt_correction','match_correction_rules',
    'rename_household_category','create_sms_ingest_token','storage_owner_uuid']) f
  union all
  select 'trigger receipts_set_owner',
         exists (select 1 from pg_trigger where tgname = 'receipts_set_owner')
  union all
  select 'bucket receipt-documents is private',
         exists (select 1 from storage.buckets where id = 'receipt-documents' and not public)
  union all
  select 'storage policies for receipt-documents (>= 4)',
         (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (coalesce(qual,'') || coalesce(with_check,'')) like '%receipt-documents%') >= 4
  union all
  select 'no scheduled cron jobs (nothing calls out)',
         not exists (select 1 from pg_namespace where nspname = 'cron')
         or (select count(*) from cron.job) = 0
  union all
  select 'no real data: receipts empty before seeding', (select count(*) from public.receipts) = 0
)
select case when ok then 'PASS' else 'FAIL' end as result, item from checks order by ok, item;
