import { defineConfig, devices } from '@playwright/test'
// Loads webapp/.env.local and webapp/.env.e2e.local (both gitignored) before
// anything below reads process.env — this must run before spec files are
// discovered, since each spec's test.skip(!EMAIL || !PASSWORD, ...) check
// runs at module-load time, not inside globalSetup's own process timing.
import './e2e/seed/load-env.mjs'
import { startTlsRelay } from './e2e/proxy/tls-relay.mjs'

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
const relay = process.env.HTTPS_PROXY ? await startTlsRelay() : null
const chromiumUse = relay
  ? {
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${relay.port}`, bypass: 'localhost,127.0.0.1' }
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
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumUse,
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
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumUse,
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
