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
  // Landing page after sign-in is the receipts list; NavBar only renders
  // once the router mounts, i.e. once a session exists.
  await expect(page.getByRole('link', { name: /Receipts/ })).toBeVisible()
}

test.describe('bottom tab navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('Receipts tab is the default landing screen', async ({ page }) => {
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: /Receipts/ })).toHaveClass(/text-teal-700|text-teal-400/)
  })

  test('Add tab opens the add-receipt screen', async ({ page }) => {
    await page.getByRole('link', { name: /Add/ }).click()
    await expect(page).toHaveURL('/add')
  })

  test('Reports tab opens the reports overview', async ({ page }) => {
    await page.getByRole('link', { name: /Reports/ }).click()
    await expect(page).toHaveURL('/reports')
  })

  test('Settings tab opens settings and back to Receipts works', async ({ page }) => {
    await page.getByRole('link', { name: /Settings/ }).click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('link', { name: /Receipts/ }).click()
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

test('sign out returns to the sign-in screen', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page.getByRole('heading', { name: 'Bill Skills' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
})
