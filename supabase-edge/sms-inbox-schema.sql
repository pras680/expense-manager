-- SMS inbox for iOS Shortcuts / automations.
-- Run this in the Supabase SQL editor before deploying the receive-sms Edge Function.

begin;

create extension if not exists pgcrypto;

create table if not exists public.sms_inbox (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 8000),
  sender text,
  source text not null default 'ios-shortcut',
  received_at timestamptz not null default now(),
  body_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'skipped', 'failed')),
  processed_at timestamptz,
  error_message text,
  receipt_id uuid references public.receipts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_inbox_status_received_at_idx
  on public.sms_inbox (status, received_at);

create index if not exists sms_inbox_body_hash_idx
  on public.sms_inbox (body_hash);

create or replace function public.set_sms_inbox_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sms_inbox_set_updated_at on public.sms_inbox;
create trigger sms_inbox_set_updated_at
  before update on public.sms_inbox
  for each row
  execute function public.set_sms_inbox_updated_at();

alter table public.sms_inbox enable row level security;

-- Edge Function uses service_role and bypasses RLS for inserts.
-- The current app is single-user/anon, so it can read pending rows and mark them processed.
drop policy if exists "Single user anon can read sms inbox" on public.sms_inbox;
drop policy if exists "Single user anon can update sms inbox" on public.sms_inbox;

create policy "Single user anon can read sms inbox"
  on public.sms_inbox for select
  to anon
  using (true);

create policy "Single user anon can update sms inbox"
  on public.sms_inbox for update
  to anon
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
