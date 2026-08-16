import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Scheduled (Supabase Cron) companion to receive-sms: drains pending sms_inbox
// rows into real receipts, independent of any client app being open. Ported
// from the iOS app's ReceiptStore.processSMSInboxRows + InvoiceParser, with
// two deliberate simplifications documented in the webapp plan:
//   - inserts directly into `receipts`, no pending-review queue (the iOS app's
//     review step isn't ported — sms_inbox itself already accepts messages
//     unattended, this is consistent with that).
//   - the duplicate guard is a simple same-total/same-day check, not the iOS
//     app's ~250-line fuzzy cross-source matching (that logic is coupled to
//     in-memory app state and isn't reasonably portable in small form).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
// Deliberately small. Each row makes a Gemini call via parse-receipt (seconds
// each), and the caller is pg_net, which abandons the connection on timeout and
// takes the whole invocation down with it. A batch of 25 could never finish, so
// every tick timed out and nothing was ever drained. 5 keeps one invocation
// comfortably inside the cron's timeout; a backlog just drains over more ticks.
const BATCH_LIMIT = 5
const MAX_BODY_CHARS = 8_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

// ---- Ported from ExpenseManager/ExpenseManager/Models/Invoice.swift (InvoiceParser) ----

const TRANSACTION_CUES = [
  'spent', 'purchase', 'transaction', 'payment', 'paid', 'debit', 'charged',
  'card ending', 'card no', 'paynow', 'paylah', 'transfer', 'sent to',
  'paid to', 'merchant', 'withdraw', 'withdrawal', 'atm'
]
const NON_EXPENSE_CUES = [
  'otp', 'one-time password', 'verification code', 'login',
  'balance enquiry', 'available balance only'
]
const REVERSAL_CUES = [
  'reversal', 'reversed', 'has been reversed', 'transaction reversed',
  'charge reversed', 'payment reversed', 'refund', 'refunded', 'chargeback',
  'charge back', 'credited back', 'credit back', 'money back',
  'amount credited', 'transaction cancelled', 'transaction canceled',
  'cancelled transaction', 'canceled transaction', 'transaction voided',
  'voided', 'declined and reversed'
]
// Non-global on purpose — a global regex's statefulness (lastIndex) is a
// classic footgun when reused with .test() across a loop.
const AMOUNT_RE = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/

function isReversalTransaction(text: string): boolean {
  const normalized = text.toLowerCase()
  return REVERSAL_CUES.some((cue) => normalized.includes(cue))
}

function looksLikeExpenseSMS(text: string): boolean {
  const normalized = text.toLowerCase()
  const hasMoney = AMOUNT_RE.test(text) || normalized.includes('sgd') || normalized.includes('s$')
  const hasTransactionCue = TRANSACTION_CUES.some((cue) => normalized.includes(cue)) || isReversalTransaction(text)
  const hasNonExpenseCue = NON_EXPENSE_CUES.some((cue) => normalized.includes(cue))
  return hasMoney && hasTransactionCue && !hasNonExpenseCue
}

// ---- Ported from ExpenseManager/ExpenseManager/Services/CurrencyConversionService.swift ----

const FALLBACK_RATES_TO_SGD: Record<string, number> = {
  SGD: 1, USD: 1.35, EUR: 1.46, GBP: 1.71, AUD: 0.89, CAD: 0.99, JPY: 0.0091,
  CNY: 0.19, HKD: 0.17, INR: 0.016, MYR: 0.29, THB: 0.037, IDR: 0.000083,
  PHP: 0.023, VND: 0.000053, KRW: 0.00098, AED: 0.37
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Reading claims without re-verifying the signature is only safe because this
// function is deployed with verify_jwt=true, so Supabase's gateway has already
// validated the signature and expiry before we see the request.
function jwtRole(token: string): string | null {
  const segments = token.split('.')
  if (segments.length !== 3) return null // opaque key, not a JWT
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded))
    return typeof claims?.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}

// Constant-time comparison — never short-circuits on the first differing byte,
// so response timing can't be used to recover the key incrementally.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  let diff = aBytes.length ^ bBytes.length
  const max = Math.max(aBytes.length, bBytes.length)
  for (let i = 0; i < max; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }
  return diff === 0
}

async function convertCurrency(
  amount: number,
  from: string,
  to: string,
  onDateISO: string
): Promise<{ rate: number; converted: number }> {
  if (from === to) return { rate: 1, converted: round2(amount) }

  const now = new Date()
  const parsedDate = new Date(onDateISO)
  const clamped = Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() > now.getTime() ? now : parsedDate
  const dateStr = clamped.toISOString().slice(0, 10)

  try {
    const resp = await fetch(`https://api.frankfurter.app/${dateStr}?from=${from}&to=${to}`)
    if (!resp.ok) throw new Error(`Frankfurter HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = data?.rates?.[to]
    if (typeof rate !== 'number') throw new Error('Frankfurter response missing rate')
    return { rate, converted: round2(amount * rate) }
  } catch (_err) {
    const fromToSGD = FALLBACK_RATES_TO_SGD[from] ?? 1
    const toToSGD = FALLBACK_RATES_TO_SGD[to] ?? 1
    const rate = fromToSGD / toToSGD
    return { rate, converted: round2(amount * rate) }
  }
}

// ---- Main handler ----

type SMSInboxRow = {
  id: string
  body: string
  sender: string | null
  received_at: string
  user_id: string | null
  retry_count: number
  status: 'pending' | 'failed'
}

// Bounds how many times a transient failure (e.g. parse-receipt briefly
// 502ing) gets retried before it's left as a permanent failure — otherwise a
// row with a genuinely bad body would retry forever, every tick.
const MAX_RETRIES = 3
type RestHeaders = { apikey: string; Authorization: string; 'Content-Type': string }

// Resolved once per owning user, then reused for every row that user owns.
type OwnerContext = { userId: string; householdId: string | null; defaultCurrency: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('process-sms-inbox: Supabase Edge Function environment is incomplete.')
    return jsonResponse({ error: 'process-sms-inbox is not configured' }, 500)
  }

  // Only the pg_cron job (which authenticates with the service_role key) may run
  // this. Supabase's verify_jwt gate alone isn't enough: the public anon key is a
  // valid credential there, and it ships inside the iOS binary and the web app's
  // JS bundle, so without this check anyone could drive the inbox drain.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  // Accept an exact match on the injected key, or any token carrying the
  // service_role claim — the cron job supplies its key from Vault, which may be
  // the legacy JWT-format key while the injected env var is the newer opaque
  // sb_secret_ format (or vice versa). Matching on either avoids a silent
  // cron outage from a pure format mismatch.
  if (!timingSafeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY) && jwtRole(bearer) !== 'service_role') {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const headers: RestHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }

  let processed = 0
  let skipped = 0
  let failed = 0

  try {
    // Pending rows plus failed rows still under the retry cap — a bare
    // status=eq.pending filter is why a transient parse-receipt 502 used to
    // strand a row in 'failed' forever with nothing ever looking at it again.
    const rowsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_inbox?select=id,body,sender,received_at,user_id,retry_count,status` +
      `&or=(status.eq.pending,and(status.eq.failed,retry_count.lt.${MAX_RETRIES}))` +
      `&order=received_at.asc&limit=${BATCH_LIMIT}`,
      { headers }
    )
    if (!rowsResp.ok) throw new Error(`Failed to fetch sms_inbox: HTTP ${rowsResp.status}`)
    const rows: SMSInboxRow[] = await rowsResp.json()

    // This function runs as service_role and therefore bypasses RLS entirely —
    // every query below has to scope itself by owner explicitly.
    const ownerCache = new Map<string, OwnerContext>()

    for (const row of rows) {
      // Atomically claim the row (pending|failed -> processing) so two
      // overlapping invocations can't both process the same message.
      const claimed = await claimRow(row.id, row.status, row.retry_count, headers)
      if (!claimed) continue

      if (!row.user_id) {
        // Predates per-user ingest tokens, so there is no way to tell whose
        // spending this is. Filing it under an arbitrary user would corrupt
        // someone's totals — leave it visible and unprocessed instead.
        await markRow(row.id, headers, 'skipped', 'No owner — predates per-user SMS tokens', null)
        skipped++
        continue
      }

      let owner = ownerCache.get(row.user_id)
      if (!owner) {
        owner = await loadOwnerContext(row.user_id, headers)
        ownerCache.set(row.user_id, owner)
      }

      const outcome = await processRow(row, headers, owner)
      if (outcome === 'processed') processed++
      else if (outcome === 'failed') failed++
      else skipped++
    }

    return jsonResponse({ processed, skipped, failed, total: rows.length })
  } catch (err) {
    console.error(`process-sms-inbox failed: ${err instanceof Error ? err.message : String(err)}`)
    return jsonResponse({ error: 'process-sms-inbox failed', processed, skipped, failed }, 500)
  }
})

// Currency and household now come from the SMS owner's own settings, replacing
// the single global app_settings.default_currency row — otherwise one member's
// currency preference would silently convert everyone else's spending.
async function loadOwnerContext(userId: string, headers: RestHeaders): Promise<OwnerContext> {
  const fallback: OwnerContext = { userId, householdId: null, defaultCurrency: 'SGD' }
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?select=default_currency,active_household_id&user_id=eq.${userId}&limit=1`,
      { headers }
    )
    if (!resp.ok) return fallback
    const rows = await resp.json()
    const settings = Array.isArray(rows) ? rows[0] : null
    if (!settings) return fallback

    let householdId: string | null = settings.active_household_id ?? null
    if (!householdId) {
      const memberResp = await fetch(
        `${SUPABASE_URL}/rest/v1/household_members?select=household_id&user_id=eq.${userId}&order=joined_at.asc&limit=1`,
        { headers }
      )
      if (memberResp.ok) {
        const memberRows = await memberResp.json()
        householdId = memberRows?.[0]?.household_id ?? null
      }
    }

    return {
      userId,
      householdId,
      defaultCurrency: typeof settings.default_currency === 'string' && settings.default_currency
        ? settings.default_currency
        : 'SGD'
    }
  } catch (_err) {
    return fallback
  }
}

async function claimRow(
  id: string,
  fromStatus: 'pending' | 'failed',
  retryCount: number,
  headers: RestHeaders
): Promise<boolean> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/sms_inbox?id=eq.${id}&status=eq.${fromStatus}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'processing',
      // Counts this attempt whether or not it goes on to fail again, so a row
      // that keeps failing still exhausts MAX_RETRIES and stops retrying.
      ...(fromStatus === 'failed' ? { retry_count: retryCount + 1 } : {})
    })
  })
  if (!resp.ok) return false
  const rows = await resp.json()
  return Array.isArray(rows) && rows.length > 0
}

async function markRow(
  id: string,
  headers: RestHeaders,
  status: 'processed' | 'skipped' | 'failed',
  errorMessage: string | null,
  receiptId: string | null
) {
  await fetch(`${SUPABASE_URL}/rest/v1/sms_inbox?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      status,
      error_message: errorMessage,
      receipt_id: receiptId,
      processed_at: new Date().toISOString()
    })
  })
}

async function processRow(
  row: SMSInboxRow,
  headers: RestHeaders,
  owner: OwnerContext
): Promise<'processed' | 'skipped' | 'failed'> {
  const defaultCurrency = owner.defaultCurrency
  const smsText = row.body.slice(0, MAX_BODY_CHARS).trim()
  if (!smsText) {
    await markRow(row.id, headers, 'skipped', 'Empty body', null)
    return 'skipped'
  }

  if (!looksLikeExpenseSMS(smsText)) {
    await markRow(row.id, headers, 'skipped', null, null)
    return 'skipped'
  }

  if (isReversalTransaction(smsText)) {
    return processReversal(row, smsText, headers, owner)
  }

  let parsed: Record<string, unknown>
  try {
    const parseResp = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: 'POST',
      headers,
      // Bank alerts routinely omit the year (e.g. "15 Aug 16:55") — the SMS's
      // own arrival time is a far better anchor for inferring it than the
      // parser's own clock, which has no idea when this particular message
      // was actually sent.
      body: JSON.stringify({ raw_text: `SMS Expense Alert:\n${smsText}`, reference_date: row.received_at })
    })
    if (!parseResp.ok) {
      const errBody = await parseResp.text()
      throw new Error(`parse-receipt HTTP ${parseResp.status}: ${errBody.slice(0, 200)}`)
    }
    parsed = await parseResp.json()
  } catch (err) {
    await markRow(row.id, headers, 'failed', `Parse failed: ${err instanceof Error ? err.message : String(err)}`, null)
    return 'failed'
  }

  const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : ''
  const totalRaw = typeof parsed.total === 'number' ? parsed.total : Number(parsed.total)
  if (!merchant || !Number.isFinite(totalRaw) || totalRaw <= 0) {
    await markRow(row.id, headers, 'skipped', 'Missing amount or merchant', null)
    return 'skipped'
  }

  const receiptCurrency = typeof parsed.currency === 'string' && parsed.currency ? parsed.currency : defaultCurrency
  const category = typeof parsed.category === 'string' && parsed.category ? parsed.category : 'Miscellaneous'

  const rawDate = (typeof parsed.date === 'string' && parsed.date) ? parsed.date : row.received_at
  const parsedDate = new Date(rawDate)
  const normalizedDate = Number.isNaN(parsedDate.getTime()) ? row.received_at : parsedDate.toISOString()

  let cardLast4: string | null = typeof parsed.card_last4 === 'string' && parsed.card_last4
    ? parsed.card_last4
    : (typeof parsed.extracted_digits === 'string' ? parsed.extracted_digits : null)
  let cardBank: string | null = typeof parsed.card_bank === 'string' && parsed.card_bank ? parsed.card_bank : null

  if (cardLast4) {
    const normalizedLast4 = cardLast4.replace(/[^0-9]/g, '').slice(-4)
    if (normalizedLast4.length === 4) {
      cardLast4 = normalizedLast4
      try {
        // Scoped to the owner's household: last_digits is only unique per
        // household now, so an unscoped lookup could return another family's
        // card and stamp the wrong bank on this receipt.
        const householdFilter = owner.householdId
          ? `&household_id=eq.${owner.householdId}`
          : '&household_id=is.null'
        const pmResp = await fetch(
          `${SUPABASE_URL}/rest/v1/payment_methods?select=id,last_digits,bank_name,card_name&last_digits=eq.${normalizedLast4}${householdFilter}`,
          { headers }
        )
        if (pmResp.ok) {
          const pmRows = await pmResp.json()
          cardBank = pmRows?.[0]?.bank_name ?? cardBank ?? 'Unknown Bank'
        } else if (!cardBank) {
          cardBank = 'Unknown Bank'
        }
      } catch (_err) {
        if (!cardBank) cardBank = 'Unknown Bank'
      }
    } else {
      cardLast4 = null
    }
  }

  const { rate, converted } = await convertCurrency(totalRaw, receiptCurrency, defaultCurrency, normalizedDate)

  // Duplicate guard, scoped to the household and qualified by merchant.
  //
  // Household scope is what stops a shared family card double-counting: the same
  // bank alert reaches both phones, each person's Shortcut files its own
  // sms_inbox row (body_hash is unique per user now), but only the first one
  // becomes a receipt.
  //
  // Merchant qualification matters just as much — amount-and-date alone matched
  // any unrelated purchase of the same value on the same day, silently dropping
  // legitimate receipts. That was tolerable for one user and is not for several.
  try {
    const d = new Date(normalizedDate)
    const from = new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString()
    const scope = owner.householdId
      ? `household_id=eq.${owner.householdId}`
      : `user_id=eq.${owner.userId}`
    const dupResp = await fetch(
      `${SUPABASE_URL}/rest/v1/receipts?select=id,merchant&${scope}` +
      `&total=gte.${(converted - 0.01).toFixed(2)}&total=lte.${(converted + 0.01).toFixed(2)}` +
      `&date=gte.${from}&date=lte.${to}&limit=10`,
      { headers }
    )
    if (dupResp.ok) {
      const dupRows = await dupResp.json()
      const needle = merchant.toLowerCase()
      const match = Array.isArray(dupRows) && dupRows.some((r: { merchant?: string | null }) => {
        const other = (r.merchant ?? '').toLowerCase()
        return other === needle || (other !== '' && (other.includes(needle) || needle.includes(other)))
      })
      if (match) {
        await markRow(row.id, headers, 'skipped', 'Likely duplicate', null)
        return 'skipped'
      }
    }
  } catch (_err) {
    // A failed duplicate check shouldn't block a legitimate insert.
  }

  const rawOcrJson = {
    raw_text: smsText,
    extracted_digits: cardLast4 ?? '',
    receipt_amount: String(totalRaw),
    card_last4: cardLast4 ?? '',
    card_bank: cardBank ?? '',
    category,
    default_currency: defaultCurrency,
    receipt_currency: receiptCurrency,
    conversion_rate: String(rate),
    converted_total: String(converted),
    line_items: []
  }

  // Ownership is set explicitly rather than left to the receipts_set_owner
  // trigger: that trigger falls back to auth.uid(), which is NULL here because
  // this function runs as service_role, not as the SMS's owner.
  const baseInsertBody = {
    merchant,
    date: normalizedDate,
    total: converted,
    currency: defaultCurrency,
    file_url: null,
    raw_ocr_json: rawOcrJson,
    user_id: owner.userId,
    household_id: owner.householdId,
    visibility: 'household',
    source: 'sms',
    // reviewed_at deliberately left null: this row was parsed by an LLM with
    // nobody looking, so it surfaces in the app's "needs review" queue until a
    // human confirms the merchant, amount and date are right.
  }

  // `receipts` doesn't actually have top-level receipt_amount/default_currency/
  // receipt_currency/conversion_rate/converted_total columns (only category,
  // card_last4, card_bank do) — matching SupabaseService.insertReceiptToDB's
  // own try-with-optional-columns-then-retry-without pattern, since the same
  // schema-cache "column not found" error happens here for the same reason.
  const insertBodyWithOptionalColumns = {
    ...baseInsertBody,
    receipt_amount: totalRaw,
    default_currency: defaultCurrency,
    receipt_currency: receiptCurrency,
    conversion_rate: rate,
    converted_total: converted,
    category,
    card_last4: cardLast4,
    card_bank: cardBank
  }

  const insertBodyLegacy = {
    ...baseInsertBody,
    category,
    card_last4: cardLast4,
    card_bank: cardBank
  }

  try {
    let insertResp = await fetch(`${SUPABASE_URL}/rest/v1/receipts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(insertBodyWithOptionalColumns)
    })
    if (!insertResp.ok) {
      const errBody = await insertResp.text()
      if (isMissingColumnError(insertResp.status, errBody)) {
        insertResp = await fetch(`${SUPABASE_URL}/rest/v1/receipts`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(insertBodyLegacy)
        })
        if (!insertResp.ok) {
          const retryErrBody = await insertResp.text()
          throw new Error(`Insert HTTP ${insertResp.status}: ${retryErrBody.slice(0, 200)}`)
        }
      } else {
        throw new Error(`Insert HTTP ${insertResp.status}: ${errBody.slice(0, 200)}`)
      }
    }
    const inserted = await insertResp.json()
    const receiptId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id
    await markRow(row.id, headers, 'processed', null, receiptId ?? null)
    return 'processed'
  } catch (err) {
    await markRow(row.id, headers, 'failed', `Insert failed: ${err instanceof Error ? err.message : String(err)}`, null)
    return 'failed'
  }
}

type OriginalReceipt = {
  id: string
  merchant: string | null
  total: number
  currency: string | null
  card_last4: string | null
  card_bank: string | null
  category: string | null
  date: string
}

// A reversal SMS doesn't create its own receipt — it cancels one that (should
// have) already been created from the original charge SMS. Rather than mutate
// that original row, this inserts a second, negative receipt that exactly
// negates it (reversal_of_receipt_id ties the two together and stops the same
// original being offset twice), so both the charge and its reversal stay
// visible in history while totals net to zero.
async function processReversal(
  row: SMSInboxRow,
  smsText: string,
  headers: RestHeaders,
  owner: OwnerContext
): Promise<'processed' | 'skipped' | 'failed'> {
  let parsed: Record<string, unknown>
  try {
    const parseResp = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: 'POST',
      headers,
      // Bank alerts routinely omit the year (e.g. "15 Aug 16:55") — the SMS's
      // own arrival time is a far better anchor for inferring it than the
      // parser's own clock, which has no idea when this particular message
      // was actually sent.
      body: JSON.stringify({ raw_text: `SMS Expense Alert:\n${smsText}`, reference_date: row.received_at })
    })
    if (!parseResp.ok) {
      const errBody = await parseResp.text()
      throw new Error(`parse-receipt HTTP ${parseResp.status}: ${errBody.slice(0, 200)}`)
    }
    parsed = await parseResp.json()
  } catch (err) {
    await markRow(row.id, headers, 'failed', `Reversal parse failed: ${err instanceof Error ? err.message : String(err)}`, null)
    return 'failed'
  }

  const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : ''
  const totalRaw = typeof parsed.total === 'number' ? parsed.total : Number(parsed.total)
  if (!merchant || !Number.isFinite(totalRaw) || totalRaw <= 0) {
    await markRow(row.id, headers, 'skipped', 'Reversal — missing amount or merchant', null)
    return 'skipped'
  }

  const receiptCurrency = typeof parsed.currency === 'string' && parsed.currency ? parsed.currency : owner.defaultCurrency
  const rawDate = (typeof parsed.date === 'string' && parsed.date) ? parsed.date : row.received_at
  const parsedDate = new Date(rawDate)
  const normalizedDate = Number.isNaN(parsedDate.getTime()) ? row.received_at : parsedDate.toISOString()

  const { converted } = await convertCurrency(totalRaw, receiptCurrency, owner.defaultCurrency, normalizedDate)

  // Candidates: this owner's own positive-total receipts around the reversal's
  // amount that haven't already been reversed. reversal_of_receipt_id=is.null
  // excludes offset entries themselves (their total is negative anyway).
  let candidates: OriginalReceipt[] = []
  try {
    const scope = owner.householdId ? `household_id=eq.${owner.householdId}` : `user_id=eq.${owner.userId}`
    const from = new Date(new Date(normalizedDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const candResp = await fetch(
      `${SUPABASE_URL}/rest/v1/receipts?select=id,merchant,total,currency,card_last4,card_bank,category,date&${scope}` +
      `&total=gte.${(converted - 0.01).toFixed(2)}&total=lte.${(converted + 0.01).toFixed(2)}` +
      `&reversal_of_receipt_id=is.null&date=gte.${from}&date=lte.${normalizedDate}` +
      `&order=date.desc&limit=10`,
      { headers }
    )
    if (candResp.ok) candidates = await candResp.json()
  } catch (_err) {
    // Fall through — no candidates means we skip below rather than fail.
  }

  const needle = merchant.toLowerCase()
  const match = candidates.find((r) => {
    const other = (r.merchant ?? '').toLowerCase()
    return other === needle || (other !== '' && (other.includes(needle) || needle.includes(other)))
  })

  if (!match) {
    await markRow(row.id, headers, 'skipped', 'Reversal — no matching original charge found', null)
    return 'skipped'
  }

  const offsetBody = {
    merchant: match.merchant ?? merchant,
    date: normalizedDate,
    total: -match.total,
    currency: match.currency ?? owner.defaultCurrency,
    file_url: null,
    category: match.category ?? 'Miscellaneous',
    card_last4: match.card_last4,
    card_bank: match.card_bank,
    user_id: owner.userId,
    household_id: owner.householdId,
    visibility: 'household',
    source: 'sms',
    reversal_of_receipt_id: match.id,
    raw_ocr_json: { raw_text: smsText, reversal_of_receipt_id: match.id, line_items: [] }
  }

  try {
    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/receipts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(offsetBody)
    })
    if (!insertResp.ok) {
      const errBody = await insertResp.text()
      throw new Error(`Insert HTTP ${insertResp.status}: ${errBody.slice(0, 200)}`)
    }
    const inserted = await insertResp.json()
    const receiptId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id
    await markRow(row.id, headers, 'processed', null, receiptId ?? null)
    return 'processed'
  } catch (err) {
    await markRow(row.id, headers, 'failed', `Reversal insert failed: ${err instanceof Error ? err.message : String(err)}`, null)
    return 'failed'
  }
}

function isMissingColumnError(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false
  const normalized = body.toLowerCase()
  return normalized.includes('pgrst204') ||
    normalized.includes('42703') ||
    normalized.includes('schema cache') ||
    (normalized.includes('column') && (normalized.includes('could not find') || normalized.includes('does not exist')))
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } })
}
