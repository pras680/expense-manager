#!/usr/bin/env node
//
// One-off backfill: give older photo receipts their searchable text.
//
// Photo receipts saved before the parser returned a transcription were stored
// with raw_ocr_json.raw_text = '' and no line_items — the structured fields were
// kept and everything else printed on the receipt was discarded. Those words
// only ever existed at parse time, so the only way to recover them is to fetch
// the stored image and read it again.
//
// Run:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   node supabase-edge/backfill-receipt-raw-text.mjs --since 2026-08-01 --dry-run
//
// Drop --dry-run to actually write. Safe to re-run: rows that already have text
// are skipped, so an interrupted run simply resumes.
//
// service_role is required — the script reads across every household and pulls
// objects out of a bucket whose policies are scoped to each uploader's own uid.
// Keep the key in the environment; never commit it.

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const since = valueOf('--since') ?? '2026-08-01'
const limit = Number(valueOf('--limit') ?? '200')
// Gemini bills per image. Pause between calls so a large backfill doesn't
// arrive as a burst and trip a rate limit mid-run.
const DELAY_MS = Number(valueOf('--delay') ?? '1200')
const MAX_IMAGE_BASE64_CHARS = 8_000_000 // matches the parse-receipt guard

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BUCKET = 'receipt-documents'

/**
 * file_url is stored in two shapes depending on when the row was written:
 * older rows hold a full .../object/public/<bucket>/<path> URL from when the
 * bucket was public, newer ones hold just the bare <uid>/<file> object path.
 * Mirrors objectPathFromFileUrl in webapp/src/lib/supabaseClient.ts.
 *
 * Either way the request has to go to the authenticated /object/ endpoint —
 * /object/public/ serves anonymously and returns 400 for a private bucket no
 * matter what credentials accompany it.
 */
function objectUrlFor(fileUrl) {
  const marker = `/${BUCKET}/`
  const objectPath = fileUrl.includes(marker) ? fileUrl.split(marker)[1] : fileUrl
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`
}

function needsBackfill(row) {
  if (!row.file_url) return false
  const j = row.raw_ocr_json
  if (!j || typeof j !== 'object') return true
  const hasText = typeof j.raw_text === 'string' && j.raw_text.trim().length > 0
  const hasItems = Array.isArray(j.line_items) && j.line_items.length > 0
  return !hasText && !hasItems
}

async function main() {
  const url =
    `${SUPABASE_URL}/rest/v1/receipts` +
    `?select=id,merchant,date,file_url,raw_ocr_json` +
    `&date=gte.${since}&file_url=not.is.null&order=date.asc&limit=${limit}`

  const resp = await fetch(url, { headers })
  if (!resp.ok) {
    console.error(`Fetch failed: HTTP ${resp.status} ${await resp.text()}`)
    process.exit(1)
  }

  const all = await resp.json()
  const todo = all.filter(needsBackfill)
  console.log(`${all.length} receipt(s) with an image since ${since}; ${todo.length} need text.`)
  if (todo.length === 0) return
  if (DRY_RUN) {
    for (const r of todo) console.log(`  would backfill ${r.date}  ${r.merchant ?? '(no merchant)'}`)
    console.log('\nDry run — nothing written. Re-run without --dry-run to apply.')
    return
  }

  let done = 0, skipped = 0, failed = 0

  for (const row of todo) {
    const label = `${row.date} ${row.merchant ?? '(no merchant)'}`
    try {
      const imgResp = await fetch(objectUrlFor(row.file_url), {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      })
      if (!imgResp.ok) {
        console.warn(`  SKIP  ${label} — image fetch HTTP ${imgResp.status}`)
        skipped++
        continue
      }

      const buf = Buffer.from(await imgResp.arrayBuffer())
      const b64 = buf.toString('base64')
      if (b64.length > MAX_IMAGE_BASE64_CHARS) {
        console.warn(`  SKIP  ${label} — image too large (${(buf.length / 1e6).toFixed(1)}MB)`)
        skipped++
        continue
      }

      const mime = imgResp.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      const parseResp = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ image_base64: b64, image_mime_type: mime })
      })
      if (parseResp.status === 429) {
        // Out of quota for now. Every remaining row would fail the same way, so
        // stop rather than turning one quota limit into a wall of failures —
        // the run is resumable, since nothing already written is redone.
        console.error(`\n  Stopped at ${label}: the LLM account is rate limited or out of quota (429).`)
        console.error('  Wait for the quota to reset (or raise the limit), then re-run to resume.')
        break
      }
      if (!parseResp.ok) {
        console.warn(`  FAIL  ${label} — parse HTTP ${parseResp.status} ${(await parseResp.text()).slice(0, 120)}`)
        failed++
        continue
      }

      const parsed = await parseResp.json()
      const rawText = typeof parsed.raw_text === 'string' ? parsed.raw_text.trim() : ''
      const lineItems = Array.isArray(parsed.line_items)
        ? parsed.line_items
            .filter((li) => li && typeof li.description === 'string' && li.description.trim())
            .map((li) => ({ description: li.description.trim(), amount: typeof li.amount === 'number' ? li.amount : null }))
        : []

      if (!rawText && lineItems.length === 0) {
        console.warn(`  SKIP  ${label} — parser returned no text`)
        skipped++
        continue
      }

      // Merge, never replace: raw_ocr_json also holds the currency and card
      // fields that the app reads as fallbacks when the top-level columns are
      // null, and overwriting the object wholesale would erase them.
      const merged = { ...(row.raw_ocr_json ?? {}), raw_text: rawText, line_items: lineItems }

      const patch = await fetch(`${SUPABASE_URL}/rest/v1/receipts?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ raw_ocr_json: merged })
      })
      if (!patch.ok) {
        console.warn(`  FAIL  ${label} — update HTTP ${patch.status}`)
        failed++
        continue
      }

      console.log(`  OK    ${label} — ${rawText.length} chars, ${lineItems.length} item(s)`)
      done++
    } catch (err) {
      console.warn(`  FAIL  ${label} — ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
    await sleep(DELAY_MS)
  }

  console.log(`\nBackfilled ${done}, skipped ${skipped}, failed ${failed}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
