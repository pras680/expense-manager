-- Multi-user migration, step 1 of 5: schema.
--
-- Everything here is ADDITIVE and NULLABLE. It is safe to run while the iOS app
-- and the web app are live on the current anon policies — nothing starts being
-- enforced until multiuser-04-rls.sql.
--
-- Run order: 01-schema -> 02-backfill -> 03-constraints -> 04-rls -> 05-storage.
--
-- Written against the live schema as verified on 2026-08-11:
--   receipts(id, merchant, date, total, currency, category, file_url,
--            raw_ocr_json, created_at, updated_at, card_last4, card_bank)
--   payment_methods(id, last_digits, bank_name, card_name, created_at)
-- Note the columns payment-card-schema.sql claims to add (default_currency,
-- receipt_amount, receipt_currency, conversion_rate, converted_total) do NOT
-- exist live; that data lives inside raw_ocr_json. This script does not touch them.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Household tables
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_idx
  on public.household_members(user_id);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  default_currency text not null default 'SGD',
  active_household_id uuid references public.households(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- The raw token is returned to the caller exactly once by
-- create_sms_ingest_token() and never stored — only its SHA-256.
create table if not exists public.sms_ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists sms_ingest_tokens_user_idx
  on public.sms_ingest_tokens(user_id);

-- ---------------------------------------------------------------------------
-- 2. Owner columns on existing tables (nullable for now; 03 tightens them)
-- ---------------------------------------------------------------------------

alter table public.receipts
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists visibility text not null default 'household';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'receipts_visibility_check'
  ) then
    alter table public.receipts
      add constraint receipts_visibility_check
      check (visibility in ('private','household'));
  end if;
end $$;

create index if not exists receipts_user_id_idx on public.receipts(user_id);
create index if not exists receipts_household_idx on public.receipts(household_id, date desc);

alter table public.payment_methods
  add column if not exists household_id uuid references public.households(id) on delete cascade;
create index if not exists payment_methods_household_idx
  on public.payment_methods(household_id);

-- last_digits is UNIQUE globally today, which makes multi-household impossible
-- (two households could never both register a card ending 4242). Drop it here;
-- 03-constraints re-adds it scoped to the household. The constraint name is
-- looked up rather than assumed, since it was created inline.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'payment_methods'
      and con.contype = 'u'
      and (select array_agg(att.attname::text)
           from unnest(con.conkey) k
           join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
          = array['last_digits']
  loop
    execute format('alter table public.payment_methods drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.sms_inbox
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists sms_inbox_user_status_idx
  on public.sms_inbox(user_id, status, received_at);

-- ---------------------------------------------------------------------------
-- 3. Ownership assigned server-side by trigger
-- ---------------------------------------------------------------------------
-- Clients never send user_id. This also structurally fixes the iOS bug where
-- insertReceiptToDB's legacy retry path (includeOptionalColumns: false) silently
-- dropped user_id, which would otherwise have produced orphaned rows.

create or replace function public.set_receipt_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if new.household_id is null and new.user_id is not null then
    select active_household_id into new.household_id
      from public.user_settings where user_id = new.user_id;

    if new.household_id is null then
      select household_id into new.household_id
        from public.household_members where user_id = new.user_id
        order by joined_at limit 1;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists receipts_set_owner on public.receipts;
create trigger receipts_set_owner
  before insert on public.receipts
  for each row execute function public.set_receipt_owner();

create or replace function public.set_payment_method_household()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.household_id is null then
    select active_household_id into new.household_id
      from public.user_settings where user_id = auth.uid();

    if new.household_id is null then
      select household_id into new.household_id
        from public.household_members where user_id = auth.uid()
        order by joined_at limit 1;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payment_methods_set_household on public.payment_methods;
create trigger payment_methods_set_household
  before insert on public.payment_methods
  for each row execute function public.set_payment_method_household();

create or replace function public.touch_user_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.touch_user_settings_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS helper functions
-- ---------------------------------------------------------------------------
-- A receipts policy that reads household_members directly would recurse forever
-- once household_members has its own RLS. SECURITY DEFINER bypasses RLS inside
-- the function body, which breaks the cycle. STABLE lets the planner cache it
-- per statement.

create or replace function public.current_household_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

create or replace function public.household_peer_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select distinct m.user_id
  from public.household_members m
  where m.household_id in (
    select household_id from public.household_members where user_id = auth.uid()
  )
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  )
$$;

-- Single source of truth for "may I see/act on this receipt": own it, or it is
-- shared with a household I belong to. Household receipts are co-managed, so
-- this same predicate drives SELECT, UPDATE and DELETE.
create or replace function public.is_visible_receipt(
  p_user_id uuid, p_household_id uuid, p_visibility text
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id = auth.uid()
      or (p_visibility = 'household'
          and p_household_id is not null
          and p_household_id in (select household_id
                                 from public.household_members
                                 where user_id = auth.uid()))
$$;

revoke execute on function public.current_household_ids() from public, anon;
revoke execute on function public.household_peer_ids() from public, anon;
revoke execute on function public.is_household_owner(uuid) from public, anon;
revoke execute on function public.is_visible_receipt(uuid, uuid, text) from public, anon;

grant execute on function public.current_household_ids() to authenticated;
grant execute on function public.household_peer_ids() to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.is_visible_receipt(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. SMS ingest token issuance
-- ---------------------------------------------------------------------------

create or replace function public.create_sms_ingest_token(p_label text default null)
returns text language plpgsql security definer set search_path = public as $$
declare raw_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  raw_token := 'sms_' || encode(gen_random_bytes(24), 'hex');
  insert into public.sms_ingest_tokens (user_id, token_hash, label)
  values (auth.uid(), encode(digest(raw_token, 'sha256'), 'hex'), p_label);
  return raw_token;  -- shown once; only the hash is retained
end $$;

revoke execute on function public.create_sms_ingest_token(text) from public, anon;
grant execute on function public.create_sms_ingest_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Enable RLS on the new tables
-- ---------------------------------------------------------------------------
-- No policies yet, so these are closed to clients until 04-rls.sql. The Edge
-- Functions use service_role and are unaffected.

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.user_settings enable row level security;
alter table public.sms_ingest_tokens enable row level security;

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='receipts'
--     and column_name in ('user_id','household_id','visibility');   -- 3 rows
