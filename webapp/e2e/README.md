# E2E test suite

Playwright, driven against the real Supabase backend (there is no mock —
see the root `CLAUDE.md` "Auth & registration"). The specs:

- `navigation.spec.ts` — the five tabs, the You page's rows and theme picker,
  the receipt edit flow's back stack, sign-in and sign-out.
- `landing-page.spec.ts` — Home: the hero, the Ask bar, the stat tiles, and
  where each of them leads.
- `receipts-data.spec.ts` — exercises the sample receipts seeded by `seed/`
  (search, what each row shows, the "To review" filter, Insights reflecting
  real data). Read-only: it only asserts against seeded fixtures, never
  edits/deletes/approves, so it's safe to run alongside other specs against
  the same shared test account.
- `drill-down.spec.ts` — Insights: total -> category -> merchant -> receipt,
  and the breadcrumb trail back up. Read-only.
- `talk-to-me.spec.ts` — the spending chat, with the edge function stubbed.
- `visual-review.spec.ts` — screenshots and layout checks of every screen.

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

## Signing in once

Specs don't sign in themselves. The `setup` project (`auth.setup.ts`) signs
in once through the real form and saves the session to `e2e/.auth/user.json`
(gitignored, since it holds a live refresh token), and both browser projects
start from it via `storageState`; `openApp()` in `session.ts` just opens a
page. Signing in per test meant ~60 password grants a run, and Supabase Auth
refused them partway through with "Request rate limit reached" even with the
dashboard's sign-in limit raised. A run now makes 4: seed, setup, and the
sign-out test on each viewport.

The sign-out test starts from an empty session and signs in through the form
itself, because the app's sign-out calls `/auth/v1/logout`, which revokes
every refresh token on the account. Tests still running on the shared
session keep working on their unexpired access token. A new test that signs
out must do the same.

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

## Docker test environment

A local, disposable environment for running this suite in containers
(`docker/compose.e2e.yaml`, Compose project `billskills-e2e`). It is for
testing only: Vercel stays the deployment platform, and nothing here changes
its configuration.

- `deps`: one-shot Linux `npm ci` into a named volume (your Mac's
  `node_modules` is never touched); reruns only when `package-lock.json`
  changes.
- `app`: Vite dev server, `http://127.0.0.1:5180` on the host,
  `http://app:5173` on the Compose network.
- `app-prod` (profile `prod`): `tsc -b` + `vite build` + `vite preview`;
  build output stays inside the container, so `webapp/dist` is left alone.
- `e2e` (profile `test`): `mcr.microsoft.com/playwright:v1.63.0-noble`,
  matching `@playwright/test` 1.63.0 in the lockfile. Keep these in step.

**Backend.** The intended test backend is a local Supabase on your Mac with
the live structure and no live data: see `supabase-edge/local-test/README.md`.
Containers never see `webapp/.env.local` (the live project):
it is masked by an empty file. They read `webapp/.env.e2e.local` instead
(copy `docker/.env.e2e.example`), which must point at a *separate* Supabase
test project; `docker/e2e.sh` refuses to run if it names the same host as
`.env.local`. Without `.env.e2e.local`, the app points at an unroutable
placeholder: signed-out screens are tested, signed-in specs self-skip.

```bash
webapp/docker/e2e.sh up          # start the dev server
webapp/docker/e2e.sh test        # full suite (desktop + mobile)
webapp/docker/e2e.sh shots       # screenshots + layout checks only (visual-review.spec.ts)
webapp/docker/e2e.sh prod        # build + preview the production bundle, run the suite on it
webapp/docker/e2e.sh report      # HTML report at http://127.0.0.1:9323
webapp/docker/e2e.sh logs app    # follow logs (app | app-prod | deps)
webapp/docker/e2e.sh down        # stop; keeps the node_modules volume
webapp/docker/e2e.sh clean       # remove only this environment's containers + volumes
webapp/docker/e2e.sh agent       # open Claude Code in its locked-down container (below)
webapp/docker/e2e.sh doctor      # verify that container's boundaries (PASS/FAIL)
```

Extra arguments go to `playwright test`, e.g.
`webapp/docker/e2e.sh test navigation --project=mobile-chromium`.

Artifacts land in `webapp/e2e-artifacts/` (gitignored): `report/`,
`results/` (traces, failure screenshots), `screenshots/`
(`<project>--<screen>.png`, desktop 1440×900 and mobile 390×844) and
`visual-findings.json` (overflow, off-screen elements, broken images,
console/network errors per screen). The screenshots are for review, not
approved baselines.

**Not covered locally** (needs a Vercel preview): Vercel's SPA routing and
rewrites, headers and caching, the real HTTPS origin (service worker/PWA
install, OAuth redirect URIs such as the Gmail callback), and environment
variables as configured in Vercel.

### Claude Code in a container (`e2e.sh agent`)

An optional `claude` service (profile `agent`) runs Claude Code next to the
app so it can edit code, run the suite, open screenshots and rerun, without
access to the rest of your Mac or to Docker itself.

- **Image:** `docker/claude/Dockerfile`, the Playwright 1.63.0 image plus
  Claude Code (npm), git, ripgrep, curl. Runs as non-root `pwuser`. No Docker
  CLI, no socket, not privileged, no extra capabilities.
- **Mounts:** the repo at `/workspace` (read/write) and the shared
  `node_modules` volume. Masked with empty files: `webapp/.env.local` (live
  Supabase), `notebooks/.env` (live `DATABASE_URL`, TypeSafe key) and
  `.claude/settings.local.json` (your Mac sessions' broad pre-approvals).
  Claude's login lives in the `claude-home` volume; your `~/.claude`, `~/.ssh`,
  keychain and home folder are never mounted.
- **Network:** the container is only on the `agent` network
  (`internal: true`, no route out). It reaches the app at `http://app:5173`
  directly, and everything else through `proxy` (`docker/proxy/`, squid),
  which allows only `api.anthropic.com`, `claude.ai`, `claude.com`,
  `platform.claude.com`, `registry.npmjs.org`, Google Fonts and the test
  Supabase host from `.env.e2e.local`. The live project and every other host
  are refused. A local test Supabase (`http://host.docker.internal:54321`)
  gets an exact host+port rule instead, so your Mac's other ports stay
  unreachable. Denials show in `webapp/docker/e2e.sh logs proxy`.
- **Permissions:** `docker/claude/managed-settings.json` (copied into the
  image, highest precedence): file edits and `npx playwright test`,
  `npm run build|lint`, `npx tsc`, `git status|diff|log|add|commit` run
  without asking; `git push`, `git remote`, `git config` and edits to
  `webapp/docker/**` and `.claude/**` are denied; bypass-permissions mode is
  disabled; everything else asks. Nonessential traffic, the auto-updater and
  claude.ai MCP connectors are off.
- **Not available inside, by design:** starting or stopping containers,
  `docker logs` (app output is also written to `e2e-artifacts/logs/`),
  pushing, Supabase deploys or migrations, the live database.

First run: `e2e.sh agent` builds the two images, starts `app` and `proxy`,
and opens Claude Code. Sign in with the URL it prints (open it in your Mac's
browser, paste the code back); the login is kept in `claude-home` until
`e2e.sh clean`. Run `e2e.sh doctor` any time to check the boundaries.

Changes to `webapp/docker/**` only take effect after you rebuild/restart, and
Claude cannot edit them from inside, so review any diff there yourself.
