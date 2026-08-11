-- Multi-user migration, step 3 of 5: tighten constraints.
--
-- Run only after multiuser-02-backfill.sql has committed cleanly — these
-- statements fail loudly if any row is still unowned, which is the point.
--
-- Still no RLS change here; clients keep working on the anon policies.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownership becomes mandatory
-- ---------------------------------------------------------------------------

alter table public.receipts alter column user_id set not null;
alter table public.payment_methods alter column household_id set not null;

-- receipts.household_id stays NULLABLE on purpose: a receipt whose owner is not
-- in any household is still valid (it is simply private to them), and
-- is_visible_receipt() already treats a null household as not-shared.

-- ---------------------------------------------------------------------------
-- 2. Uniqueness becomes per-tenant instead of global
-- ---------------------------------------------------------------------------

-- Cards: the global unique on last_digits was dropped in 01-schema. Re-add it
-- scoped to the household, so two households can each own a card ending 4242
-- while one household still cannot register the same card twice.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_methods_household_digits_key'
  ) then
    alter table public.payment_methods
      add constraint payment_methods_household_digits_key
      unique (household_id, last_digits);
  end if;
end $$;

-- SMS: body_hash is globally unique today, so when a shared family card alerts
-- both phones the second person's message is silently swallowed as a duplicate
-- by receive-sms (it returns {ok:true, duplicate:true}). Scope it per user so
-- each person gets their own copy; cross-user double counting is prevented
-- later, at receipt level, by the household duplicate check in process-sms-inbox.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'sms_inbox'
      and con.contype = 'u'
      and (select array_agg(att.attname::text)
           from unnest(con.conkey) k
           join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
          = array['body_hash']
  loop
    execute format('alter table public.sms_inbox drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint where conname = 'sms_inbox_user_body_hash_key'
  ) then
    alter table public.sms_inbox
      add constraint sms_inbox_user_body_hash_key unique (user_id, body_hash);
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid in ('public.payment_methods'::regclass, 'public.sms_inbox'::regclass)
--     and contype = 'u';
--   -- expect payment_methods_household_digits_key (household_id, last_digits)
--   --        sms_inbox_user_body_hash_key        (user_id, body_hash)
