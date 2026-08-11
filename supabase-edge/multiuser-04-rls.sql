-- Multi-user migration, step 4 of 5: RLS cutover. THIS IS THE BREAKING STEP.
--
-- Removes every `to anon` policy, so the publishable key — which ships inside the
-- iOS binary and the web app's JS bundle — stops being a master credential and
-- becomes what it should be: a routing identifier that grants nothing.
--
-- DO NOT RUN until both clients are shipped and signed in (rollout step 5), or
-- every app stops working.
--
-- Access model:
--   receipts        own rows always; household rows co-managed by every member
--                   (read AND write — pras and sumi keep the access they have today).
--                   'private' rows are invisible to everyone but the owner.
--   payment_methods shared across the household.
--   sms_inbox       strictly per-user. Inserts are service_role only (receive-sms).
--   user_settings   strictly per-user.
--
-- Rollback: rls-authenticated-household-policies.sql restores the previous
-- shared-household behaviour (all signed-in users see everything).

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop every legacy policy (both the anon set and the shared-household set)
-- ---------------------------------------------------------------------------

do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('receipts','payment_methods','sms_inbox','app_settings')
  loop
    execute format('drop policy if exists %I on %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

alter table public.receipts        enable row level security;
alter table public.payment_methods enable row level security;
alter table public.sms_inbox       enable row level security;
alter table public.app_settings    enable row level security;

-- ---------------------------------------------------------------------------
-- 2. receipts — own rows, plus co-managed household rows
-- ---------------------------------------------------------------------------
-- is_visible_receipt() (from 01-schema) is the single predicate behind read and
-- write alike, so there is no way for the two to drift apart.

create policy "Members read own and household receipts"
  on public.receipts for select to authenticated
  using (public.is_visible_receipt(user_id, household_id, visibility));

-- A member may only create rows owned by themselves. The 01-schema trigger fills
-- user_id in from auth.uid(), so clients never send it and this cannot fail
-- accidentally; it blocks a hand-crafted request trying to write as someone else.
create policy "Members insert own receipts"
  on public.receipts for insert to authenticated
  with check (user_id = auth.uid());

-- Co-management: anyone who can see a household receipt can edit it. The WITH
-- CHECK clause re-evaluates against the NEW row, so a member cannot use an
-- update to move a receipt into a household they don't belong to, or reassign
-- ownership to someone outside it.
create policy "Members update own and household receipts"
  on public.receipts for update to authenticated
  using (public.is_visible_receipt(user_id, household_id, visibility))
  with check (public.is_visible_receipt(user_id, household_id, visibility));

create policy "Members delete own and household receipts"
  on public.receipts for delete to authenticated
  using (public.is_visible_receipt(user_id, household_id, visibility));

-- ---------------------------------------------------------------------------
-- 3. payment_methods — household-shared
-- ---------------------------------------------------------------------------

create policy "Members read household payment methods"
  on public.payment_methods for select to authenticated
  using (household_id in (select public.current_household_ids()));

create policy "Members insert household payment methods"
  on public.payment_methods for insert to authenticated
  with check (household_id in (select public.current_household_ids()));

create policy "Members update household payment methods"
  on public.payment_methods for update to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy "Members delete household payment methods"
  on public.payment_methods for delete to authenticated
  using (household_id in (select public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- 4. sms_inbox — strictly per-user; no INSERT or DELETE policy for anyone
-- ---------------------------------------------------------------------------
-- Rows are created solely by receive-sms via service_role, which bypasses RLS.
-- Omitting an INSERT policy is what stops a signed-in user forging inbox rows.

create policy "Users read own sms inbox"
  on public.sms_inbox for select to authenticated
  using (user_id = auth.uid());

create policy "Users update own sms inbox"
  on public.sms_inbox for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. app_settings — retired
-- ---------------------------------------------------------------------------
-- default_currency now lives per-user in user_settings. Leave the table in place
-- but grant nothing: RLS is enabled with zero policies, so it is closed to every
-- client. service_role still reaches it if anything is ever migrated off it.

-- ---------------------------------------------------------------------------
-- 6. Household + per-user tables
-- ---------------------------------------------------------------------------

drop policy if exists "Members read their households" on public.households;
drop policy if exists "Users create households" on public.households;
drop policy if exists "Owners update their household" on public.households;
drop policy if exists "Owners delete their household" on public.households;

create policy "Members read their households"
  on public.households for select to authenticated
  using (id in (select public.current_household_ids()));

create policy "Users create households"
  on public.households for insert to authenticated
  with check (created_by = auth.uid());

create policy "Owners update their household"
  on public.households for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

create policy "Owners delete their household"
  on public.households for delete to authenticated
  using (public.is_household_owner(id));

drop policy if exists "Members read household roster" on public.household_members;
drop policy if exists "Owners add members" on public.household_members;
drop policy if exists "Owners update members" on public.household_members;
drop policy if exists "Owners remove members or self-leave" on public.household_members;

create policy "Members read household roster"
  on public.household_members for select to authenticated
  using (user_id = auth.uid() or household_id in (select public.current_household_ids()));

create policy "Owners add members"
  on public.household_members for insert to authenticated
  with check (public.is_household_owner(household_id));

create policy "Owners update members"
  on public.household_members for update to authenticated
  using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

-- Owners can remove anyone; anyone can remove themselves (leave the household).
create policy "Owners remove members or self-leave"
  on public.household_members for delete to authenticated
  using (public.is_household_owner(household_id) or user_id = auth.uid());

drop policy if exists "Users manage own settings" on public.user_settings;
drop policy if exists "Users read own and peer settings" on public.user_settings;
drop policy if exists "Users write own settings" on public.user_settings;

-- Readable by household peers, not just the owner: the receipts list labels
-- other people's receipts with their name, and that name lives here. Peers can
-- therefore also see each other's default_currency, which is not sensitive.
create policy "Users read own and peer settings"
  on public.user_settings for select to authenticated
  using (user_id = auth.uid() or user_id in (select public.household_peer_ids()));

-- Writing stays strictly own-only — nobody edits anyone else's preferences.
create policy "Users write own settings"
  on public.user_settings for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update own settings"
  on public.user_settings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete own settings"
  on public.user_settings for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users manage own sms tokens" on public.sms_ingest_tokens;
create policy "Users manage own sms tokens"
  on public.sms_ingest_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- VERIFY — the publishable key must now return nothing. Run from a terminal;
-- every one of these should be an empty array or 401, never populated data.
-- ---------------------------------------------------------------------------
--   ANON="sb_publishable_7jF_NW4pRe8y6T-mFrLtew_9VtCke9e"
--   URL="https://lxxetltpuuwjtxmeemhx.supabase.co"
--   for t in receipts payment_methods sms_inbox app_settings households; do
--     echo -n "$t: "; curl -s "$URL/rest/v1/$t?select=*&limit=1" \
--       -H "apikey: $ANON" -H "Authorization: Bearer $ANON"; echo
--   done
--
-- Confirm no anon policy survived anywhere:
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and 'anon' = any(roles);   -- expect 0 rows
