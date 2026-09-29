-- Rename for household-custom categories (household_categories was add/delete
-- only until now — multiuser-15-household-categories.sql).
--
-- A rename can't just be an UPDATE policy on household_categories:
-- receipts.category is plain text, not a foreign key, so renaming the row
-- alone would leave every receipt already filed under the old name stranded
-- as a category nobody can pick any more. The receipts have to move with it —
-- including other members' *private* receipts in the same household, which
-- ordinary RLS would never let the caller update. Hence a SECURITY DEFINER
-- function that checks household membership itself, then updates:
--
--   1. the household_categories row,
--   2. that household's receipts still carrying the old name,
--   3. that household's learned correction rules pointing at the old name,
--      so future SMS/Gmail imports keep landing in the renamed category.
--
-- Scope is the category's own household only — never cross-household, same
-- boundary as everywhere else. Rejecting a name that collides with a built-in
-- (EXPENSE_CATEGORIES) is left to the client, same as the add path; a
-- collision with another custom category is caught here.
--
-- Run after multiuser-17-commute-category.sql. Safe to re-run.

begin;

create or replace function public.rename_household_category(p_id uuid, p_new_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_household_id uuid;
  v_old_name text;
  v_new_name text := trim(coalesce(p_new_name, ''));
begin
  if v_new_name = '' then
    raise exception 'Category name cannot be empty';
  end if;

  select household_id, name into v_household_id, v_old_name
  from public.household_categories
  where id = p_id;

  if v_household_id is null
     or v_household_id not in (select public.current_household_ids()) then
    raise exception 'Category not found';
  end if;

  if v_old_name = v_new_name then
    return;
  end if;

  if exists (
    select 1 from public.household_categories
    where household_id = v_household_id
      and id <> p_id
      and lower(name) = lower(v_new_name)
  ) then
    raise exception '"%" already exists', v_new_name;
  end if;

  update public.household_categories
  set name = v_new_name
  where id = p_id;

  update public.receipts
  set category = v_new_name
  where household_id = v_household_id
    and category = v_old_name;

  update public.receipt_correction_rules
  set corrected_category = v_new_name
  where household_id = v_household_id
    and corrected_category = v_old_name;
end;
$$;

revoke execute on function public.rename_household_category(uuid, text) from public, anon;
grant execute on function public.rename_household_category(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
