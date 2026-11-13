import { test, expect } from '@playwright/test'
import { openApp } from './session'

// Home ("/"): the month's total and pace, the Ask bar, two stat tiles, the
// top categories and the latest receipts. Every figure on it is a link to the
// detail behind it, which is what most of these tests follow.
//
// Deliberately avoids asserting exact dollar figures or which categories rank
// top — those depend on which seeded fixtures (webapp/e2e/seed/) fall in the
// current calendar month relative to whenever this runs, which shifts over
// time. Assertions check structure and where each link leads instead.
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('the wordmark is the page heading', async ({ page }) => {
  // Rendered as "bill" + "Skills" in two spans; the accessible name is the
  // real two-word name.
  await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()
})

test('the hero shows the current month and a total, and opens Insights', async ({ page }) => {
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' })
  const hero = page.getByRole('link', { name: new RegExp(`${monthLabel} so far`) })
  await expect(hero).toBeVisible()
  await expect(hero).toContainText(/[\d][\d,.]*/)
  await hero.click()
  await expect(page).toHaveURL('/reports')
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible()
})

test('the pace assessment sentence is present', async ({ page }) => {
  // computeSpendingInsight always returns a non-empty assessment once there's
  // any history at all, and the seed fixtures include prior-month receipts
  // (webapp/e2e/seed/sample-receipts.json) so there always is some.
  const assessment = page.locator('p', { hasText: /pace|month|spending/i })
  await expect(assessment.first()).toBeVisible()
})

test('the Ask bar is on screen without scrolling', async ({ page }) => {
  // The chat's entry point is meant to be the loudest thing on Home, not
  // something to scroll for.
  await expect(page.getByRole('button', { name: /Talk to me/ })).toBeInViewport()
})

test('the two stat tiles sit side by side', async ({ page }) => {
  const review = page.getByRole('link', { name: /To review/ })
  const typical = page.getByRole('link', { name: /Typical month/ })
  await expect(review).toBeVisible()
  await expect(typical).toBeVisible()
  const [a, b] = [await review.boundingBox(), await typical.boundingBox()]
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeLessThan(2)
  await expect(review).toContainText(/\d/)
})

test('"To review" opens the receipts list already filtered', async ({ page }) => {
  // Two seeded fixtures (Shell/sms, Courts/gmail) are unreviewed, so the list
  // it opens is never empty against the seeded test account.
  await page.getByRole('link', { name: /To review/ }).click()
  await expect(page).toHaveURL(/\/receipts\?filter=pending/)
  await expect(page.getByRole('button', { name: /To review · \d+/ })).toHaveAttribute('aria-pressed', 'true')
})

test('"Typical month" opens the list of months the average is drawn from', async ({ page }) => {
  await page.getByRole('link', { name: /Typical month/ }).click()
  await expect(page).toHaveURL('/reports/monthly')
  await expect(page.getByRole('heading', { name: 'Typical month' })).toBeVisible()
})

test('"Where it went", when shown, lists categories with percentages that never exceed 100', async ({ page }) => {
  const heading = page.getByRole('heading', { name: 'Where it went' })
  // Only renders when there is this-month expense data — conditional on which
  // fixtures land in the current month, so skip rather than assert a state.
  if ((await heading.count()) === 0) {
    test.skip(true, 'No this-month expense spend in the seeded data at the time this ran')
    return
  }
  const percentTexts = await page.locator('span', { hasText: /^\d{1,3}%$/ }).allTextContents()
  expect(percentTexts.length).toBeGreaterThan(0)
  const sum = percentTexts.reduce((total, t) => total + Number(t.replace('%', '')), 0)
  // Only the top few categories are listed, so the sum can fall short of 100
  // but can never pass it.
  expect(sum).toBeGreaterThan(0)
  expect(sum).toBeLessThanOrEqual(100)
})

test('"All receipts" opens the full list', async ({ page }) => {
  await page.getByRole('link', { name: 'All receipts' }).click()
  await expect(page).toHaveURL('/receipts')
  await expect(page.getByPlaceholder('Search merchant, item, amount, card…')).toBeVisible()
})
