# E2E navigation smoke test

Playwright, driven against the real Supabase backend (there is no mock —
see the root `CLAUDE.md` "Auth & registration"). Covers sign-in and the
core navigation smoke test: bottom-tab navigation, settings sub-pages,
and sign-out.

## Setup

1. In Supabase, create (or reuse) a disposable household member for testing
   — never point this at a real user's account. `manage-household` (Settings
   → Household → "Add someone" in the app) is the easiest way to create one.
2. Export credentials before running:
   ```bash
   export TEST_USER_EMAIL=test-agent@example.com
   export TEST_USER_PASSWORD=...
   ```
3. Run from `webapp/`:
   ```bash
   npm run test:e2e
   ```
   This starts `vite dev` automatically and runs both the desktop-Chromium
   and mobile-viewport-Chromium projects. Set `PLAYWRIGHT_CHROMIUM_PATH` to
   reuse a pre-installed Chromium binary instead of downloading one.

Without `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` set, every spec skips itself
(rather than failing) so a fresh clone doesn't error out of the box.

## Extending the suite

Add new specs under `webapp/e2e/*.spec.ts` as new functionality lands.
Keep each spec scoped to one flow (navigation, receipt CRUD, reports, etc.)
so a failure in one area doesn't block the others. Any test that mutates
data (adding/editing a receipt, changing settings) should assume the test
account's household is *disposable* — don't add assertions that depend on
a specific pre-existing data set.
