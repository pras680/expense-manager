import { test, expect } from '@playwright/test'
import { openApp } from './session'

// Insights drill-down: month -> category -> merchant -> single receipt, with a
// breadcrumb trail that grows a chip per level and can jump back to any of
// them. Read-only, against the seeded fixtures (see e2e/seed/).
//
// Uses the all-time view so the path exists whatever month this runs in: the
// seeded "FairPrice Finest" Groceries receipt is always somewhere in it.
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

test('a total drills down to a single receipt, and the trail leads back up', async ({ page }) => {
  await openApp(page, '/reports')
  await page.getByRole('button', { name: 'All time' }).click()
  await expect(page).toHaveURL('/reports?m=all')

  await page.getByRole('link', { name: /Groceries/ }).first().click()
  await expect(page).toHaveURL(/\/reports\/category\/Groceries\?month=all/)
  await expect(page.getByRole('heading', { name: 'Groceries' })).toBeVisible()

  await page.getByRole('link', { name: /FairPrice Finest/ }).click()
  await expect(page).toHaveURL(/\/reports\/merchant\/FairPrice%20Finest/)
  await expect(page.getByRole('heading', { name: 'FairPrice Finest' })).toBeVisible()

  await page.locator('a[href^="/receipts/"]').first().click()
  await expect(page).toHaveURL(/\/receipts\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'FairPrice Finest' })).toBeVisible()

  // One chip per level above this receipt, in the order they were visited.
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button')
  await expect(trail).toHaveText(['All time', 'Groceries', 'FairPrice Finest'])

  // A chip pops back to that level rather than pushing a new entry, so the
  // browser's own back button still leaves the drill-down in one step.
  await trail.nth(1).click()
  await expect(page).toHaveURL(/\/reports\/category\/Groceries\?month=all/)
  await page.goBack()
  await expect(page).toHaveURL('/reports?m=all')
})

test('a category page can list every receipt instead of merchants', async ({ page }) => {
  await openApp(page, '/reports/category/Groceries?month=all')
  await page.getByRole('button', { name: 'Every receipt' }).click()
  await expect(page.locator('a[href^="/receipts/"]').first()).toBeVisible()
})

test('transfers are listed apart from spending', async ({ page }) => {
  // The seeded "PayNow Transfer" is a Local Transfer: kept as a record, shown
  // under its own heading, and never part of the totals above it.
  await openApp(page, '/reports?m=all')
  await expect(page.getByText(/Moved, not spent/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Local Transfer/ })).toBeVisible()
})
