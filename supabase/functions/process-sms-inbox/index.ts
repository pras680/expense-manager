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
const BATCH_LIMIT = 25
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

type SMSInboxRow = { id: string; body: string; sender: string | null; received_at: string }
type RestHeaders = { apikey: string; Authorization: string; 'Content-Type': string }

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
    const rowsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_inbox?select=id,body,sender,received_at&status=eq.pending&order=received_at.asc&limit=${BATCH_LIMIT}`,
      { headers }
    )
    if (!rowsResp.ok) throw new Error(`Failed to fetch sms_inbox: HTTP ${rowsResp.status}`)
    const rows: SMSInboxRow[] = await rowsResp.json()
    const defaultCurrency = await getDefaultCurrency(headers)

    for (const row of rows) {
      // Atomically claim the row (pending -> processing) so two overlapping
      // invocations can't both process the same message.
      const claimed = await claimRow(row.id, headers)
      if (!claimed) continue

      const outcome = await processRow(row, headers, defaultCurrency)
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

async function getDefaultCurrency(headers: RestHeaders): Promise<string> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?select=value&key=eq.default_currency`, { headers })
    if (!resp.ok) return 'SGD'
    const rows = await resp.json()
    const value = rows?.[0]?.value
    return typeof value === 'string' && value ? value : 'SGD'
  } catch (_err) {
    return 'SGD'
  }
}

async function claimRow(id: string, headers: RestHeaders): Promise<boolean> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/sms_inbox?id=eq.${id}&status=eq.pending`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'processing' })
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
  defaultCurrency: string
): Promise<'processed' | 'skipped' | 'failed'> {
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
    await markRow(row.id, headers, 'skipped', 'Reversal — not auto-processed', null)
    return 'skipped'
  }

  let parsed: Record<string, unknown>
  try {
    const parseResp = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ raw_text: `SMS Expense Alert:\n${smsText}` })
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
        const pmResp = await fetch(
          `${SUPABASE_URL}/rest/v1/payment_methods?select=id,last_digits,bank_name,card_name&last_digits=eq.${normalizedLast4}`,
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

  // Simplified duplicate guard: same total (+/- 0.01) within a 1-day window.
  try {
    const d = new Date(normalizedDate)
    const from = new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString()
    const dupResp = await fetch(
      `${SUPABASE_URL}/rest/v1/receipts?select=id&total=gte.${(converted - 0.01).toFixed(2)}&total=lte.${(converted + 0.01).toFixed(2)}&date=gte.${from}&date=lte.${to}&limit=1`,
      { headers }
    )
    if (dupResp.ok) {
      const dupRows = await dupResp.json()
      if (Array.isArray(dupRows) && dupRows.length > 0) {
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

  const baseInsertBody = {
    merchant,
    date: normalizedDate,
    total: converted,
    currency: defaultCurrency,
    file_url: null,
    raw_ocr_json: rawOcrJson
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
