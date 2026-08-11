-- Locks down the receipt-documents Storage bucket.
--
-- WHY: as shipped, this bucket is public-read with no credentials at all — any
-- receipt photo URL opens for anyone on the internet, and those images carry
-- merchant, amounts, card last-4, cardholder name and phone number. Separately,
-- the public anon key (extractable from the iOS binary and plainly visible in
-- the web app's JS bundle) could upload arbitrary files to the bucket and delete
-- every existing receipt image.
--
-- AFTER THIS RUNS:
--   - Stored public URLs (…/object/public/receipt-documents/…) stop resolving.
--     Nothing currently displays them — iOS only uploads, and the web app shows
--     a local preview of the file being added — so no read path breaks today.
--     Any future image display must request a signed URL instead.
--   - Uploading requires a signed-in session. The web app always has one. The
--     iOS app uses the anon key unless you sign in (Tools tab -> "Supabase Anon
--     Mode"), so iOS photo upload will fail until you do.
--
-- Run in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- STEP 1 — INSPECT FIRST. Run this on its own and read the output before
-- running step 2, so you know what you're replacing.
-- ---------------------------------------------------------------------------
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- order by policyname;
--
-- Note any policy that grants access to `anon` — either for this bucket by name,
-- or one with no bucket_id filter at all (those apply to EVERY bucket and are
-- easy to miss). Step 2 drops the ones naming receipt-documents; anything
-- broader you must review and drop by name yourself.

-- ---------------------------------------------------------------------------
-- STEP 2 — LOCK DOWN
-- ---------------------------------------------------------------------------

begin;

-- Private bucket: no more unauthenticated public URL reads.
update storage.buckets
set public = false
where id = 'receipt-documents';

-- Drop existing policies that specifically reference this bucket, whatever they
-- were named (the bucket predates any committed policy script, so the names
-- aren't known here).
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%receipt-documents%'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- Shared-household model: any signed-in member gets full access to the bucket.
-- Deliberately NOT scoped per-user (no (storage.foldername(name))[1] = auth.uid()
-- check) — receipts are shared across the household by design, so uid-scoping
-- would hide each member's photos from the others while adding no protection
-- against the threat that actually matters here (an unauthenticated stranger).
create policy "Household authenticated can read receipt documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'receipt-documents');

create policy "Household authenticated can upload receipt documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'receipt-documents');

create policy "Household authenticated can update receipt documents"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'receipt-documents')
  with check (bucket_id = 'receipt-documents');

create policy "Household authenticated can delete receipt documents"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'receipt-documents');

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (expect: public = false, and only the four policies above)
-- ---------------------------------------------------------------------------
-- select id, public from storage.buckets where id = 'receipt-documents';
--
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- order by policyname;
--
-- Then confirm from a terminal that an unauthenticated read is refused
-- (replace <file> with any real object name; expect 400/404, not 200):
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     'https://lxxetltpuuwjtxmeemhx.supabase.co/storage/v1/object/public/receipt-documents/<file>'
