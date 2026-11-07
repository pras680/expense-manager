import { test, expect, type Page } from '@playwright/test'
import { openApp } from './session'

// The session is real; the ask-spending edge function is intercepted so the UI
// can be checked without spending LLM quota (or before the function is deployed).
const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not set — see webapp/e2e/README.md')

const ASK_URL = '**/functions/v1/ask-spending'

const launcher = (page: Page) => page.getByRole('button', { name: /Talk to me/ })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Talk to me' })

test.describe('Talk to me', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('launcher opens the chat with suggestions and closes on Escape', async ({ page }) => {
    await launcher(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('button', { name: 'How much did I spend last month?' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(launcher(page)).toBeVisible()
  })

  test('launcher is hidden on the Add Receipt form', async ({ page }) => {
    await page.getByRole('link', { name: /Add/ }).click()
    await expect(page).toHaveURL('/add')
    await expect(launcher(page)).toBeHidden()
  })

  test('answers render with their lookups, and follow-ups carry history', async ({ page }) => {
    const bodies: Array<{ message: string; history: Array<{ role: string; content: string }> }> = []
    await page.route(ASK_URL, async (route) => {
      bodies.push(route.request().postDataJSON())
      const first = bodies.length === 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: first ? 'You spent **SGD 1,234.50** last month.' : 'In September you spent SGD 980.00.',
          tool_calls: [{ round: 1, tool: 'spending_by_category', args: { from: '2026-10-01', to: '2026-10-31' } }],
          rounds: 1,
          run_id: null
        })
      })
    })

    await launcher(page).click()
    await panel(page).getByRole('button', { name: 'How much did I spend last month?' }).click()

    await expect(panel(page).getByText('SGD 1,234.50', { exact: true })).toBeVisible()
    // **bold** is rendered as an element, not shown as literal asterisks.
    await expect(panel(page).locator('strong', { hasText: 'SGD 1,234.50' })).toBeVisible()
    await panel(page).getByText('Looked up 1 thing').click()
    await expect(panel(page).getByText(/Spending by category · 2026-10-01 → 2026-10-31/)).toBeVisible()

    await panel(page).getByLabel('Your question').fill('and the month before?')
    await panel(page).getByLabel('Your question').press('Enter')
    await expect(panel(page).getByText('In September you spent SGD 980.00.')).toBeVisible()

    expect(bodies[0]).toEqual({ message: 'How much did I spend last month?', history: [] })
    expect(bodies[1].message).toBe('and the month before?')
    expect(bodies[1].history).toEqual([
      { role: 'user', content: 'How much did I spend last month?' },
      { role: 'assistant', content: 'You spent **SGD 1,234.50** last month.' }
    ])
  })

  test('a server error shows as a message and is not replayed as history', async ({ page }) => {
    const bodies: Array<{ history: unknown[] }> = []
    await page.route(ASK_URL, async (route) => {
      bodies.push(route.request().postDataJSON())
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Chat is not configured' })
      })
    })

    await launcher(page).click()
    await panel(page).getByLabel('Your question').fill('hello')
    await panel(page).getByRole('button', { name: 'Send' }).click()
    await expect(panel(page).getByText('Chat is not configured')).toBeVisible()

    await panel(page).getByLabel('Your question').fill('again')
    await panel(page).getByRole('button', { name: 'Send' }).click()
    await expect(panel(page).getByText('Chat is not configured')).toHaveCount(2)
    expect(bodies[1].history).toEqual([{ role: 'user', content: 'hello' }])
  })

  test('the conversation survives navigation, and New chat clears it', async ({ page }) => {
    await page.route(ASK_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Noted.', tool_calls: [] }) })
    )
    await launcher(page).click()
    await panel(page).getByLabel('Your question').fill('remember me')
    await panel(page).getByLabel('Your question').press('Enter')
    await expect(panel(page).getByText('Noted.')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('link', { name: /Reports/ }).click()
    await expect(page).toHaveURL('/reports')
    await launcher(page).click()
    await expect(panel(page).getByText('remember me')).toBeVisible()

    await panel(page).getByRole('button', { name: 'New chat' }).click()
    await expect(panel(page).getByText('remember me')).toBeHidden()
    await expect(panel(page).getByRole('button', { name: 'How much did I spend last month?' })).toBeVisible()
  })
})
