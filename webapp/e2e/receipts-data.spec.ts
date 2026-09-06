import { test, expect, type Page } from '@playwright/test'

// Exercises the sample receipts seeded by e2e/seed/ (via playwright.config.ts's
// globalSetup) — real functionality, not just "does the page load": search,
// category badges, the unreviewed/"Check" queue, and Reports actually
// reflecting seeded data. Read-only assertions only (no approve/delete/edit)
// so this can run alongside navigation.spec.ts against the same shared
// fixture set without one test's mutation breaking another's expectations.
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email').fill(EMAIL!)
  await page.getByLabel('Password').fill(PASSWORD!)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page.getByRole('link', { name: /Home/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  // The full searchable/filterable receipts list lives at /receipts now —
  // the Home tab ("/") is the LandingPage poster summary instead, which
  // doesn't have a search box. Go straight there rather than through the
  // "View all receipts" CTA, since these specs don't care about that flow.
  await signIn(page)
  await page.goto('/receipts')
})

test('a reviewed manual receipt shows its merchant, category and card', async ({ page }) => {
  await page.getByPlaceholder('Search merchant, item, amount, card…').fill('FairPrice Finest')
  const card = page.getByText('FairPrice Finest').locator('..').locator('..')
  await expect(card).toContainText('Groceries')
  await expect(card).toContainText('1234')
  // Reviewed at seed time, so it should not carry the unreviewed "Check" tag.
  await expect(card).not.toContainText('Check')
})

test('an unreviewed SMS-sourced receipt is flagged for review', async ({ page }) => {
  await page.getByPlaceholder('Search merchant, item, amount, card…').fill('Shell')
  const card = page.getByText('Shell', { exact: true }).locator('..').locator('..')
  await expect(card).toContainText('Check')
  await expect(card).toContainText('SMS')
})

test('an unreviewed Gmail-sourced receipt is flagged for review', async ({ page }) => {
  await page.getByPlaceholder('Search merchant, item, amount, card…').fill('Courts')
  const card = page.getByText('Courts', { exact: true }).locator('..').locator('..')
  await expect(card).toContainText('Check')
  await expect(card).toContainText('Email')
})

test('a private receipt is tagged Private', async ({ page }) => {
  await page.getByPlaceholder('Search merchant, item, amount, card…').fill('Netflix')
  const card = page.getByText('Netflix', { exact: true }).locator('..').locator('..')
  await expect(card).toContainText('Private')
})

test('a Local Transfer receipt appears with its category', async ({ page }) => {
  await page.getByPlaceholder('Search merchant, item, amount, card…').fill('PayNow Transfer')
  const card = page.getByText('PayNow Transfer').locator('..').locator('..')
  await expect(card).toContainText('Local Transfer')
})

test('the unreviewed-imports banner counts at least the seeded unreviewed receipts', async ({ page }) => {
  // Two seeded fixtures (Shell/sms, Courts/gmail) are unreviewed. The
  // account may carry more from real use, so assert "at least", not "exactly".
  const banner = page.getByText(/new receipts? imported automatically/)
  await expect(banner).toBeVisible()
  const text = await banner.textContent()
  const count = Number(text?.match(/(\d+)/)?.[1] ?? '0')
  expect(count).toBeGreaterThanOrEqual(2)
})

test('Reports overview reflects seeded categories for this month', async ({ page }) => {
  await page.getByRole('link', { name: /Reports/ }).click()
  await expect(page).toHaveURL('/reports')
  await expect(page.getByText('No spending this month.')).toHaveCount(0)
  await expect(page.getByText('Groceries')).toBeVisible()
})
