-- Small shared key-value store for settings that need to be visible to both
-- client apps (iOS, web) and server-side Edge Functions/Cron jobs — e.g. the
-- household's default currency, so process-sms-inbox converts to whatever the
-- web app's Settings page last set rather than a hardcoded currency.
-- Run this in the Supabase SQL editor before deploying process-sms-inbox.

begin;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_app_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row
  execute function public.set_app_settings_updated_at();

-- Seed the default currency so process-sms-inbox has something to read from
-- its very first run, even before the web app's Settings page has been used.
insert into public.app_settings (key, value)
values ('default_currency', '"SGD"'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- Same "anon key = full access" posture as the rest of this schema
-- (receipts, payment_methods, sms_inbox) — single-user/household setup,
-- no per-user Auth. Edge Functions use service_role and bypass RLS anyway.
drop policy if exists "Single user anon can read app settings" on public.app_settings;
drop policy if exists "Single user anon can write app settings" on public.app_settings;

create policy "Single user anon can read app settings"
  on public.app_settings for select
  to anon
  using (true);

create policy "Single user anon can write app settings"
  on public.app_settings for all
  to anon
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
