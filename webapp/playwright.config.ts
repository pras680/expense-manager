import { defineConfig, devices } from '@playwright/test'

// TEST_USER_EMAIL/TEST_USER_PASSWORD must be a real signed-up account in the
// Supabase project the webapp points at (see src/lib/supabaseClient.ts) —
// there is no mock backend. Specs skip themselves with a clear message when
// these aren't set, rather than failing on every fresh clone.
export default defineConfig({
  testDir: './e2e',
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
