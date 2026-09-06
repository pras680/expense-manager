# E2E test suite

Playwright, driven against the real Supabase backend (there is no mock —
see the root `CLAUDE.md` "Auth & registration"). Two specs today:

- `navigation.spec.ts` — sign-in, bottom-tab navigation, settings sub-pages,
  sign-out. Doesn't depend on any particular data being present.
- `receipts-data.spec.ts` — exercises the sample receipts seeded by
  `seed/` (search, category badges, the unreviewed "Check" queue, Reports
  reflecting real data). Read-only: it only asserts against seeded fixtures,
  never edits/deletes/approves, so it's safe to run alongside other specs
  against the same shared test account without one test's mutation breaking
  another's expectations.

## Setup

1. **A dedicated test account.** In Supabase, create (or reuse) a disposable
   household member for testing — never point this at a real user's account,
   and don't reuse an account you also use for manual testing, since the
   seed script periodically wipes and re-creates its fixture receipts on it.
   `manage-household` (Settings → Household → "Add someone" in the app) is
   the easiest way to create one.
2. **Export credentials** before running:
   ```bash
   export TEST_USER_EMAIL=test-agent@example.com
   export TEST_USER_PASSWORD=...
   ```
   These are also read from `webapp/.env.local` if present (anything Vite's
   dev server loads, `dotenv`-loaded manually, or just exported in the
   shell — the seed script and Playwright config only need them as
   `process.env`, not through Vite).
3. **Run from `webapp/`:**
   ```bash
   npm run test:e2e
   ```
   This starts `vite dev` automatically, re-seeds the test account's sample
   receipts (see below), and runs both the desktop-Chromium and
   mobile-viewport-Chromium projects. Set `PLAYWRIGHT_CHROMIUM_PATH` to
   reuse a pre-installed Chromium binary instead of downloading one.

Without `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` set, seeding no-ops and every
spec skips itself (rather than failing) so a fresh clone doesn't error out
of the box.

## Sample data (`seed/`)

`seed/sample-receipts.json` is a fixed set of ~10 receipts spanning the
things the app's functionality actually branches on: multiple categories
(including `Local Transfer`, which Reports deliberately excludes from
spend totals), an unreviewed SMS-sourced receipt and an unreviewed
Gmail-sourced one (both should show the amber "Check" badge and the review
banner), a private receipt, a foreign-currency one, and a couple of
prior-month receipts so month-by-month views have more than one month of
data.

`seed/seed.mjs` signs in as the test user and inserts them through the same
PostgREST endpoint the webapp itself uses (not a service-role bypass —
`receipts_set_owner` stamps ownership exactly as it would for a real manual
entry). Every row's `comment` carries a `[e2e-seed]` marker so it can be
found and removed later without touching any other data that account might
hold.

- `npm run seed:test-data` — insert the fixtures (does not remove anything
  already tagged `[e2e-seed]`, so running it twice duplicates rows).
- `npm run seed:test-data:reset` — delete every `[e2e-seed]`-tagged receipt,
  then re-insert the fixtures. This is what Playwright's `globalSetup` runs
  automatically before every `npm run test:e2e`, so specs always see the
  same known set.
- `node e2e/seed/seed.mjs --clear` — delete the seeded fixtures without
  re-inserting (useful for handing the account back "clean").

## Extending the suite

Add new specs under `webapp/e2e/*.spec.ts` as new functionality lands.
Keep each spec scoped to one flow (navigation, receipt CRUD, reports, etc.)
so a failure in one area doesn't block the others. A spec that *mutates*
data (adding/editing/approving/deleting a receipt) should either target a
row it creates itself within the test, or accept that it may collide with
`receipts-data.spec.ts`'s read-only assertions if run in the same pass —
prefer creating your own throwaway receipt over relying on a seeded one
surviving the test. Add new fixtures to `seed/sample-receipts.json` (each
needs a unique `key`, used both for the `[e2e-seed]` marker and as a stable
handle in assertions) rather than hardcoding one-off data inline in a spec.
