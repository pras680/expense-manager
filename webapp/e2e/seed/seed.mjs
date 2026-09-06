#!/usr/bin/env node
// Seeds (or clears) a fixed set of sample receipts for the e2e test account,
// so specs that need to see real data — reports totals, the review queue,
// category badges — don't depend on whatever a human happened to leave in
// that account from a previous run.
//
// Inserts go through the same REST endpoint + auth the webapp itself uses
// (PostgREST, signed in as the test user), not a service-role bypass — the
// receipts_set_owner trigger stamps user_id/household_id exactly as it would
// for a real manual entry. This is fixture data for a disposable test
// account, not a write against a real household's data (see CLAUDE.md
// "Ad-hoc analysis" for why this project avoids service-role inserts).
//
// Usage (from webapp/):
//   node e2e/seed/seed.mjs           # seed, skipping any fixture already present
//   node e2e/seed/seed.mjs --reset   # delete previously seeded fixtures, then re-seed
//   node e2e/seed/seed.mjs --clear   # delete previously seeded fixtures, don't re-seed
//
// Required env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_USER_EMAIL,
// TEST_USER_PASSWORD (same variables the e2e specs and playwright.config.ts use).
// Also importable (seedSampleReceipts) — Playwright's global-setup uses this
// directly so `npm run test:e2e` always runs against a known fixture set.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import './load-env.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Every seeded row's comment carries this marker so it can be found and
// deleted later without touching any real data the test account might also
// hold — never assume the account is empty.
const SEED_MARKER = '[e2e-seed]'

/**
 * @param {{ reset?: boolean, clearOnly?: boolean }} [opts]
 * @returns {Promise<{ cleared: number, inserted: number }>}
 */
export async function seedSampleReceipts(opts = {}) {
  const doClear = Boolean(opts.reset || opts.clearOnly)
  const doSeed = !opts.clearOnly

  const supabaseUrl = mustGetEnv('VITE_SUPABASE_URL')
  const anonKey = mustGetEnv('VITE_SUPABASE_ANON_KEY')
  const email = mustGetEnv('TEST_USER_EMAIL')
  const password = mustGetEnv('TEST_USER_PASSWORD')

  const tokenResp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!tokenResp.ok) {
    throw new Error(`Sign-in failed: HTTP ${tokenResp.status} ${await tokenResp.text()}`)
  }
  const { access_token: accessToken } = await tokenResp.json()
  if (!accessToken) throw new Error('Sign-in response had no access_token')

  const authHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
  const restUrl = `${supabaseUrl}/rest/v1`

  let cleared = 0
  if (doClear) {
    const resp = await fetch(
      `${restUrl}/receipts?comment=ilike.*${encodeURIComponent(SEED_MARKER)}*`,
      { method: 'DELETE', headers: { ...authHeaders, Prefer: 'return=representation' } }
    )
    if (!resp.ok) throw new Error(`Clearing seed data failed: HTTP ${resp.status} ${await resp.text()}`)
    const deleted = await resp.json()
    cleared = Array.isArray(deleted) ? deleted.length : 0
  }

  let inserted = 0
  if (doSeed) {
    const fixtures = JSON.parse(readFileSync(join(__dirname, 'sample-receipts.json'), 'utf8'))
    for (const fixture of fixtures) {
      await insertFixture({ restUrl, authHeaders, fixture })
      inserted += 1
    }
  }

  return { cleared, inserted, email }
}

function mustGetEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}. See webapp/e2e/README.md.`)
  return value
}

async function insertFixture({ restUrl, authHeaders, fixture }) {
  const date = new Date(Date.now() - fixture.daysAgo * 24 * 60 * 60 * 1000).toISOString()
  const comment = `${fixture.comment ?? ''} ${SEED_MARKER}:${fixture.key}`.trim()

  // Mirrors buildReceiptBody in src/lib/supabaseClient.ts: category/card_bank/
  // etc. are real top-level columns on this schema, sent directly rather
  // than only inside raw_ocr_json.
  const body = {
    merchant: fixture.merchant,
    date,
    total: fixture.total,
    currency: fixture.currency,
    file_url: null,
    visibility: fixture.visibility,
    source: fixture.source,
    comment,
    reviewed_at: fixture.reviewed ? date : null,
    category: fixture.category,
    card_last4: fixture.cardLast4 ?? null,
    card_bank: fixture.cardBank ?? null,
    transfer_from_bank: fixture.transferFromBank ?? null,
    transfer_to_bank: fixture.transferToBank ?? null,
    transfer_kind: fixture.transferKind ?? null,
    raw_ocr_json: {
      raw_text: `Seed fixture ${fixture.key}`,
      receipt_amount: String(fixture.total),
      receipt_currency: fixture.currency,
      default_currency: fixture.currency,
      conversion_rate: '1',
      converted_total: String(fixture.total),
      category: fixture.category,
      card_last4: fixture.cardLast4 ?? '',
      card_bank: fixture.cardBank ?? '',
      seed_tag: 'expense-manager-e2e'
    }
  }

  let resp = await fetch(`${restUrl}/receipts`, {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    const missingColumn = /pgrst204|42703|schema cache|column.*(could not find|does not exist)/i.test(errBody)
    if (!missingColumn) throw new Error(`Insert failed for ${fixture.key}: HTTP ${resp.status} ${errBody.slice(0, 300)}`)
    // Same optional-column retry insertReceipt does client-side.
    const {
      category: _category,
      card_last4: _cardLast4,
      card_bank: _cardBank,
      transfer_from_bank: _transferFromBank,
      transfer_to_bank: _transferToBank,
      transfer_kind: _transferKind,
      ...withoutOptional
    } = body
    resp = await fetch(`${restUrl}/receipts`, {
      method: 'POST',
      headers: { ...authHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(withoutOptional)
    })
    if (!resp.ok) throw new Error(`Insert failed for ${fixture.key} (retry): HTTP ${resp.status} ${await resp.text()}`)
  }
}

// Only run as a CLI when invoked directly (`node e2e/seed/seed.mjs`), not
// when imported by global-setup.mjs.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2))
  seedSampleReceipts({ reset: args.has('--reset') || args.has('--clear'), clearOnly: args.has('--clear') })
    .then(({ cleared, inserted, email }) => {
      if (cleared) console.log(`Cleared ${cleared} previously seeded receipt(s).`)
      if (inserted) console.log(`Seeded ${inserted} sample receipt(s) for ${email}.`)
    })
    .catch((err) => {
      console.error(err.message ?? err)
      process.exit(1)
    })
}
