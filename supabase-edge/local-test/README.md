# Local Supabase test backend

A disposable Supabase on your Mac (`supabase start`) for the Docker test
environment (`webapp/docker/`, see `webapp/e2e/README.md`). It has the live
project's **structure** and none of its data: no receipts, users, cron jobs,
Vault secrets or Gmail tokens. Nothing here writes to the live project; the
only live access is the read-only structure dump in step 2.

Why a dump and not the numbered migrations: no migration creates `receipts`
(it predates them) and the storage bucket was made by hand, so replaying
`multiuser-01…22` on an empty database fails.

## One-time setup (on your Mac, from the repo root)

1. **Start local Supabase, bound to your Mac only.** Docker Desktop must be
   running. By default the CLI publishes every service on all network
   interfaces (Studio and the DB admin API have no login, the DB uses a
   well-known password), so give it a network whose ports bind to 127.0.0.1,
   as Supabase's docs recommend:
   ```bash
   docker network create -o 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1' billskills-supabase   # once
   supabase start --network-id billskills-supabase                                                         # every time
   supabase status        # note "API URL" and "anon key"
   lsof -nP -iTCP -sTCP:LISTEN | grep -E ':5432[1-4]'   # every line must show 127.0.0.1, not *
   ```
   **If `lsof` still shows `*:`** (CLI v2.108 asks Docker for all addresses
   explicitly, so neither the network option nor Docker's `"ip"` setting
   applies), block those ports from your network with the Mac's firewall:
   ```bash
   supabase-edge/local-test/lan-block.sh on      # sudo; again after each reboot
   ```
   `lsof` will keep showing `*:` (the socket is unchanged); the check is that
   another device on your Wi-Fi can't open `http://<your-mac-ip>:54323`.
   `supabase/config.toml` turns analytics off (its log collector mounts the
   Docker socket) and public signup off (as on live).

2. **Dump the live structure** (read-only, no rows; uses `DATABASE_URL` from
   `notebooks/.env` without printing it):
   ```bash
   supabase-edge/local-test/dump-schema.sh
   ```
   Runs `pg_dump` inside the local DB container (so local Supabase must be
   running), public schema only. Output:
   `supabase-edge/local-test/.schema/live-schema.sql` (gitignored).

3. **Load it locally** (talks only to the local DB container):
   ```bash
   supabase-edge/local-test/load-local.sh
   ```
   Loads the dump in one transaction, creates the private `receipt-documents`
   bucket, applies `multiuser-05-storage.sql`, then prints a checklist.
   Every line should say PASS.

4. **Serve the edge functions** with a test-only invite code:
   ```bash
   cp supabase/functions/.env.local-test.example supabase/functions/.env.local-test
   # edit: set SIGNUP_INVITE_CODE to anything
   supabase functions serve --env-file supabase/functions/.env.local-test
   ```
   Leave it running. No LLM or Gmail keys are set, so the parser and Gmail
   functions fail closed: nothing local calls Groq or Google.

5. **Point the Docker tests at it and create the test account:**
   ```bash
   cp webapp/docker/.env.e2e.example webapp/.env.e2e.local
   # edit: VITE_SUPABASE_ANON_KEY = the local anon key from `supabase status`
   webapp/docker/e2e.sh up
   ```
   Open http://127.0.0.1:5180 → "New here? Create an account" → register with
   the invite code. Put that email/password in `webapp/.env.e2e.local` as
   `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`.

6. **Run:** `webapp/docker/e2e.sh doctor`, then `test`, `shots`, `prod`, `agent`.

## Day to day

- After a reboot: `lan-block.sh on` before `supabase start`.
- `supabase start --network-id billskills-supabase` / `supabase stop` (keeps
  data) around a session. Never a bare `supabase start`: that binds to all
  interfaces again; keep
  `supabase functions serve …` running while testing.
- Each test run re-seeds the `[e2e-seed]` receipts itself.
- **Rebuild from scratch:** `supabase-edge/local-test/load-local.sh --reset`
  (wipes the LOCAL database, reloads the dump). Re-register the test account.
- **Live schema changed?** Re-run `dump-schema.sh`, then `load-local.sh --reset`.

## If something goes wrong

- **Load fails on a role or extension** (e.g. a GRANT to a role that only
  exists on live): the load is one transaction, so nothing was half-applied.
  Note the error line and fix forward (create the role locally or edit the
  dump), then rerun.
- **Your Mac's browser can't reach `host.docker.internal`:** Docker Desktop
  normally adds it to `/etc/hosts`. If not, enable that in Docker Desktop
  settings; containers resolve it regardless.
- **Not covered locally:** real parsing (Groq), Gmail/SMS imports, cron jobs,
  emails, Vercel-specific behaviour.
