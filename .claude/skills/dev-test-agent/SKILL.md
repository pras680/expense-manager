---
name: dev-test-agent
description: >
  Implement a requested change to the webapp, then verify it by running the
  webapp for real in Chrome and driving it with Playwright — bottom-tab
  navigation, settings sub-pages, and (if the change touches them) whatever
  other flows apply. Use when the user describes a feature/bug-fix and wants
  it built AND smoke-tested end-to-end, not just code-reviewed. Invokable
  from any Claude Code surface on this repo (CLI, web, or the mobile app) —
  they all share this skill and the same e2e suite.
---

# Dev + test agent

This skill turns a plain-English change request into: an implementation,
a running instance of the webapp, a real Chrome browser driving it, and a
pass/fail report — so "make the change" and "prove it works" happen in one
pass instead of requiring a human to separately click through the app
afterward.

It works identically whether invoked from a terminal, the Claude Code web
UI, or the Claude Code mobile app — nothing here is desktop-specific. The
one thing that does NOT travel with you is a running `vite dev` server or
an open Chrome window from a previous session; each run starts its own.

## Inputs

- The user's change request (free text — a bug description, a feature ask,
  or "just run the smoke tests" with no code change at all).
- Optionally, which test scope to run: `smoke` (default — core navigation +
  auth, see below), a named spec file, or `all` (every `webapp/e2e/*.spec.ts`).

## Procedure

1. **Understand the request.** Read the relevant pages/hooks/lib files under
   `webapp/src/` before editing — this repo's `CLAUDE.md` documents the
   architecture (ingestion pipelines, RLS shape, duplicate/merge rules,
   category system) and most bugs here are backend/logic issues, not markup.
   Don't touch `ExpenseManager/` or `ios-app/` unless explicitly asked.

2. **Implement the change** using normal editing tools. Keep the diff scoped
   to what was asked — this skill's job is to also *verify*, not to expand
   the request into a refactor.

3. **Make sure a test account exists.** The e2e suite authenticates against
   the real Supabase backend (there is no mock — see `CLAUDE.md` "Auth &
   registration"). It needs `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` in the
   environment, pointing at a disposable household member:
   - If both are already set, use them.
   - If not, tell the user you need a disposable test account's credentials
     (or offer to create one via Settings → Household → "Add someone" if
     you're already signed in as an existing member during this session) —
     never reuse a real household member's real password for automation.

4. **Install Playwright's browser binary once, if missing.** This
   environment pre-installs Chromium at `/opt/pw-browsers/chromium` for
   Claude Code sessions in general — check `PLAYWRIGHT_BROWSERS_PATH` /
   `/opt/pw-browsers` before running `npx playwright install`, which would
   otherwise re-download a browser unnecessarily. Set
   `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` when that binary is
   present (see `webapp/playwright.config.ts`).

5. **Run the suite** from `webapp/`:
   ```bash
   cd webapp
   npm install   # first run only, or after package.json changes
   TEST_USER_EMAIL=... TEST_USER_PASSWORD=... \
     PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
     npm run test:e2e
   ```
   This starts `vite dev` on `localhost:5173` automatically
   (`playwright.config.ts`'s `webServer` block) and runs the suite against
   both a desktop-Chromium project and a mobile-viewport-Chromium project —
   don't start `vite dev` by hand first, Playwright manages its lifecycle
   and will reuse one that's already running locally.

   To run just the navigation smoke test:
   ```bash
   npm run test:e2e -- e2e/navigation.spec.ts
   ```

6. **On failure**, open the HTML report (`npx playwright show-report`) or
   read the trace/screenshot Playwright attaches on failure
   (`test-results/`) before guessing — then fix the root cause (usually in
   `webapp/src/`, per this repo's own convention of backend/logic bugs over
   UI bugs) and re-run. Don't mark the task done on a red suite.

7. **Report back**: what changed, which spec(s) ran, pass/fail per test, and
   for any failure, the concrete cause found from the trace/screenshot — not
   just "a test failed."

## The default "smoke" scope

`webapp/e2e/navigation.spec.ts` — sign in, then for each bottom tab
(Receipts, Add, Reports, Settings) confirm the route changes and the page
renders, plus the Settings sub-links (SMS, Categories, Gmail) and sign-out.
This is deliberately cheap to run on every change; see
`webapp/e2e/README.md` for how to extend the suite with deeper flows
(receipt CRUD, duplicate-merge, reports totals) as those need covering —
add new files there rather than growing `navigation.spec.ts` into a catch-all.

## Boundaries

- Never hardcode or print real user credentials, the Supabase service-role
  key, or any LLM provider key (same rule as the rest of this repo's
  `CLAUDE.md`) — test credentials come from environment variables only.
- Don't touch the iOS app.
- Don't widen a bug-fix request into an unrelated refactor just because
  you're already in the file.
