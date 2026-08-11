-- Replaces the "anon key = full access" policies with "any signed-in household
-- member = full access" policies. This is still a SHARED household view, not
-- per-user data siloing (no `auth.uid() = user_id` anywhere) — it just changes
-- who's allowed to use the anon key's old blanket access from "anyone with the
-- key" to "anyone with a real Supabase Auth session."
--
-- Run this ONLY after:
--   1. Family member accounts exist (Dashboard -> Authentication -> Users -> Add User)
--   2. You're ready to sign into the iOS app immediately afterward (Tools tab ->
--      "Supabase Anon Mode" row -> sign in) — until you do, iOS's anon-mode
--      calls will fail, since this script removes the anon policies it relies on.
--
-- Covers: receipts, payment_methods (previously in rls-single-user-anon-policies.sql),
-- sms_inbox (previously in sms-inbox-schema.sql), app_settings (previously in
-- app-settings-schema.sql). Storage bucket policies for receipt-documents are
-- NOT in this script — see the inspect-then-replace steps in the plan, since
-- no policy script for that bucket exists to know the current policy names.

begin;

-- receipts
drop policy if exists "Single user anon can read receipts" on public.receipts;
drop policy if exists "Single user anon can insert receipts" on public.receipts;
drop policy if exists "Single user anon can update receipts" on public.receipts;
drop policy if exists "Single user anon can delete receipts" on public.receipts;

create policy "Household authenticated can read receipts"
  on public.receipts for select
  to authenticated
  using (true);

create policy "Household authenticated can insert receipts"
  on public.receipts for insert
  to authenticated
  with check (true);

create policy "Household authenticated can update receipts"
  on public.receipts for update
  to authenticated
  using (true)
  with check (true);

create policy "Household authenticated can delete receipts"
  on public.receipts for delete
  to authenticated
  using (true);

-- payment_methods
drop policy if exists "Single user anon can read payment methods" on public.payment_methods;
drop policy if exists "Single user anon can insert payment methods" on public.payment_methods;
drop policy if exists "Single user anon can update payment methods" on public.payment_methods;
drop policy if exists "Single user anon can delete payment methods" on public.payment_methods;

create policy "Household authenticated can read payment methods"
  on public.payment_methods for select
  to authenticated
  using (true);

create policy "Household authenticated can insert payment methods"
  on public.payment_methods for insert
  to authenticated
  with check (true);

create policy "Household authenticated can update payment methods"
  on public.payment_methods for update
  to authenticated
  using (true)
  with check (true);

create policy "Household authenticated can delete payment methods"
  on public.payment_methods for delete
  to authenticated
  using (true);

-- sms_inbox (read + update only, matching sms-inbox-schema.sql — inserts stay
-- service_role-only via receive-sms, unaffected by this change either way)
drop policy if exists "Single user anon can read sms inbox" on public.sms_inbox;
drop policy if exists "Single user anon can update sms inbox" on public.sms_inbox;

create policy "Household authenticated can read sms inbox"
  on public.sms_inbox for select
  to authenticated
  using (true);

create policy "Household authenticated can update sms inbox"
  on public.sms_inbox for update
  to authenticated
  using (true)
  with check (true);

-- app_settings
drop policy if exists "Single user anon can read app settings" on public.app_settings;
drop policy if exists "Single user anon can write app settings" on public.app_settings;

create policy "Household authenticated can read app settings"
  on public.app_settings for select
  to authenticated
  using (true);

create policy "Household authenticated can write app settings"
  on public.app_settings for all
  to authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
