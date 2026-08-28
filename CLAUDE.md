# Bill Skills — implementation reference

This file documents the logic and rules this application was actually built
with — the decisions that aren't visible from reading any single file. It is
a reference for working on the codebase, not a tutorial. When a rule here and
the code disagree, the code is right and this file is stale — fix whichever
is wrong.

## What this is

A family expense tracker. Receipts get into the system three ways — a photo
or PDF taken in the web app, a forwarded bank SMS, or a forwarded/received
email — and land in one shared `receipts` table, scoped to a household so
several people can see and edit each other's spending.

Two clients exist:

- **`webapp/`** — React + Vite + TypeScript + Tailwind v4 PWA. This is the
  actively developed, primary client. Mobile-first: designed and tested
  against an iPhone viewport first, desktop second.
- **`ExpenseManager/`** — the maintained iOS SwiftUI app (`ios-app/` is a
  legacy snapshot, not kept in sync — don't start new work from it). **Do not
  modify the iOS app unless explicitly asked.** It shares the same Supabase
  backend and several pieces of business logic were *ported from* it
  (currency conversion, SMS transaction-cue parsing, expense categories) —
  when those need to change on the backend, check whether the iOS
  implementation was the source of truth and whether it should change too,
  but don't edit Swift files unprompted.

Backend is entirely Supabase: Postgres + Auth + Storage + Edge Functions
(Deno) + pg_cron + pg_net + Vault + pgcrypto. There is no other server.

## Repo layout

```
webapp/src/pages/         route-level screens
webapp/src/components/    shared UI (ReceiptForm, NavBar, cards, tiles)
webapp/src/hooks/         useAuth, useReceipts, useSettings — React context providers
webapp/src/lib/           supabaseClient (all REST/RPC calls), auth, currency,
                           categories, pdfUtils, imageUtils, smsShortcut
supabase/functions/       Edge Function source — the ONLY place the CLI deploys from
supabase-edge/            SQL migrations (multiuser-0N-*.sql, run in order),
                           runbooks, one-off scripts. No Edge Function source here.
ExpenseManager/           maintained iOS app (Xcode project)
ios-app/                  legacy iOS snapshot — do not build on this
```

## Data model

Core tables (all in `public`, all RLS-enabled):

- **`households`** — `id`, `name`, `created_by`.
- **`household_members`** — links a user to a household; has an owner flag
  (`is_household_owner()` checks this).
- **`user_settings`** — one row per user: `active_household_id`,
  `default_currency`, etc. `active_household_id` is what
  `set_receipt_owner()` reads to stamp new receipts, falling back to the
  first row in `household_members` (by `joined_at`) if unset.
- **`receipts`** — the shared table everything ingests into. Key columns:
  `merchant`, `date`, `total` (reporting total in the owner's
  `default_currency`), `receipt_amount`/`receipt_currency`/`conversion_rate`/
  `converted_total` (original-currency figures — **not present on every
  deployed environment**; `insertReceipt` retries without them on a missing-
  column error, so never assume they exist), `category`, `card_bank`/
  `card_last4`, `user_id`, `household_id`, `visibility`
  (`'private'`/`'household'`), `source` (`'manual'`/`'photo'`/`'sms'`/
  `'gmail'`), `reviewed_at` (null = needs review), `gmail_message_id`
  (unique per `user_id`, not globally — see Duplicate detection),
  `reversal_of_receipt_id`, `transfer_from_bank`/`transfer_to_bank`/
  `transfer_kind` (only meaningful when `category = 'Local Transfer'`),
  `comment` (free text, auto-filled from the parser's `derivation_note`,
  editable — see Receipt comments and learned corrections).
- **`sms_inbox`** — raw landing zone for `receive-sms`. `body_hash` unique
  per `(user_id, body_hash)` (not globally — a shared card alerting two
  phones must produce two rows). Status machine:
  `pending → processing → processed|skipped|failed`.
- **`sms_ingest_tokens`** — per-user bearer tokens for the iOS Shortcut
  automation. `create_sms_ingest_token()` returns the raw token once; only
  its SHA-256 hash is stored.
- **`gmail_connections`** — one row per user with a connected Gmail account:
  `email`, `last_scan_at`, `last_error`. The actual OAuth refresh token lives
  in **Supabase Vault**, never in a client-readable table.
- **`gmail_scan_log`** — records *only* emails scan-gmail found and rejected
  (with a reason) or that hit a hard error, never successful imports —
  deliberately, so it stays a short "what went wrong" list rather than a
  full activity log. Has `retry_count` for the retry-budget pattern (below).
- **`payment_methods`** — household-scoped card registry (`last_digits`,
  `bank_name`, `card_name`), used to resolve `card_bank` when an SMS/email
  only gives the last 4 digits.
- **`receipt_correction_rules`** — household-scoped, one row per merchant
  keyword: learned corrections (`corrected_merchant`/`corrected_category`/
  `corrected_currency`/`corrected_card_last4`/`corrected_card_bank`) plus a
  freeform `note`, `use_count`. See Receipt comments and learned corrections.
- **`household_categories`** — household-scoped custom categories, additions
  only (never the fixed built-ins). `(household_id, lower(name))` unique.
  See Categories.

### Ownership

`receipts_set_owner` (a trigger, `set_receipt_owner()`) stamps `user_id` from
`auth.uid()` and `household_id` from `user_settings.active_household_id` on
insert, if either is null. **Client code never sets these directly.**

### RLS shape

Visibility for `receipts` (and mirrored for other household-scoped tables)
goes through `is_visible_receipt(user_id, household_id, visibility)`:
visible if you own the row, OR it's `visibility = 'household'` and you're a
member of that household. Insert policy requires `user_id = auth.uid()`.
There is no cross-household visibility anywhere in the schema — a household
is a hard privacy boundary, not just a grouping label.

## Auth & registration

Real Supabase Auth (password grant), not a client-side gate — this was an
explicit decision after the app moved from a private tool to a
publicly-reachable URL. Sessions are the standard `/auth/v1/token` access +
refresh token pair, stored in `localStorage` (webapp) mirroring the iOS app's
Keychain-backed store almost exactly (`webapp/src/lib/auth.ts` documents the
parallel).

Registration is gated: `register-user` (deployed with `--no-verify-jwt`,
since callers aren't signed in yet) requires a shared invite code
(`SIGNUP_INVITE_CODE`), checked with a timing-safe comparison. It creates the
auth user, their household, and their `user_settings` row atomically — a bare
`/auth/v1/signup` would leave a user with no household and nothing visible,
since every RLS policy and the ownership trigger depend on those existing.
**Supabase's own public signup must stay disabled in the dashboard**
(Authentication → Providers → "Allow new users to sign up" off), or this
gate is decorative.

`manage-household` (JWT-gated, caller must be an owner) adds/removes
members. Removing a member unlinks them but never deletes their auth account
or receipts — `receipts.user_id` cascades on user deletion, so deleting the
account would silently destroy their spending history.

## Receipt ingestion — three pipelines

All three converge on the same `receipts` table and the same shape.

### 1. Manual / photo / PDF (`AddReceiptPage.tsx`)

- File picker accepts `image/*,application/pdf` — the `application/pdf` in
  `accept` is what makes iOS Safari offer "Browse" (Files/iCloud) instead of
  just Camera/Photo Library.
- A PDF is rendered client-side to an image (`pdfUtils.ts`, `pdfjs-dist`,
  first page only — receipts are effectively always one page) before
  anything else happens; from that point a PDF and a photo are handled
  identically.
- `pdfUtils` is **dynamically imported** (`await import('../lib/pdfUtils')`)
  so pdf.js (~250KB gzipped) only downloads for someone who actually picks a
  PDF — and is excluded from the PWA precache
  (`workbox.globIgnores: ['**/pdfUtils-*.js']` in `vite.config.ts`), or the
  service worker would silently fetch it for every visitor on install.
- The image is compressed client-side, uploaded to Storage, and sent to
  `parse-receipt` as base64 for vision parsing — in parallel with the
  upload.
- **No duplicate check runs on this path.** It's the one true gap — SMS and
  Gmail both guard against duplicates, manual entry doesn't.

### 2. SMS (iOS Shortcut → `receive-sms` → `sms_inbox` → `process-sms-inbox` cron)

- Each household member has their **own** SMS ingest token
  (`sms_ingest_tokens`) — required, not optional, because a bank SMS carries
  no other per-user signal; the token *is* the identity.
- `receive-sms` accepts `{ body, sender?, source?, received_at?,
  idempotency_key?, metadata? }`, resolves the owner from
  `x-sms-ingest-secret`, and inserts into `sms_inbox` with a `body_hash`
  (SHA-256 of the idempotency key or a composite of source/sender/date/body).
  `MAX_BODY_CHARS = 8_000`.
- iOS Shortcuts setup: the in-app instructions lead with **manually building
  the Shortcut** (Get Contents of URL → POST → JSON body with `body` bound to
  the *Shortcut Input variable*, not literal text), not the downloadable
  `.shortcut` file — current iOS versions increasingly reject unsigned
  `.shortcut` files outright ("Unsigned Shortcuts is Not Supported") with no
  rescue toggle. The download button is kept as an optional, clearly
  caveated fallback behind a `<details>` disclosure.
- `process-sms-inbox` runs every 15 minutes (`cron.schedule`,
  `'*/15 * * * *'`), batch size 5 (small deliberately — pg_net abandons the
  connection on timeout, and a bigger batch never finishes in time; a
  backlog just drains over more ticks).
- Parsing logic ported from the iOS app's `InvoiceParser`: `TRANSACTION_CUES`
  gate whether a message is even a transaction, `NON_EXPENSE_CUES` reject
  OTPs/balance-enquiry noise, `REVERSAL_CUES` route to reversal handling
  instead of a new receipt.
- **Reversals don't create a new receipt.** A matching prior receipt (same
  owner, amount, recent date, not already reversed) gets
  `reversal_of_receipt_id` set on a *new negative-total* row referencing it —
  both the charge and its reversal stay visible, and the original can't be
  offset twice.
- `sms_inbox` itself accepts and queues messages unattended — no gate before
  a row is picked up for processing (`isnt ios directly inserting sms text
  as it is` was an explicit decision). The **resulting receipt**, though,
  still lands with `reviewed_at = null`, same as Gmail — it was parsed by an
  LLM with nobody looking, so it surfaces in the "needs review" queue until a
  human confirms merchant/amount/date. Don't conflate the two: unattended
  *ingestion* into `sms_inbox`, but not unattended *trust* of the parse.

### 3. Gmail (`gmail-connect` OAuth → `scan-gmail` cron / "Scan now" button)

- OAuth is per-user (`gmail.readonly` scope only); the refresh token is
  stored in Supabase Vault, never in a plain table, because RLS is row-level
  and a token column would be readable by whoever can read that row.
- **The connected mailbox is whatever account completed OAuth — not
  necessarily the user's primary inbox.** If OAuth was done against a
  secondary/agent address, bank alerts landing in the primary inbox need to
  be manually forwarded to the connected address before scan-gmail can ever
  see them. This is an operational fact, not a bug — check
  `gmail_connections.email` before assuming an email "should" have been
  picked up.
- Runs twice a day (`'7 7,19 * * *'`), not every 15 minutes — email is less
  time-sensitive than SMS, and this project has hit rate/quota limits with
  three different LLM providers already. The Settings → Gmail import
  "Scan now" button runs the same function immediately for just the caller.
- Search query (`QUERY_TERMS`) is a short list of common single words
  (`receipt`, `payment`, `confirmed`, `paynow`, ...), OR'd together, minus
  `-category:promotions -category:social -category:forums`. **Deliberately
  not a long list of exact quoted phrases** — Gmail treats a quoted
  multi-word term as an exact phrase, so a long phrase list kept losing to
  real subject-line wording (a Lazada "your order is confirmed!" matched
  none of ~30 phrases). Real qualification — "is this actually a receipt" —
  is left entirely to the LLM in `parse-receipt`, gated only by a cheap
  local check (`looksLikeReceipt`: does any money-shaped number appear
  anywhere).
- `extractText()` prefers the message's **plain-text MIME part** over the
  HTML part when both exist (multipart/alternative means "pick one
  representation, not both" — concatenating both used to silently double
  every email's size). Falls back to HTML-stripped text only if no plain
  part exists. Any URL 60+ characters long is collapsed to `[link]` —
  marketing-template receipts (Lazada especially) route every nav/footer
  link through a tracking redirect long enough to dominate the character
  budget on its own (one real example: 121,721 raw characters, 16,862 of it
  still in the plaintext part, almost entirely tracking URLs).
- `MAX_RAW_TEXT_CHARS = 18_000` truncates the extracted text before it's
  sent to `parse-receipt`. `reference_date` is set to the email's own
  `internalDate`, not "now" — bank alerts often omit the year, and without a
  real anchor the model has guessed a stale year from training data before.
- Retry budget: `MAX_PARSE_ATTEMPTS = 3` per message (via
  `gmail_scan_log.retry_count`, checked by `hasExhaustedRetries` before even
  re-fetching). **A 429 from the LLM provider does not count against this
  budget** — it's logged distinctly and retried like a fresh message next
  tick, because a rate limit says nothing about whether the email is a real
  receipt. Once a message is retry-exhausted it's silently skipped forever
  on every future scan (no new log row) — if a code fix might now let it
  succeed, its `gmail_scan_log` row has to be deleted manually to get it
  reconsidered, and only helps if the message is still inside the current
  `since` window (`last_scan_at - 1 day`, or `DEFAULT_LOOKBACK_DAYS = 7` if
  never scanned) — messages that have aged out need to be re-forwarded, not
  just unblocked.
- Imported receipts always land with `reviewed_at = null` (needs review) —
  unlike SMS, nobody has verified the LLM's reading of an email yet.

## Receipt parsing (`parse-receipt`)

- Groq-hosted `qwen/qwen3.6-27b` via an OpenAI-compatible chat completions
  API (`LLM_API_URL`/`LLM_MODEL` are configurable; the account has churned
  through Anthropic → Moonshot → Gemini → Groq already). **Any replacement
  model needs both image input and JSON mode** — the webapp's camera path
  and the raw-text backfill script both depend on vision; a text-only model
  breaks them without an obvious error.
- `max_tokens: 4000` — empirically the ceiling for this account; `8000`
  causes Groq to reject the request outright with 413. Don't raise this
  without a live regression test against real content first (this exact
  regression shipped once and was caught before a second deploy).
- Accepts either `raw_text` or `image_base64` (`image_mime_type` must be one
  of `image/jpeg`, `image/png`, `image/webp`; `MAX_IMAGE_BASE64_CHARS =
  8_000_000` ≈ 6MB decoded — the client compresses before upload).
- `REQUIRE_AUTH` is off by default (would otherwise break the iOS app until
  it has its own sign-in), which means **this function is an open, unmetered
  proxy to a paid LLM by default** — the anon key ships in both client
  bundles. Flip `REQUIRE_AUTH=true` once every caller authenticates.
- Errors carry `upstream_status` and a `truncated` flag distinctly, so a
  caller can tell "the provider rejected this as too large" (413) apart from
  "the provider's own response got cut off mid-JSON by its token budget"
  apart from "couldn't reach the provider at all" — each has a different
  fix and used to be one indistinguishable bucket.
- Also returns `derivation_note` — one short sentence explaining how it
  arrived at the values (which line it read a field from, or what it
  inferred something from and why). Comes from the same call, no extra
  request. This is what pre-fills a receipt's comment box; see below.

## Receipt comments and learned corrections

Every receipt has a free-text `comment` column, pre-filled from
`parse-receipt`'s `derivation_note` at creation time (webapp, SMS, and Gmail
alike) and freely editable afterward — a place for "why does this say what
it says" that survives independently of the structured fields.

Editing a receipt also **teaches the parser**, household-wide, via
`receipt_correction_rules` (`multiuser-14-receipt-comment-and-learning.sql`)
and two functions:

- **`learn_receipt_correction(...)`** — called by the webapp
  (`webapp/src/lib/supabaseClient.ts`'s `learnReceiptCorrection`, fired from
  `ReceiptForm`'s submit handler) whenever a save changes merchant/category/
  currency/card away from what the form started with, **or** the comment box
  is non-empty — whichever triggers it, both the corrected fields and the
  comment text are written. Upserts on `(household_id, merchant_keyword)` —
  latest correction always wins. The keyword is the normalized merchant name
  (stop-words like "receipt"/"payment"/"card" stripped — mirrors
  `normalizedMerchantKey` in `ReceiptStore.swift` so a keyword learned on one
  client still matches on another), falling back to the first short line of
  raw text when there's no merchant yet.
- **`match_correction_rules(household_id, raw_text)`** — called by
  `process-sms-inbox` and `scan-gmail` (`fetchCorrectionHints`, right before
  their `parse-receipt` call) to fetch up to 12 rules whose keyword appears
  in the incoming message, passed straight through as `learning_hints`.
  Bumps each matched rule's `use_count` as a side effect, which is why it's
  declared **not** `stable` — a stable SQL function can't contain a write;
  this was caught by a live test that failed with "SELECT is not allowed in
  a non-volatile function," not by inspection.

This **centralizes and activates** a mechanism that predates it: iOS has had
its own `learning_hints`/`ReceiptCorrectionRule` system for a while
(`ExpenseManager/ExpenseManager/Views/ReceiptStore.swift`), and
`parse-receipt` has accepted and injected `learning_hints` into its prompt
since it was ported — but iOS stores its rules in local `UserDefaults`,
per-device, and nothing else ever populated the hints. The webapp and both
cron pipelines now share one household-scoped table instead. iOS's local
rules are untouched and still work exactly as before; the two systems don't
currently sync with each other.

Scope, matching the duplicate-check precedent: household-scoped (`current_household_ids()`), never cross-household — a rule one member learns benefits every member's future imports.

## Duplicate detection

Runs independently in `process-sms-inbox` and `scan-gmail` (structurally
identical logic, not shared code — no `_shared/` directory exists for Edge
Functions in this repo). **Does not run at all on the manual/photo path.**

Scope is always **per-household** (falling back to per-user only if the
owner has no household) — **never across households.** A receipt forwarded
to two household members is legitimately two records; two different
households' coincidentally-identical purchases must never suppress each
other. This is enforced by filtering on `household_id`/`user_id` before any
content comparison, not by RLS (the check runs with the service-role key,
which bypasses RLS entirely — the household scoping is a deliberate choice
in the query, not a security boundary).

A candidate is flagged a duplicate if, within the same scope:

1. **Total** matches within ±$0.01, **and**
2. **Date** matches within ±24 hours (overlapping windows to tolerate an
   email arriving a day after its SMS counterpart), **and**
3. Either:
   - **Merchant text** overlaps (case-insensitive exact match or substring
     either direction), **or**
   - **`card_bank` + `card_last4` match exactly** AND the date matches
     **exactly** (not the ±24h window) — added after a real miss where the
     SMS import named the actual merchant ("Transit") and the Gmail import
     named the bank instead ("UOB") for the same charge; merchant text
     disagrees across sources more often than expected, and a matching card
     on the same calendar day is an independently strong signal on its own.

Currency is not separately compared — `total` here is always the *converted*
total in the owner's `default_currency`.

## Currency conversion

Ported from and mirrored across three places (iOS
`CurrencyConversionService.swift`, `webapp/src/lib/currency.ts`,
`process-sms-inbox`/`scan-gmail`'s inline copies) — keep all in sync if this
logic changes. Same-currency is a no-op (rate 1). Otherwise: live rate from
`api.frankfurter.app` for the transaction date, clamped to "today" if the
date is in the future; on any failure, a small hardcoded `FALLBACK_RATES_TO_SGD`
table (relative to SGD) computes an approximate cross-rate. Always rounds to
2dp.

## Categories

`EXPENSE_CATEGORIES` (`webapp/src/lib/categories.ts`, ported from the iOS
`Invoice.swift`) is the fixed base list — 17 entries, shared by every
household, never edited by this feature. Two of them — `'Local Transfer'`
and `'Credit Card Bill Payment'` — are excluded from every spend total/
average/chart via `isExpenseCategory()`, because they represent money moving
between accounts, not money spent; they're still kept as receipts for
record-keeping, and `'Local Transfer'` gets its own detail fields
(`transfer_from_bank`/`transfer_to_bank`/`transfer_kind`).

Households can additionally **add their own categories** (Settings →
Categories → `CategoriesSetupPage.tsx`), stored in `household_categories`
(household-scoped, add/delete only — no rename, and the two special
categories above are never rows in this table, so there's nothing to
protect from being renamed or deleted). `receipts.category` has no DB check
constraint — it's plain `text`, and Reports/`CategoryBadge` already derive
categories from whatever's on each receipt rather than a fixed list — so a
custom category works everywhere a built-in one does with zero extra
plumbing on the read side.

The one place custom categories need active support is classification:
`parse-receipt`'s system prompt normally hardcodes the enum *and* a
hand-written one-sentence rule per built-in category. `process-sms-inbox`
and `scan-gmail` fetch the caller's household's custom categories
(`fetchHouseholdCategories`, same best-effort shape as `fetchCorrectionHints`)
and pass them as `household_categories` in the request; `parse-receipt`
appends them to the legal-values enum plus one generic instruction to prefer
them "when it fits more precisely," since no hand-written rule is possible
for a name someone just typed. No field sent → prompt is byte-for-byte
unchanged, so this can't regress any caller that doesn't send it (iOS, and
`AddReceiptPage`'s own manual/photo parse calls, currently don't — a human
reviews the form right there either way, same as for every built-in
category, so only the two *unattended* paths were wired up). Classification
accuracy into a custom category is expected to be weaker than into a
built-in one for that reason; the existing correction-learning hints
(`receipt_correction_rules`) reinforce it per-merchant once corrected once.

## Storage

The `receipt-documents` bucket was originally public-read with no
credentials — any receipt image URL (carrying merchant, amounts, card
last-4, name, phone number) was openly reachable, and the anon key alone
could upload/delete arbitrary objects. `storage-lockdown-receipt-documents.sql`
closes this: uploads require a signed-in session, and stored public URLs no
longer resolve — any future feature that *displays* a stored receipt image
must fetch a signed URL, not the historical public path.

## Retry / error-handling conventions

Two independent retry-budget systems share the same shape (`retry_count`
column + a fixed max), deliberately: `sms_inbox` rows and
`gmail_scan_log` rows. In both: a genuine failure counts against the budget
and eventually gives up silently; a 429 (provider rate limit) never counts,
because it's a statement about timing, not about whether the content is
valid. A failed duplicate-check call never blocks a legitimate insert — it
fails open, on the reasoning that a missed duplicate is recoverable, a
dropped real receipt is not.

## PWA / build conventions

- `vite-plugin-pwa` with `generateSW`, `registerType: 'autoUpdate'`.
- `navigateFallbackDenylist` excludes `/rest/` and `/functions/` — API/edge
  responses must never be served from the app-shell cache; receipt data has
  to always be fetched fresh.
- Any dependency that's meaningfully sized and only needed by one code path
  (pdf.js is the current example) should be dynamically `import()`ed **and**
  added to `workbox.globIgnores`, or Workbox precaches it for every install
  regardless of whether that visitor ever uses the feature.

## Deployment

```bash
supabase functions deploy <name> --project-ref <ref>
```

`register-user` is the one exception (`--no-verify-jwt` — its callers aren't
signed in yet). SQL migrations live in `supabase-edge/multiuser-0N-*.sql`
and are meant to be applied **in numeric order**; one-off fix scripts
(`multiuser-13-sms-token-pgcrypto-fix.sql` and similar) are safe to re-run.
Edge Function source lives *only* in `supabase/functions/` — a second copy
under `supabase-edge/` existed once, drifted from the real one, and was
deleted; don't recreate that split.

Current secrets per function:

| Function | Secrets |
|---|---|
| `parse-receipt` | `LLM_API_KEY`, optional `LLM_MODEL`, optional `REQUIRE_AUTH` |
| `receive-sms` | per-user tokens (`sms_ingest_tokens`); `SMS_INGEST_SECRET`/`LEGACY_SMS_USER_ID` only as a migration-window fallback |
| `process-sms-inbox` | none beyond the injected service role |
| `scan-gmail` | Gmail OAuth secrets, reads Vault for refresh tokens |
| `gmail-connect` | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URIS` |
| `manage-household` | none beyond the injected service role |
| `register-user` | `SIGNUP_INVITE_CODE` |

## Known gotchas (already hit, don't re-discover)

- **pgcrypto schema location**: modern Supabase projects install extensions
  into an `extensions` schema, not `public`. A `SECURITY DEFINER` function
  declared with `set search_path = public` silently can't see
  `gen_random_bytes()`/`digest()` even with the extension enabled — declare
  `set search_path = public, extensions`.
  (`multiuser-13-sms-token-pgcrypto-fix.sql`.)
- **Groq `max_tokens`**: keep at 4000; 8000 gets the whole request rejected
  with 413, not just truncated.
- **A Postgres SQL function that writes (even just an `update` for a
  side-effect counter) cannot be `stable`** — declaring one that way fails
  at call time with "SELECT is not allowed in a non-volatile function"
  (`match_correction_rules`, caught by a live test, not by inspection).
  Leave it as the default (volatile) if it writes anything at all.
- **iOS `.shortcut` file installs are no longer reliable** — recent iOS
  outright refuses unsigned Shortcut files with no fallback toggle on some
  versions. Lead users to the manual-build instructions.
- **`extractText` in `scan-gmail`**: never revert to concatenating both
  plain and HTML MIME parts — it silently doubles the payload sent to the
  LLM and was the direct cause of permanent import failures on
  heavily-templated marketing/receipt emails.
- **Optional receipt columns aren't guaranteed present** on every deployed
  environment (`receipt_amount`, `receipt_currency`, `conversion_rate`,
  `converted_total`, `default_currency`) — `insertReceipt` always retries
  without them on a missing-column error; don't assume they exist when
  reading receipts either.
- **Never assume a forwarded/connected mailbox is the user's primary
  inbox** — check `gmail_connections.email` before diagnosing a "missing"
  email as a code bug.

## Ad-hoc analysis (`notebooks/`)

A gitignored Jupyter setup for querying the live database directly, outside
the deployed app — see `notebooks/README.md` for setup and when to reach for
it (investigating a reported issue, prototyping a `parse-receipt` change
against real samples, sanity-checking a fix over real data before shipping
it). Read-only by convention: the one time this project inserted receipts
directly by hand instead of through the normal pipeline, it bypassed the
duplicate check and created duplicates that had to be cleaned up again.

## Working conventions for this repo

- Never touch the iOS app (`ExpenseManager/`, `ios-app/`) unless explicitly
  asked, even when porting logic in the other direction (web → iOS is not
  assumed just because iOS → web has happened repeatedly).
- Never request, print, or hardcode the Supabase `service_role` key or any
  LLM provider key. The anon/publishable key is not sensitive (it already
  ships inside the iOS binary and the web bundle) and is fine to use
  directly.
- Prefer fixing root causes in the Edge Functions/schema over client-side
  workarounds — most of this app's bugs so far have been backend logic
  issues (schema gaps, dedup scope, retry accounting), not UI issues.
- When changing shared logic that's mirrored in multiple places (currency
  conversion, category lists, duplicate detection), check whether the other
  copies need the same fix — there is no shared module between the Edge
  Functions, so drift is the default failure mode, not the exception.
