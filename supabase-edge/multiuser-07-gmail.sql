-- Per-user Gmail connections for server-side receipt scanning.
--
-- The refresh token is a long-lived credential that can read someone's entire
-- mailbox, so it is NOT stored here. It goes into Supabase Vault under the name
-- 'gmail_refresh_<user_id>', and this table holds only non-secret metadata. That
-- split is what lets the app show "Connected as x@gmail.com" and a last-scan
-- time without any client ever being able to read a token — column-level
-- security doesn't exist in Postgres RLS, so a token column on a
-- client-readable table would be readable by that client.
--
-- Run after multiuser-06-review-status.sql. Safe to re-run.

begin;

create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  connected_at timestamptz not null default now(),
  -- Watermark for incremental scanning: the server-side equivalent of the iOS
  -- app's `gmailLastScanDate` UserDefaults key, which was per-device and leaked
  -- between accounts.
  last_scan_at timestamptz,
  last_error text,
  revoked_at timestamptz
);

-- Dedup key for Gmail imports. The scan window deliberately overlaps by a day
-- (so a message arriving mid-run isn't skipped forever), which means the same
-- message WILL be seen twice — this is what stops it becoming two receipts.
-- Unique per user, not globally: a receipt forwarded to both members is
-- legitimately two people's records.
alter table public.receipts add column if not exists gmail_message_id text;
create unique index if not exists receipts_gmail_message_user_idx
  on public.receipts (user_id, gmail_message_id)
  where gmail_message_id is not null;

alter table public.gmail_connections enable row level security;

drop policy if exists "Users read own gmail connection" on public.gmail_connections;
drop policy if exists "Users delete own gmail connection" on public.gmail_connections;

-- Read and disconnect only. Inserts and updates come from the Edge Functions via
-- service_role: a client must never be able to forge a connection row or move
-- another member's scan watermark.
create policy "Users read own gmail connection"
  on public.gmail_connections for select to authenticated
  using (user_id = auth.uid());

create policy "Users delete own gmail connection"
  on public.gmail_connections for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select user_id, email, connected_at, last_scan_at from public.gmail_connections;
--
-- Vault holds the tokens; this shows they exist without revealing them:
--   select name, created_at from vault.secrets where name like 'gmail_refresh_%';
