import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { openApp } from './session'

// Screenshot + layout/health review of the main screens, at desktop
// (1440×900, `chromium` project) and iPhone (390×844, `mobile-chromium`).
// Writes PNGs to e2e-artifacts/screenshots/ and per-screen findings to
// e2e-artifacts/visual-findings.json for a human (or Claude) to inspect.
// These screenshots are a review aid, NOT approved regression baselines —
// nothing here compares against stored images.
//
// Hard failures (assertions): page errors, console errors, failed/4xx/5xx
// requests to the app's own origin or Supabase, broken <img>, horizontal
// page overflow. Signed-out screens run with or without a backend;
// signed-in screens need TEST_USER_EMAIL/TEST_USER_PASSWORD for a TEST
// Supabase project (see docker/.env.e2e.example) and self-skip otherwise.

const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD
const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? 'e2e-artifacts'
const SHOTS = join(ARTIFACTS, 'screenshots')
const FINDINGS = join(ARTIFACTS, 'visual-findings.json')
// The Docker env's placeholder backend when no test project is configured.
const NO_BACKEND = (process.env.VITE_SUPABASE_URL ?? '').includes('supabase.invalid')

type Health = { consoleErrors: string[]; pageErrors: string[]; failedRequests: string[] }

function watch(page: Page): Health {
  const h: Health = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  page.on('console', (m) => { if (m.type() === 'error') h.consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => h.pageErrors.push(String(e)))
  page.on('requestfailed', (r) => {
    // A navigation away aborts in-flight requests; that's not a failure.
    if (r.failure()?.errorText.includes('ERR_ABORTED')) return
    h.failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) h.failedRequests.push(`${r.request().method()} ${r.url()} — HTTP ${r.status()}`)
  })
  return h
}

async function useProjectViewport(page: Page, info: TestInfo) {
  if (info.project.name === 'chromium') await page.setViewportSize({ width: 1440, height: 900 })
}

/** Fonts loaded, every <img> settled, animations off. No fixed sleeps. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete))
}

async function layoutChecks(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const overflowX = document.documentElement.scrollWidth - vw
    const offscreen: string[] = []
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        // Ignore content inside an intentional horizontal scroller.
        let p = el.parentElement, scroller = false
        while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scroller = true; break } p = p.parentElement }
        if (!scroller) offscreen.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} [${Math.round(r.left)}–${Math.round(r.right)}]`)
      }
    }
    const brokenImages = Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src)
    return { viewportWidth: vw, overflowX, offscreen: offscreen.slice(0, 10), brokenImages }
  })
}

function record(entry: object) {
  mkdirSync(ARTIFACTS, { recursive: true })
  const all = existsSync(FINDINGS) ? JSON.parse(readFileSync(FINDINGS, 'utf8')) : []
  all.push(entry)
  writeFileSync(FINDINGS, JSON.stringify(all, null, 2))
}

async function review(page: Page, info: TestInfo, name: string, health: Health) {
  await settle(page)
  mkdirSync(SHOTS, { recursive: true })
  const file = join(SHOTS, `${info.project.name}--${name}.png`)
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' })
  const layout = await layoutChecks(page)
  // In no-backend mode the placeholder host is expected to be unreachable.
  const unexpected = health.failedRequests.filter((r) => !(NO_BACKEND && r.includes('supabase.invalid')))
  const consoleErrors = health.consoleErrors.filter((c) => !(NO_BACKEND && /Failed to fetch|ERR_NAME_NOT_RESOLVED|supabase\.invalid/.test(c)))
  record({ screen: name, project: info.project.name, url: page.url(), screenshot: file, ...layout, ...health })
  await info.attach(`${name}.png`, { path: file, contentType: 'image/png' })

  expect.soft(health.pageErrors, 'uncaught page errors').toEqual([])
  expect.soft(consoleErrors, 'console errors').toEqual([])
  expect.soft(unexpected, 'failed or 4xx/5xx requests').toEqual([])
  expect.soft(layout.brokenImages, 'broken images').toEqual([])
  expect.soft(layout.overflowX, 'horizontal page overflow (px)').toBeLessThanOrEqual(0)
}

test.describe('signed-out screens', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('sign-in: renders, blocks empty submit, shows an error for bad credentials', async ({ page }, info) => {
    const health = watch(page)
    await useProjectViewport(page, info)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await review(page, info, 'sign-in', health)

    // Empty submit: the browser's required-field validation stops it.
    await page.getByRole('button', { name: 'Sign In' }).click()
    expect(await page.getByLabel('Email').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
    await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()

    // Bad credentials: one auth request; the form must stay and show an error.
    const authHealth = watch(page)
    await page.getByLabel('Email').fill('nobody@example.invalid')
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign In' }).click()
    const errorBox = page.getByRole('alert')
    await expect(errorBox).toBeVisible({ timeout: 25_000 })
    await expect(errorBox).not.toBeEmpty()
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()
    // The rejected sign-in is an expected 400 from Auth; don't count it.
    authHealth.failedRequests = authHealth.failedRequests.filter((r) => !r.includes('/auth/v1/token'))
    authHealth.consoleErrors = authHealth.consoleErrors.filter((c) => !/status of 400/.test(c))
    await review(page, info, 'sign-in-error', authHealth)
  })

  test('register: reachable from sign-in and back', async ({ page }, info) => {
    const health = watch(page)
    await useProjectViewport(page, info)
    await page.goto('/')
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await review(page, info, 'register', health)
    await page.getByRole('button', { name: 'Already have an account? Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()
  })
})

test.describe('signed-in screens', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — signed-in screens need a test Supabase project')

  const screens: Array<{ name: string; path: string; ready: (p: Page) => ReturnType<Page['getByRole']> }> = [
    { name: 'home', path: '/', ready: (p) => p.getByRole('heading', { name: 'Bill Skills' }) },
    { name: 'receipts', path: '/receipts', ready: (p) => p.getByRole('heading', { name: 'Receipts' }) },
    { name: 'add-receipt', path: '/add', ready: (p) => p.getByRole('heading', { level: 1 }) },
    { name: 'insights', path: '/reports', ready: (p) => p.getByRole('heading', { name: 'Insights' }) },
    { name: 'insights-all-time', path: '/reports?m=all', ready: (p) => p.getByRole('heading', { name: 'Insights' }) },
    { name: 'insights-top-merchants', path: '/reports/category/All?month=all', ready: (p) => p.getByRole('heading', { name: 'All spending' }) },
    { name: 'insights-months', path: '/reports/monthly', ready: (p) => p.getByRole('heading', { name: 'Typical month' }) },
    { name: 'you', path: '/settings', ready: (p) => p.getByRole('heading', { name: 'You' }) },
    { name: 'you-household', path: '/settings/household', ready: (p) => p.getByRole('heading', { name: 'Household', exact: true }) },
    { name: 'you-sms', path: '/settings/sms', ready: (p) => p.getByRole('heading', { name: 'SMS Import' }) },
    { name: 'you-categories', path: '/settings/categories', ready: (p) => p.getByRole('heading', { name: 'Categories' }) },
    { name: 'you-gmail', path: '/settings/gmail', ready: (p) => p.getByRole('heading', { name: 'Gmail import' }) },
  ]

  for (const s of screens) {
    test(`${s.name} (${s.path})`, async ({ page }, info) => {
      const health = watch(page)
      await useProjectViewport(page, info)
      await openApp(page, s.path)
      await expect(s.ready(page)).toBeVisible()
      await review(page, info, s.name, health)
    })
  }
})
