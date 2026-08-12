-- Vault accessors for Gmail refresh tokens.
--
-- Vault has no PostgREST surface, so the Edge Functions reach it through these
-- RPCs. Every one is SECURITY DEFINER and granted ONLY to service_role — never
-- to authenticated or anon. A signed-in user must not be able to read their own
-- refresh token (it would leak into the browser and localStorage), let alone
-- anyone else's.
--
-- Tokens are namespaced 'gmail_refresh_<user_id>' so one member's credential
-- can never be confused with another's.
--
-- Run after multiuser-07-gmail.sql. Safe to re-run.

begin;

create extension if not exists supabase_vault with schema vault;

create or replace function public.set_gmail_refresh_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_name text := 'gmail_refresh_' || p_user_id::text;
  v_id   uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_token, v_name, 'Gmail refresh token');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end $$;

create or replace function public.get_gmail_refresh_token(p_user_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'gmail_refresh_' || p_user_id::text
$$;

create or replace function public.delete_gmail_refresh_token(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where name = 'gmail_refresh_' || p_user_id::text;
end $$;

-- The grants are the whole security boundary here. Revoke from every role that
-- a client could ever authenticate as, then grant back only to service_role,
-- which exists solely inside Edge Functions.
revoke execute on function public.set_gmail_refresh_token(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_gmail_refresh_token(uuid) from public, anon, authenticated;
revoke execute on function public.delete_gmail_refresh_token(uuid) from public, anon, authenticated;

grant execute on function public.set_gmail_refresh_token(uuid, text) to service_role;
grant execute on function public.get_gmail_refresh_token(uuid) to service_role;
grant execute on function public.delete_gmail_refresh_token(uuid) to service_role;

notify pgrst, 'reload schema';

commit;

-- Verify no client role can reach a token (expect 0 rows):
--   select p.proname, r.rolname
--   from pg_proc p
--   cross join unnest(array['anon','authenticated']) as r(rolname)
--   where p.proname like '%gmail_refresh_token'
--     and has_function_privilege(r.rolname, p.oid, 'execute');
