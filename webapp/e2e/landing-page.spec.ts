import { test, expect, type Page } from '@playwright/test'

// Verifies the LandingPage ("/") implementation against the Claude Design
// handoff (expense-landing-redesign-options/project/Expense Landing.dc.html,
// option 2a): poster hero with month total, the "N to review" link, the
// "Where it went" top-category breakdown, the monthly-average/receipts-
// logged/months-tracked stat block, and the "View all receipts" CTA.
//
// Deliberately avoids asserting exact dollar figures or which categories
// rank top-4 — those depend on which seeded fixtures (webapp/e2e/seed/)
// fall in the current calendar month relative to whenever this runs, which
// shifts over time. Assertions instead check structure and internal
// consistency (e.g. percentages sum near 100), which holds regardless.
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
  await signIn(page)
})

test('poster hero shows the current month label and a dollar total', async ({ page }) => {
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' })
  await expect(page.getByText(`${monthLabel} so far`)).toBeVisible()
  // formatMoney renders like "$2,140" (currency-dependent symbol, but always
  // has digits) — checked against the hero specifically, not just anywhere
  // on the page, since totals also appear in the stats block below.
  const hero = page.getByText(`${monthLabel} so far`).locator('..').locator('..')
  await expect(hero).toContainText(/[\d][\d,.]*/)
})

test('the pace assessment sentence is present', async ({ page }) => {
  // computeSpendingInsight always returns a non-empty assessment once there's
  // any history at all, and the seed fixtures include prior-month receipts
  // (webapp/e2e/seed/sample-receipts.json) so there always is some.
  const assessment = page.locator('p', { hasText: /pace|month|spending/i })
  await expect(assessment.first()).toBeVisible()
})

test('stat block shows Monthly average, Receipts logged, and Months tracked as a single row', async ({ page }) => {
  const labels = ['Monthly average', 'Receipts logged', 'Months tracked']
  const boxes = []
  for (const label of labels) {
    const locator = page.getByText(label, { exact: true })
    await expect(locator).toBeVisible()
    boxes.push(await locator.boundingBox())
  }
  // Three columns, not three stacked rows — same Y position for all three.
  const [first, ...rest] = boxes
  for (const box of rest) {
    expect(Math.abs((box?.y ?? 0) - (first?.y ?? 0))).toBeLessThan(2)
  }
  // Prior-month fixtures guarantee at least one completed month of history.
  const receiptsLogged = page.getByText('Receipts logged', { exact: true }).locator('..')
  await expect(receiptsLogged).toContainText(/\d/)
})

test('"Where it went" category breakdown, when shown, lists categories with amounts and percentages summing near 100', async ({ page }) => {
  const heading = page.getByText('Where it went', { exact: true })
  // Only renders when computeTopCategories has this-month expense data —
  // conditional on which fixtures land in the current month, so this test
  // skips itself rather than asserting a specific state when absent.
  if ((await heading.count()) === 0) {
    test.skip(true, 'No this-month expense spend in the seeded data at the time this ran')
    return
  }
  await expect(heading).toBeVisible()
  const percentTexts = await page.locator('span', { hasText: /^\d{1,3}%$/ }).allTextContents()
  expect(percentTexts.length).toBeGreaterThan(0)
  const sum = percentTexts.reduce((total, t) => total + Number(t.replace('%', '')), 0)
  // Rounded per-category, so not exactly 100, but should be close for <=4 rows.
  expect(sum).toBeGreaterThan(80)
  expect(sum).toBeLessThanOrEqual(100)
})

test('"View all receipts" CTA is visible without scrolling, and navigates to the full receipts list', async ({ page }) => {
  const cta = page.getByRole('link', { name: 'View all receipts' })
  // The whole point of moving the CTA above "Where it went" and shrinking
  // the hero/stat block was so this is reachable with zero scrolling on a
  // phone-height viewport — assert that directly, not just that it exists.
  await expect(cta).toBeInViewport()
  await cta.click()
  await expect(page).toHaveURL('/receipts')
  await expect(page.getByPlaceholder('Search merchant, item, amount, card…')).toBeVisible()
})

test('the "N to review" link goes to the receipts list filtered for review', async ({ page }) => {
  const reviewLink = page.getByRole('link', { name: /to review/ })
  // Two seeded fixtures (Shell/sms, Courts/gmail) are unreviewed, so this
  // should always be present against the seeded test account.
  await expect(reviewLink).toBeVisible()
  await reviewLink.click()
  await expect(page).toHaveURL(/\/receipts\?review=1/)
})
