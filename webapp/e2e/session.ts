import { expect, type Page } from '@playwright/test'

/** Saved by auth.setup.ts. Holds a live refresh token, so it's gitignored. */
export const AUTH_STATE_PATH = 'e2e/.auth/user.json'

/** Opens the app with the session auth.setup.ts saved; no sign-in request. */
export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByRole('link', { name: /Home/ })).toBeVisible()
}
