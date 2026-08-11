# Security runbook — manual steps

Everything that could be fixed in code is already done and deployed. What's left
needs either SQL execution, a dashboard change, or a decision only you can make.

Findings were verified live against the project, not inferred from code.

---

## A. Do now (independent, ~5 min)

### A1. Confirm the SMS cron still runs

`process-sms-inbox` now rejects anyone who isn't the service_role caller. The
cron supplies its key from Vault; the function compares against the key Supabase
injects. If those are different *formats* (legacy `eyJ…` JWT vs. newer
`sb_secret_…`), the cron will start returning 401 and SMS import silently stops.

Run in the SQL editor, ~15 min after the next quarter hour:

```sql
select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'process-sms-inbox-every-15-min')
order by start_time desc limit 5;
```

- `succeeded` → done, nothing to do.
- 401 / `Unauthorized` → the Vault secret isn't the injected service_role key.
  Fix by re-seeding Vault from Settings → API → `service_role`:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'process_sms_inbox_service_role_key'),
  '<SERVICE_ROLE_KEY>'
);
```

### A2. Revoke the leaked LLM API keys

An Anthropic key (`sk-ant-api03-cwPg3…`) was pasted into a chat transcript and
must be treated as compromised. A Moonshot key was also used at one point. Both
are now unused — the parser runs on Gemini — so revoking them breaks nothing.

- console.anthropic.com → Settings → API Keys → revoke
- platform.kimi.ai → API Keys → revoke

---

## B. The lockdown (do in one sitting, ~15 min)

Right now the public anon key — extractable from the iOS binary and plainly
visible in the web app's JS bundle — grants **full read, write and delete on all
43 receipts, 9 bank SMS, 4 payment cards and app settings**. Every receipt photo
is readable by anyone on the internet with no credentials at all.

These steps close that. Do them together: between B2 and B4 the iOS app cannot
reach the backend.

### B1. Create accounts for family members
Dashboard → Authentication → Users → Add User. One per person, plus one for
yourself to use on iOS.

### B2. Restrict the database to signed-in users
Run [`rls-authenticated-household-policies.sql`](rls-authenticated-household-policies.sql).

Replaces every `to anon` policy with `to authenticated` across receipts,
payment_methods, sms_inbox and app_settings — verified to be the complete table
surface. Still a shared household view: any signed-in member sees everything.

### B3. Make the receipt photo bucket private
Run [`storage-lockdown-receipt-documents.sql`](storage-lockdown-receipt-documents.sql).

**Run its STEP 1 inspection query first** and read the output — if any policy
grants `anon` access without naming a bucket, it applies to every bucket and the
script won't catch it. Drop those by name yourself.

### B4. Sign in on iOS
Tools tab → "Supabase Anon Mode" row → sign in with the account from B1.
Credentials persist in the Keychain, so this is one-time, not per-launch.

iOS receipt *upload* and all data access depend on this. iOS never displays
stored receipt images, so nothing else breaks.

### B5. Close the open LLM proxy

`parse-receipt` accepts the public anon key, so anyone holding it can burn your
Gemini credits — unmetered, and usable as a free general-purpose LLM. The gate is
already deployed but inert so iOS kept working. Once B4 is done, activate it:

```bash
supabase secrets set REQUIRE_AUTH=true --project-ref lxxetltpuuwjtxmeemhx
```

It then accepts only real signed-in users and the service_role caller used by the
SMS cron.

### B6. Verify the lockdown

All four should refuse. Any `200` means that step didn't take:

```bash
ANON="sb_publishable_7jF_NW4pRe8y6T-mFrLtew_9VtCke9e"
URL="https://lxxetltpuuwjtxmeemhx.supabase.co"
curl -s -o /dev/null -w 'receipts:  %{http_code}\n' "$URL/rest/v1/receipts?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s -o /dev/null -w 'sms:       %{http_code}\n' "$URL/rest/v1/sms_inbox?select=body&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s -o /dev/null -w 'photo:     %{http_code}\n' "$URL/storage/v1/object/public/receipt-documents/26798550-bf7d-4b60-b58f-e255cfedb597-image.jpg"
curl -s -o /dev/null -w 'parse:     %{http_code}\n' -X POST "$URL/functions/v1/parse-receipt" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"raw_text":"x 1.00 paid"}'
```

Then confirm the apps still work: sign into the web app, add a receipt with a
photo; on iOS, load a receipt list.

---

## C. When you deploy to Vercel

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project's
environment variables (same values as `webapp/.env.local`; Root Directory must be
`webapp`).

Both are safe to expose — they're client identifiers, not secrets. That is only
true once B2 and B3 are done; until then the anon key *is* effectively a master
credential for your data.

---

## Accepted, not fixed

- **Session tokens in `localStorage`.** Standard for a static SPA and readable by
  any XSS. There are no XSS vectors today (no `dangerouslySetInnerHTML`, no
  `eval`, no raw HTML rendering — checked), and the alternative needs a
  cookie-issuing server this app deliberately doesn't have.
- **Shared household visibility.** Any signed-in member can read and delete any
  other member's receipts. This is the intended model, not an oversight —
  per-user siloing would need `auth.uid()`-scoped policies and a `user_id`
  column backfill.
- **`Access-Control-Allow-Origin: *` on the Edge Functions.** Harmless once the
  functions authenticate callers, which they now do.
