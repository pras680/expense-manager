-- Last-known LLM provider rate-limit state, so the webapp can show "can I
-- parse a receipt right now, or should I wait?" without spending a request
-- to find out.
--
-- Groq has no "remaining quota" endpoint — the only source is the
-- x-ratelimit-* headers on each chat-completions response (and retry-after on
-- a 429). parse-receipt records them here after every upstream call, from
-- every caller (webapp, iOS, process-sms-inbox, scan-gmail), so the snapshot
-- is as fresh as the last call from anyone — the key and its quota are shared
-- by the whole deployment, not per user or per household.
--
-- One row per provider. Readable by any signed-in user (it's deployment-wide
-- state, not household data); written only by parse-receipt via the service
-- role, so there are deliberately no insert/update policies.
--
-- Run after multiuser-19-optional-receipt-columns.sql. Safe to re-run.

begin;

create table if not exists public.llm_quota_status (
  provider text primary key,
  model text,
  -- Groq: requests per day
  limit_requests integer,
  remaining_requests integer,
  requests_reset_at timestamptz,
  -- Groq: tokens per minute
  limit_tokens integer,
  remaining_tokens integer,
  tokens_reset_at timestamptz,
  -- Set from retry-after on a 429; cleared by the next successful call.
  rate_limited_until timestamptz,
  last_status integer,
  updated_at timestamptz not null default now()
);

alter table public.llm_quota_status enable row level security;

drop policy if exists "Signed-in users read llm quota status" on public.llm_quota_status;

create policy "Signed-in users read llm quota status"
  on public.llm_quota_status for select to authenticated
  using (true);

revoke all on public.llm_quota_status from anon;
grant select on public.llm_quota_status to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verify (after at least one parse-receipt call has been made):
--   select * from public.llm_quota_status;
