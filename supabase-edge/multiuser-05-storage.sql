-- Multi-user migration, step 5 of 5: receipt-documents storage.
--
-- SUPERSEDES storage-lockdown-receipt-documents.sql, which made the bucket
-- private but deliberately did NOT scope objects per user. Do not run both.
--
-- PREREQUISITE: run migrate-storage-paths.sh first. Every object in the bucket
-- is currently at a flat path (12 of them, verified 2026-08-11), and the
-- policies below key off the first path segment being the owner's uuid — so
-- until the objects are moved under `<uid>/`, they match nothing and become
-- unreachable. The script also rewrites receipts.file_url to match.
--
-- Path convention after migration: `<user_id>/<uuid>-<filename>`
-- Access: the owner may write and delete; any household peer may read, which is
-- what makes a co-managed household receipt's photo visible to both members.

begin;

-- Private bucket: stored `/object/public/...` URLs stop resolving, which is the
-- point — those URLs are readable by anyone on the internet today.
update storage.buckets
set public = false
where id = 'receipt-documents';

-- Casting the first path segment to uuid blows up on any object that isn't
-- uid-prefixed (a leftover flat file, a stray upload). A policy that can throw
-- is a policy that can take the whole app down, so cast defensively instead.
create or replace function public.storage_owner_uuid(object_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end $$;

revoke execute on function public.storage_owner_uuid(text) from public, anon;
grant execute on function public.storage_owner_uuid(text) to authenticated;

-- Drop whatever policies exist for this bucket. Names aren't known up front:
-- the bucket predates any committed script, and storage-lockdown-*.sql may or
-- may not have run.
do $$
declare pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%receipt-documents%'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- Read: any member of any household the object's owner belongs to.
create policy "Household peers read receipt documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipt-documents'
    and public.storage_owner_uuid(name) in (select public.household_peer_ids())
  );

-- Write: owner only. Enforcing the uid prefix here is what makes the read
-- policy's assumption hold — nobody can upload into someone else's folder.
create policy "Users upload own receipt documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipt-documents'
    and public.storage_owner_uuid(name) = auth.uid()
  );

create policy "Users update own receipt documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'receipt-documents'
    and public.storage_owner_uuid(name) = auth.uid()
  )
  with check (
    bucket_id = 'receipt-documents'
    and public.storage_owner_uuid(name) = auth.uid()
  );

create policy "Users delete own receipt documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipt-documents'
    and public.storage_owner_uuid(name) = auth.uid()
  );

commit;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Bucket is private:
--   select id, public from storage.buckets where id = 'receipt-documents';
--
-- No object left at a flat path (these would be orphaned by the policies):
--   select name from storage.objects
--   where bucket_id = 'receipt-documents' and position('/' in name) = 0;   -- 0 rows
--
-- Every object resolves to a real user:
--   select name from storage.objects
--   where bucket_id = 'receipt-documents'
--     and public.storage_owner_uuid(name) is null;                          -- 0 rows
--
-- Unauthenticated read is refused (expect 400/404, not 200):
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     'https://lxxetltpuuwjtxmeemhx.supabase.co/storage/v1/object/public/receipt-documents/<uid>/<file>'
