# supabase-edge — database scripts and operational tooling

This folder holds the **SQL migrations, one-off scripts, and runbooks** for the
Supabase backend.

**Edge Function source does not live here.** It lives in `supabase/functions/`,
which is the only place the Supabase CLI deploys from. This folder used to keep
a second copy of `parse-receipt` and `receive-sms`; nothing kept the two in sync,
they drifted, and the stale copy read as authoritative to whoever opened it
first. The copies are gone — edit `supabase/functions/<name>/index.ts`.

## Deploying a function

From the repository root:

```bash
supabase functions deploy <name> --project-ref <ref>
```

`register-user` is the exception — it serves callers who are not signed in yet,
so it must keep its JWT gate off:

```bash
supabase functions deploy register-user --no-verify-jwt --project-ref <ref>
```

## Functions and their secrets

| Function | What it does | Secrets |
|---|---|---|
| `parse-receipt` | Extracts structured fields **and a full text transcription** from receipt text or a photo, via an OpenAI-compatible chat API | `LLM_API_KEY`, optional `LLM_MODEL`, optional `REQUIRE_AUTH` |
| `receive-sms` | Ingest endpoint for the iOS Shortcut that forwards bank SMS | `SMS_INGEST_SECRET` |
| `process-sms-inbox` | Cron job draining `sms_inbox` into `receipts` | none beyond the injected service role |
| `scan-gmail` | Cron job importing receipts from connected Gmail accounts | Gmail OAuth secrets |
| `gmail-connect` | Completes the per-user Gmail OAuth flow | Gmail OAuth secrets |
| `manage-household` | Adds and removes household members | none beyond the injected service role |
| `register-user` | Invite-gated self-registration | `SIGNUP_INVITE_CODE` |

The LLM provider is chosen entirely by `LLM_API_URL`/`LLM_MODEL` in
`parse-receipt`; it has been Anthropic, then Moonshot, then Gemini, now Groq.
Any replacement model needs **both image input and JSON mode** — the webapp's
camera flow and the raw-text backfill both depend on vision, and a text-only
model breaks them without an obvious error.

## SQL scripts

Run in the Supabase SQL editor. The `multiuser-0N-*.sql` set is ordered and
should be applied in sequence. `rls-single-user-anon-policies.sql` is superseded
by `rls-authenticated-household-policies.sql` and kept only for history.

See `SECURITY-RUNBOOK.md` for the operational procedures.

## Scripts

- `backfill-receipt-raw-text.mjs` — re-parses stored receipt images so photo
  receipts saved before the transcription existed become searchable. Needs
  `service_role`; supports `--dry-run`.
- `migrate-storage-paths.py` — one-off storage path migration.
