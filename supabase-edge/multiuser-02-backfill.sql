-- Multi-user migration, step 2 of 5: backfill the existing data.
--
-- Puts pras and sumi in one household and hands every existing row an owner:
--   - 43 receipts  -> owned by pras, visibility 'household' so sumi keeps full access
--   - 4  payment_methods -> the household (cards are shared)
--   - sms_inbox    -> owned by pras (0 rows at time of writing; handled anyway)
--
-- Both members are role 'owner' deliberately: if one account is ever deleted the
-- household still has an owner and nobody gets locked out of managing membership.
--
-- Safe to run more than once — every step is guarded and re-running changes nothing.
-- Run AFTER multiuser-01-schema.sql, BEFORE multiuser-03-constraints.sql.
--
-- ===========================================================================
-- BEFORE RUNNING: check these three values.
--   Confirm the emails against Dashboard -> Authentication -> Users.
-- ===========================================================================

begin;

do $$
declare
  -- ---- CONFIG -------------------------------------------------------------
  v_primary_email  text := 'pras@billskills.com';        -- pras (household creator)
  v_member_email   text := 'sumi@billskills.com';  -- sumi
  v_household_name text := 'Home';
  v_currency       text := 'SGD';
  -- -------------------------------------------------------------------------

  v_primary_id   uuid;
  v_member_id    uuid;
  v_household_id uuid;
  v_orphans      bigint;
begin
  select id into v_primary_id from auth.users where email = v_primary_email;
  select id into v_member_id  from auth.users where email = v_member_email;

  if v_primary_id is null then
    raise exception 'No auth user with email %. Fix v_primary_email.', v_primary_email;
  end if;
  if v_member_id is null then
    raise exception 'No auth user with email %. Fix v_member_email.', v_member_email;
  end if;
  if v_primary_id = v_member_id then
    raise exception 'v_primary_email and v_member_email resolve to the same user.';
  end if;

  -- 1. Household (reuse if this script already ran)
  select id into v_household_id
    from public.households where created_by = v_primary_id
    order by created_at limit 1;

  if v_household_id is null then
    insert into public.households (name, created_by)
    values (v_household_name, v_primary_id)
    returning id into v_household_id;
  end if;

  -- 2. Membership — both owners, see header note
  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, v_primary_id, 'owner'),
         (v_household_id, v_member_id,  'owner')
  on conflict (household_id, user_id) do update set role = 'owner';

  -- 3. Per-user settings (replaces the retired global app_settings row)
  insert into public.user_settings (user_id, display_name, default_currency, active_household_id)
  values (v_primary_id, split_part(v_primary_email, '@', 1), v_currency, v_household_id),
         (v_member_id,  split_part(v_member_email,  '@', 1), v_currency, v_household_id)
  on conflict (user_id) do update
    set active_household_id = excluded.active_household_id,
        default_currency    = coalesce(public.user_settings.default_currency, excluded.default_currency);

  -- 4. Existing receipts -> pras, shared with the household
  update public.receipts
     set user_id      = coalesce(user_id, v_primary_id),
         household_id = coalesce(household_id, v_household_id),
         visibility   = coalesce(nullif(visibility, ''), 'household')
   where user_id is null or household_id is null;

  -- 5. Existing cards -> the household
  update public.payment_methods
     set household_id = v_household_id
   where household_id is null;

  -- 6. Any pre-existing SMS rows -> pras (the only person ingesting SMS so far)
  update public.sms_inbox
     set user_id = v_primary_id
   where user_id is null;

  -- 7. Guards — abort the whole transaction if anything is still unowned
  select count(*) into v_orphans from public.receipts where user_id is null;
  if v_orphans > 0 then
    raise exception 'Backfill incomplete: % receipts still have no user_id.', v_orphans;
  end if;

  select count(*) into v_orphans from public.receipts where household_id is null;
  if v_orphans > 0 then
    raise exception 'Backfill incomplete: % receipts still have no household_id.', v_orphans;
  end if;

  select count(*) into v_orphans from public.payment_methods where household_id is null;
  if v_orphans > 0 then
    raise exception 'Backfill incomplete: % payment_methods still have no household_id.', v_orphans;
  end if;

  select count(*) into v_orphans from public.sms_inbox where user_id is null;
  if v_orphans > 0 then
    raise exception 'Backfill incomplete: % sms_inbox rows still have no user_id.', v_orphans;
  end if;

  -- Two cards sharing last_digits inside one household would break the
  -- per-household unique constraint that 03-constraints adds. Catch it now,
  -- while it is still trivially fixable, rather than mid-migration.
  select count(*) into v_orphans from (
    select household_id, last_digits
    from public.payment_methods
    group by household_id, last_digits having count(*) > 1
  ) dupes;
  if v_orphans > 0 then
    raise exception 'Found % duplicate (household, last_digits) card pairs. Deduplicate before running 03.', v_orphans;
  end if;

  raise notice 'Backfill OK. household=% primary=% member=%', v_household_id, v_primary_id, v_member_id;
end $$;

commit;

-- Verify (all three should return 0):
--   select count(*) from public.receipts where user_id is null or household_id is null;
--   select count(*) from public.payment_methods where household_id is null;
--   select count(*) from public.sms_inbox where user_id is null;
--
-- And sanity-check the shape:
--   select visibility, count(*) from public.receipts group by visibility;  -- 43 household
--   select u.email, m.role from public.household_members m
--     join auth.users u on u.id = m.user_id;                               -- pras + sumi, both owner
