import { test, expect, type Page } from '@playwright/test'

// Requires a real Supabase account (no mock backend — see CLAUDE.md "Auth &
// registration"). Point these at a disposable test household member, never a
// real user's credentials.
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email').fill(EMAIL!)
  await page.getByLabel('Password').fill(PASSWORD!)
  await page.getByRole('button', { name: 'Sign In' }).click()
  // Landing screen after sign-in is the Home tab (LandingPage, "/") — NavBar
  // only renders once the router mounts, i.e. once a session exists.
  await expect(page.getByRole('link', { name: /Home/ })).toBeVisible()
}

test.describe('bottom tab navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('Home tab is the default landing screen', async ({ page }) => {
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: /Home/ })).toHaveClass(/text-accent-700|text-accent-400/)
  })

  test('Home tab stays active while browsing the full receipts list', async ({ page }) => {
    await page.getByRole('link', { name: 'View all receipts' }).click()
    await expect(page).toHaveURL('/receipts')
    // NavBar.tsx deliberately keeps Home highlighted for /receipts* routes —
    // there's no separate tab for the list it links out to.
    await expect(page.getByRole('link', { name: /Home/ })).toHaveClass(/text-accent-700|text-accent-400/)
  })

  test('Add tab opens the add-receipt screen', async ({ page }) => {
    await page.getByRole('link', { name: /Add/ }).click()
    await expect(page).toHaveURL('/add')
  })

  test('Reports tab opens the reports overview', async ({ page }) => {
    await page.getByRole('link', { name: /Reports/ }).click()
    await expect(page).toHaveURL('/reports')
  })

  test('Settings tab opens settings and back to Home works', async ({ page }) => {
    await page.getByRole('link', { name: /Settings/ }).click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('link', { name: /Home/ }).click()
    await expect(page).toHaveURL('/')
  })
})

test.describe('settings sub-navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.getByRole('link', { name: /Settings/ }).click()
  })

  test('SMS setup link navigates and back-navigates', async ({ page }) => {
    await page.getByRole('link', { name: 'Manage SMS tokens →' }).click()
    await expect(page).toHaveURL('/settings/sms')
    await page.goBack()
    await expect(page).toHaveURL('/settings')
  })

  test('Categories setup link navigates', async ({ page }) => {
    await page.getByRole('link', { name: 'Manage categories →' }).click()
    await expect(page).toHaveURL('/settings/categories')
  })

  test('Gmail setup link navigates', async ({ page }) => {
    await page.getByRole('link', { name: /Connect Gmail →|Manage$/ }).click()
    await expect(page).toHaveURL('/settings/gmail')
  })
})

test.describe('receipt edit', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.getByRole('link', { name: 'View all receipts' }).click()
    await expect(page).toHaveURL('/receipts')
  })

  test('saving an edited receipt does not leave a stale edit screen in the back stack', async ({ page }) => {
    // Regression guard: EditReceiptPage's save used to `navigate('/receipts')`
    // — a plain push — which left the just-saved edit screen sitting in the
    // back stack. The next back tap from /receipts would then land right
    // back on that stale edit page instead of leaving the flow, which felt
    // like the back button was stuck in a loop. Save must now pop back
    // instead, so one back tap from here goes all the way to Home.
    const firstReceipt = page.locator('a[href^="/receipts/"][href$="/edit"]').first()
    await firstReceipt.waitFor()
    await firstReceipt.click()
    await expect(page).toHaveURL(/\/receipts\/.+\/edit/)

    await page.getByRole('button', { name: /Save Changes/ }).click()
    await expect(page).toHaveURL('/receipts')

    await page.getByRole('button', { name: 'Go back' }).click()
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
    const firstReceipt = page.locator('a[href^="/receipts/"][href$="/edit"]').first()
    await firstReceipt.waitFor()
    await firstReceipt.click()
    await expect(page).toHaveURL(/\/receipts\/.+\/edit/)
    const editUrl = page.url()

    const categorySelect = page.getByLabel('Category')
    const originalCategory = await categorySelect.inputValue()
    const newCategory = originalCategory === 'Travel' ? 'Miscellaneous' : 'Travel'

    try {
      await categorySelect.selectOption(newCategory)
      await page.getByRole('button', { name: /Save Changes/ }).click()
      await expect(page).toHaveURL('/receipts')

      // A fresh page.goto (not an in-app Link click) forces a real reload —
      // a full refetch from the DB, not any client-side state left over
      // from the save above.
      await page.goto(editUrl)
      await expect(page.getByLabel('Category')).toHaveValue(newCategory)
    } finally {
      // Restore regardless of pass/fail, so a later test reading this same
      // seeded receipt's category isn't affected by this one.
      await page.goto(editUrl)
      await page.getByLabel('Category').selectOption(originalCategory)
      await page.getByRole('button', { name: /Save Changes/ }).click()
      await expect(page).toHaveURL('/receipts')
    }
  })
})

test('sign out returns to the sign-in screen', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
})
