import { test, expect } from '@playwright/test'
import { openApp } from './session'

// Exercises the sample receipts seeded by e2e/seed/ (via playwright.config.ts's
// globalSetup) — real functionality, not just "does the page load": search,
// what each row shows, the unreviewed/"Check" queue, and Insights actually
// reflecting seeded data. Read-only assertions only (no approve/delete/edit)
// so this can run alongside navigation.spec.ts against the same shared
// fixture set without one test's mutation breaking another's expectations.
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

test.beforeEach(async ({ page }) => {
  // Straight to the Receipts tab: these specs are about the list itself, not
  // about how it's reached from Home.
  await openApp(page, '/receipts')
})

// Each row is a link: the merchant sits two levels inside it, so stepping up
// twice from the merchant text gives the whole row (category, card, source
// and tags included).
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

test('the "To review" filter counts at least the seeded unreviewed receipts, and narrows the list to them', async ({ page }) => {
  // Two seeded fixtures (Shell/sms, Courts/gmail) are unreviewed. The
  // account may carry more from real use, so assert "at least", not "exactly".
  const chip = page.getByRole('button', { name: /To review · \d+/ })
  await expect(chip).toBeVisible()
  const count = Number((await chip.textContent())?.match(/(\d+)/)?.[1] ?? '0')
  expect(count).toBeGreaterThanOrEqual(2)

  await chip.click()
  await expect(page.getByText(/receipts? imported automatically/)).toBeVisible()
  await expect(page.getByText('Shell', { exact: true })).toBeVisible()
  // A reviewed receipt drops out of the filtered list.
  await expect(page.getByText('FairPrice Finest')).toHaveCount(0)
})

test('receipts are grouped under day headings', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
})

test('Insights reflects seeded categories', async ({ page }) => {
  await page.getByRole('link', { name: 'Insights', exact: true }).click()
  await expect(page).toHaveURL('/reports')
  // All time rather than this month: which fixtures fall in the current
  // calendar month shifts with the date this runs.
  await page.getByRole('button', { name: 'All time' }).click()
  await expect(page.getByRole('link', { name: /Groceries/ }).first()).toBeVisible()
})
