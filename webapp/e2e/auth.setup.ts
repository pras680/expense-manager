import { test as setup, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { AUTH_STATE_PATH } from './session'

// Signs in ONCE through the real form and saves the session (localStorage)
// for every spec to start from. Signing in per test meant ~60 password grants
// a run, which Supabase Auth's per-IP limiter refuses partway through.
setup('sign in once', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  mkdirSync(dirname(AUTH_STATE_PATH), { recursive: true })
  if (!email || !password) {
    // Specs self-skip without credentials; they still need a file to load.
    writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies: [], origins: [] }))
    return
  }
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page.getByRole('link', { name: /Home/ })).toBeVisible()
  await page.context().storageState({ path: AUTH_STATE_PATH })
})
