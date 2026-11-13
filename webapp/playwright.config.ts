import { defineConfig, devices } from '@playwright/test'
// Loads webapp/.env.local and webapp/.env.e2e.local (both gitignored) before
// anything below reads process.env — this must run before spec files are
// discovered, since each spec's test.skip(!EMAIL || !PASSWORD, ...) check
// runs at module-load time, not inside globalSetup's own process timing.
import './e2e/seed/load-env.mjs'
import { startTlsRelay } from './e2e/proxy/tls-relay.mjs'
import { AUTH_STATE_PATH } from './e2e/session'

// TEST_USER_EMAIL/TEST_USER_PASSWORD must be a real signed-up account in the
// Supabase project the webapp points at (see src/lib/supabaseClient.ts) —
// there is no mock backend. Specs skip themselves with a clear message when
// these aren't set, rather than failing on every fresh clone.

// In sandboxed Claude Code environments, outbound HTTPS only works through
// an HTTP forward proxy (HTTPS_PROXY) — and Chromium's own CONNECT-tunnel
// client fails partway through the TLS handshake against it (every external
// host tested fails the same way, not just Supabase; curl/Node's https
// client reach the identical hosts through the identical proxy without
// issue — see e2e/proxy/tls-relay.mjs for the full story). The relay sits
// between Chromium and that proxy: Chromium only ever speaks TLS to
// 127.0.0.1 (self-signed, hence ignoreHTTPSErrors below), and the relay
// re-issues each request upstream using the client/agent combo that's
// confirmed to work. A plain dev machine or CI runner has real outbound
// access and doesn't set HTTPS_PROXY, so this stays off there.
// E2E_PROXY_DIRECT=1 (set only in docker/compose.e2e.yaml's claude service):
// that container's proxy is a plain squid, which Chromium speaks to fine, and
// the relay can't carry plain-HTTP requests such as a local Supabase at
// http://host.docker.internal:54321. So there Chromium uses the proxy directly.
const directProxy = process.env.E2E_PROXY_DIRECT === '1' ? process.env.HTTPS_PROXY : undefined
const relay = process.env.HTTPS_PROXY && !directProxy ? await startTlsRelay() : null
// The app under test is never proxied: localhost on a dev machine, or the
// Compose service host (e.g. http://app:5173) in docker/compose.e2e.yaml.
const proxyBypass = ['localhost', '127.0.0.1', process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).hostname : '']
  .filter(Boolean).join(',')
const chromiumUse = directProxy
  ? { proxy: { server: directProxy, bypass: proxyBypass } }
  : relay
  ? {
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${relay.port}`, bypass: proxyBypass }
    }
  : {}

export default defineConfig({
  testDir: './e2e',
  // Re-seeds the test account's sample receipts before every run — see
  // e2e/seed/global-setup.mjs. No-ops (doesn't fail) when TEST_USER_EMAIL/
  // TEST_USER_PASSWORD aren't set, same as the specs' own self-skip.
  globalSetup: './e2e/seed/global-setup.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  // html: browsable report of the last run (npx playwright show-report),
  // with traces and screenshots for failures. playwright-report/ is gitignored.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      // Signs in once; the projects below start from the saved session.
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumUse,
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined
      }
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumUse,
        storageState: AUTH_STATE_PATH,
        // Pre-installed Chromium in this environment; falls back to
        // Playwright's own managed browser wherever that env var isn't set.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined
      }
    },
    {
      // A Chromium-driven iPhone-shaped viewport rather than the
      // devices['iPhone ...'] preset — that preset defaults to WebKit, which
      // isn't installed in this environment (only Chromium is).
      name: 'mobile-chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumUse,
        storageState: AUTH_STATE_PATH,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined
      }
    }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
      }
})
