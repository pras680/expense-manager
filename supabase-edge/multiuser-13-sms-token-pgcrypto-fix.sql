-- Fixes: creating an SMS ingest token failed with
--   "function gen_random_bytes(integer) does not exist" (Postgres 42883)
--
-- create_sms_ingest_token() calls gen_random_bytes() and digest(), both from
-- the pgcrypto extension. Modern Supabase projects install extensions into a
-- schema called `extensions`, not `public` — but the function was defined
-- with `set search_path = public`, so it can't see them there even when
-- pgcrypto is enabled. This was presumably a latent bug since the function
-- was first written; nothing exercised it until someone actually tried to
-- generate a token.
--
-- Safe to re-run.

begin;

-- Idempotent by extension name regardless of which schema it ends up in —
-- if pgcrypto is already installed elsewhere, this is a no-op, not a
-- duplicate or a move.
create extension if not exists pgcrypto;

-- Widen the search path rather than hardcoding a schema: works whether this
-- project's pgcrypto landed in `extensions` (the current Supabase default)
-- or `public` (the classic default), without needing to know which.
create or replace function public.create_sms_ingest_token(p_label text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
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

notify pgrst, 'reload schema';

commit;

-- Verify:
--   1. Confirm pgcrypto is actually reachable now:
--        select extname, nspname from pg_extension e
--        join pg_namespace n on n.oid = e.extnamespace
--        where extname = 'pgcrypto';
--   2. Then just try "Generate" in Settings -> SMS import again — no direct
--      SQL call needed, create_sms_ingest_token() only runs as the signed-in
--      caller via RLS-gated RPC.
