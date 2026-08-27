-- Adds a per-receipt comment field, auto-filled by parse-receipt with a
-- one-liner explaining how it derived the values and freely editable
-- afterward, plus a household-scoped table of learned merchant corrections.
--
-- Centralizes and activates a mechanism that already exists but is stranded
-- on one client: parse-receipt has accepted `learning_hints` and injected
-- them into its prompt since it was ported from iOS, but only the iOS app
-- populates them, and it stores its rules in local UserDefaults — per
-- device, never synced. The webapp, process-sms-inbox, and scan-gmail all
-- call parse-receipt today without ever sending hints. This makes the same
-- kind of rule live in Postgres, household-scoped (a correction one member
-- makes should help every member's future imports, same as receipts
-- themselves are shared), and reachable from all three ingestion paths.
--
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. receipts.comment — auto-filled one-liner, freely editable
-- ---------------------------------------------------------------------------

alter table public.receipts add column if not exists comment text;

-- ---------------------------------------------------------------------------
-- 2. receipt_correction_rules — household-shared, one row per merchant
--    keyword, matching the shape parse-receipt already expects for
--    learning_hints (see supabase/functions/parse-receipt/index.ts).
-- ---------------------------------------------------------------------------

create table if not exists public.receipt_correction_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  merchant_keyword text not null,
  corrected_merchant text,
  corrected_category text,
  corrected_currency text,
  corrected_card_last4 text,
  corrected_card_bank text,
  note text,
  learned_at timestamptz not null default now(),
  use_count integer not null default 0,
  unique (household_id, merchant_keyword)
);

create index if not exists receipt_correction_rules_household_idx
  on public.receipt_correction_rules (household_id);

alter table public.receipt_correction_rules enable row level security;

drop policy if exists "Members read household correction rules" on public.receipt_correction_rules;
drop policy if exists "Members insert household correction rules" on public.receipt_correction_rules;
drop policy if exists "Members update household correction rules" on public.receipt_correction_rules;
drop policy if exists "Members delete household correction rules" on public.receipt_correction_rules;

-- Same shape as payment_methods' household-shared policies (multiuser-04-rls.sql).
create policy "Members read household correction rules"
  on public.receipt_correction_rules for select to authenticated
  using (household_id in (select public.current_household_ids()));

create policy "Members insert household correction rules"
  on public.receipt_correction_rules for insert to authenticated
  with check (household_id in (select public.current_household_ids()));

create policy "Members update household correction rules"
  on public.receipt_correction_rules for update to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy "Members delete household correction rules"
  on public.receipt_correction_rules for delete to authenticated
  using (household_id in (select public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- 3. match_correction_rules — called before parsing, returns hints in the
--    exact shape parse-receipt's sanitizeLearningHints() expects.
--
--    Not security definer: for an authenticated (webapp) caller, RLS on the
--    select below already restricts results to that caller's own
--    household(s), which is exactly the scope wanted. For a service_role
--    caller (process-sms-inbox, scan-gmail), RLS is bypassed entirely by
--    role, and p_household_id — resolved server-side from the message's
--    owner, same as the existing duplicate-check scoping — is the only
--    filter, so results are still scoped correctly either way.
-- ---------------------------------------------------------------------------

-- Not stable/immutable: it bumps use_count as a side effect, which Postgres
-- disallows inside a stable SQL function ("SELECT is not allowed in a
-- non-volatile function" — the actual error is about the UPDATE, surfaced
-- oddly). Plain (volatile) is correct here since this always does a write.
create or replace function public.match_correction_rules(p_household_id uuid, p_raw_text text)
returns jsonb language sql set search_path = public as $$
  with matched as (
    select id, merchant_keyword, corrected_merchant, corrected_category,
           corrected_currency, corrected_card_last4, corrected_card_bank, note
    from public.receipt_correction_rules
    where household_id = p_household_id
      and position(merchant_keyword in lower(coalesce(p_raw_text, ''))) > 0
    order by learned_at desc
    limit 12
  ),
  bumped as (
    update public.receipt_correction_rules r
    set use_count = r.use_count + 1
    from matched m
    where r.id = m.id
    returning r.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'merchant_keyword', merchant_keyword,
    'corrected_merchant', corrected_merchant,
    'corrected_category', corrected_category,
    'corrected_currency', corrected_currency,
    'corrected_card_last4', corrected_card_last4,
    'corrected_card_bank', corrected_card_bank,
    'note', note
  )), '[]'::jsonb)
  from matched
$$;

revoke execute on function public.match_correction_rules(uuid, text) from public, anon;
grant execute on function public.match_correction_rules(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. learn_receipt_correction — upsert, latest correction wins. Callers
--    decide WHEN to call this (a real field change, and/or a non-empty
--    note) — this function just writes what it's given.
-- ---------------------------------------------------------------------------

create or replace function public.learn_receipt_correction(
  p_household_id uuid,
  p_merchant_keyword text,
  p_corrected_merchant text,
  p_corrected_category text,
  p_corrected_currency text,
  p_corrected_card_last4 text,
  p_corrected_card_bank text,
  p_note text
)
returns void language plpgsql set search_path = public as $$
begin
  if length(trim(coalesce(p_merchant_keyword, ''))) < 3 then
    return;
  end if;

  insert into public.receipt_correction_rules (
    household_id, merchant_keyword, corrected_merchant, corrected_category,
    corrected_currency, corrected_card_last4, corrected_card_bank, note
  )
  values (
    p_household_id, lower(trim(p_merchant_keyword)), p_corrected_merchant, p_corrected_category,
    p_corrected_currency, p_corrected_card_last4, p_corrected_card_bank, p_note
  )
  on conflict (household_id, merchant_keyword) do update set
    corrected_merchant = excluded.corrected_merchant,
    corrected_category = excluded.corrected_category,
    corrected_currency = excluded.corrected_currency,
    corrected_card_last4 = excluded.corrected_card_last4,
    corrected_card_bank = excluded.corrected_card_bank,
    note = excluded.note,
    learned_at = now(),
    use_count = 0;
end $$;

revoke execute on function public.learn_receipt_correction(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.learn_receipt_correction(uuid, text, text, text, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'receipts' and column_name = 'comment';
--
--   select * from public.receipt_correction_rules limit 5;
