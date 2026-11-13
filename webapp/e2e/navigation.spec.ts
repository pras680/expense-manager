import { test, expect, type Page } from '@playwright/test'
import { openApp } from './session'

// Requires a real Supabase account (no mock backend — see CLAUDE.md "Auth &
// registration"). Point these at a disposable test household member, never a
// real user's credentials.
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

async function signInThroughForm(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email').fill(EMAIL!)
  await page.getByLabel('Password').fill(PASSWORD!)
  await page.getByRole('button', { name: 'Sign In' }).click()
  // Landing screen after sign-in is the Home tab (LandingPage, "/") — NavBar
  // only renders once the router mounts, i.e. once a session exists.
  await expect(page.getByRole('link', { name: /Home/ })).toBeVisible()
}

// The tab bar's links are matched by exact name: "You" and "Add" are short
// enough to also appear inside other links' text on some screens.
const tab = (page: Page, name: string) => page.getByRole('link', { name, exact: true })

test.describe('bottom tab navigation', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('Home tab is the default landing screen', async ({ page }) => {
    await expect(page).toHaveURL('/')
    await expect(tab(page, 'Home')).toHaveAttribute('data-active', 'true')
  })

  test('Receipts tab opens the list and is highlighted there', async ({ page }) => {
    await tab(page, 'Receipts').click()
    await expect(page).toHaveURL('/receipts')
    await expect(tab(page, 'Receipts')).toHaveAttribute('data-active', 'true')
    await expect(tab(page, 'Home')).toHaveAttribute('data-active', 'false')
  })

  test('Add tab opens the add-receipt screen', async ({ page }) => {
    await tab(page, 'Add').click()
    await expect(page).toHaveURL('/add')
  })

  test('Insights tab opens Insights', async ({ page }) => {
    await tab(page, 'Insights').click()
    await expect(page).toHaveURL('/reports')
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible()
  })

  test('You tab opens the You page and back to Home works', async ({ page }) => {
    await tab(page, 'You').click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByRole('heading', { name: 'You' })).toBeVisible()

    await tab(page, 'Home').click()
    await expect(page).toHaveURL('/')
  })

  test('pre-redesign report URLs still land on Insights', async ({ page }) => {
    await page.goto('/reports/categories')
    await expect(page).toHaveURL('/reports?m=all')
    await page.goto('/reports/monthly/2026-01')
    await expect(page).toHaveURL('/reports?m=2026-01')
  })
})

test.describe('You page sub-navigation', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await tab(page, 'You').click()
  })

  test('SMS alerts row navigates and back-navigates', async ({ page }) => {
    await page.getByRole('link', { name: /SMS alerts/ }).click()
    await expect(page).toHaveURL('/settings/sms')
    await page.goBack()
    await expect(page).toHaveURL('/settings')
  })

  test('SMS processing log link navigates and back-navigates', async ({ page }) => {
    await page.getByRole('link', { name: /SMS alerts/ }).click()
    await expect(page).toHaveURL('/settings/sms')
    await page.getByRole('link', { name: 'View processing log →' }).click()
    await expect(page).toHaveURL('/settings/sms/log')
    await expect(page.getByRole('heading', { name: 'SMS processing log' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL('/settings/sms')
  })

  test('Categories row navigates', async ({ page }) => {
    await page.getByRole('link', { name: /Categories/ }).click()
    await expect(page).toHaveURL('/settings/categories')
  })

  test('Gmail row navigates', async ({ page }) => {
    await page.getByRole('link', { name: /Gmail/ }).click()
    await expect(page).toHaveURL('/settings/gmail')
  })

  test('Members row opens the household page', async ({ page }) => {
    await page.getByRole('link', { name: /Members/ }).click()
    await expect(page).toHaveURL('/settings/household')
    await expect(page.getByRole('heading', { name: 'Household', exact: true })).toBeVisible()
  })

  test('picking a theme applies it and survives a reload', async ({ page }) => {
    // Stored per device (localStorage), so this never touches the account.
    const html = page.locator('html')
    const original = await html.getAttribute('data-theme')
    try {
      await page.getByRole('radio', { name: 'Paper' }).click()
      await expect(html).toHaveAttribute('data-theme', 'paper')
      await expect(html).toHaveAttribute('data-scheme', 'light')
      await page.reload()
      await expect(html).toHaveAttribute('data-theme', 'paper')
      await expect(page.getByRole('radio', { name: 'Paper' })).toBeChecked()
    } finally {
      await page.evaluate((t) => { if (t) localStorage.setItem('billskills.theme', t) }, original)
    }
  })
})

test.describe('receipt edit', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await tab(page, 'Receipts').click()
    await expect(page).toHaveURL('/receipts')
  })

  // A row in the list opens the receipt's read-only page; Edit is on that page.
  const firstRow = (page: Page) => page.locator('a[href^="/receipts/"]').first()

  test('saving an edited receipt does not leave a stale edit screen in the back stack', async ({ page }) => {
    // Regression guard: EditReceiptPage's save used to push a fresh entry,
    // which left the just-saved edit screen sitting in the back stack. The
    // next back tap would then land right back on that stale edit page, which
    // felt like the back button was stuck in a loop. Save must pop back
    // instead: to the receipt's own page, then one back tap to the list, and
    // one more out of it.
    await firstRow(page).waitFor()
    await firstRow(page).click()
    await expect(page).toHaveURL(/\/receipts\/[^/]+$/)
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/receipts\/.+\/edit/)

    await page.getByRole('button', { name: /Save Changes/ }).click()
    await expect(page).toHaveURL(/\/receipts\/[^/]+$/)

    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page).toHaveURL('/receipts')
    await page.goBack()
    await expect(page).toHaveURL('/')
  })

  test('an edited category persists to the database, not just the in-memory list', async ({ page }) => {
    // Regression guard: buildReceiptBody (supabaseClient.ts) used to gate
    // category/card_last4/card_bank behind the same "optional columns"
    // fallback as genuinely-optional fields (receipt_amount, conversion_rate,
    // etc.). On a deployment missing those other columns — which this test
    // account's does — PostgREST rejects the first write attempt, and the
    // retry (which exists only to drop the genuinely-missing columns)
    // silently dropped category too. The save looked successful, but the
    // category column never actually changed. A hard reload here forces a
    // fresh fetch from the DB rather than any client-side state, which is
    // exactly what "not persistent on the DB" describes.
    //
    // Targets "Din Tai Fung" specifically rather than the first receipt in
    // the list: receipts-data.spec.ts and drill-down.spec.ts run against this
    // same seeded account and assert specific categories on the fixtures that
    // usually sort first (FairPrice Finest -> Groceries) — briefly swapping
    // one of those to "Travel" here would race them into reading the
    // in-flight value. Din Tai Fung's category isn't asserted anywhere else.
    await page.getByPlaceholder('Search merchant, item, amount, card…').fill('Din Tai Fung')
    await firstRow(page).waitFor()
    await firstRow(page).click()
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/receipts\/.+\/edit/)
    const editUrl = page.url()

    const categorySelect = page.getByLabel('Category')
    const originalCategory = await categorySelect.inputValue()
    const newCategory = originalCategory === 'Travel' ? 'Miscellaneous' : 'Travel'

    try {
      await categorySelect.selectOption(newCategory)
      await page.getByRole('button', { name: /Save Changes/ }).click()
      await expect(page).toHaveURL(/\/receipts\/[^/]+$/)

      // A fresh page.goto (not an in-app Link click) forces a real reload —
      // a full refetch from the DB, not any client-side state left over
      // from the save above.
      await page.goto(editUrl)
      await expect(page.getByLabel('Category')).toHaveValue(newCategory)
    } finally {
      // Restore regardless of pass/fail, so a later test reading this same
      // seeded receipt's category isn't affected by this one. Reached by
      // page.goto, so there's no in-app history and save falls back to the
      // receipt's own page.
      await page.goto(editUrl)
      await page.getByLabel('Category').selectOption(originalCategory)
      await page.getByRole('button', { name: /Save Changes/ }).click()
      await expect(page).toHaveURL(/\/receipts\/[^/]+$/)
    }
  })
})

test.describe('sign-in and sign-out', () => {
  // Its own session, not the shared one: sign-out hits /auth/v1/logout, which
  // by default revokes ALL the account's refresh tokens. Specs still running
  // on the shared session keep working on their unexpired access token.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('sign out returns to the sign-in screen', async ({ page }) => {
    await signInThroughForm(page)
    await tab(page, 'You').click()
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
  })
})
