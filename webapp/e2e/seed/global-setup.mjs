// Playwright globalSetup: re-seeds a known set of sample receipts for the
// test account before every run, so specs can assert against fixture data
// instead of whatever a human left in the account last time.
//
// Deliberately does NOT fail the run when credentials are missing — specs
// already self-skip via test.skip(!EMAIL || !PASSWORD, ...) in that case,
// and globalSetup throwing would turn that into a hard failure instead.
import './load-env.mjs'
import { seedSampleReceipts } from './seed.mjs'

export default async function globalSetup() {
  if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
    console.log('[e2e seed] TEST_USER_EMAIL/TEST_USER_PASSWORD not set — skipping seed, specs will self-skip.')
    return
  }
  const { cleared, inserted, email } = await seedSampleReceipts({ reset: true })
  console.log(`[e2e seed] cleared ${cleared}, seeded ${inserted} sample receipt(s) for ${email}.`)
}
