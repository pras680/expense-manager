import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Scheduled Gmail receipt scanner — the server-side replacement for the iOS
// app's GmailReceiptScanner, which only ran while that app was open.
//
// Runs for every connected household member in turn, using each person's own
// refresh token, so a receipt from sumi's mailbox is owned by sumi. The search
// query and the receipt/payment-alert keyword filters below are ported verbatim
// from GmailReceiptScanner.swift so results match what the iOS app produced.
//
// Imported receipts land with source='gmail' and reviewed_at=null, i.e. in the
// web app's "needs check" queue — nobody has verified the LLM's reading of them.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID')
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET')

// Each message costs a Gemini call, and pg_net drops the connection on timeout,
// so a run has to stay well inside the cron's window. A backlog just drains
// over successive ticks.
const MAX_MESSAGES_PER_USER = 8
const DEFAULT_LOOKBACK_DAYS = 7
const MAX_RAW_TEXT_CHARS = 18_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

// ---- Ported from GmailReceiptScanner.swift ----

const QUERY_TERMS = [
  'receipt', 'invoice', 'bill', '"tax invoice"', '"order confirmation"', '"payment confirmation"',
  'itinerary', '"flight itinerary"', '"travel itinerary"', '"booking confirmation"', '"e-ticket"', '"air ticket"',
  'paynow', '"pay now"', 'paylah', '"fund transfer"', '"funds transfer"', '"bank transfer"',
  '"fast transfer"', '"transfer successful"', '"successful transfer"', '"payment alert"', '"transaction alert"',
  '"transaction notification"', '"debit advice"', '"paid to"', '"sent to"', '"transferred to"', 'uen',
  '"credit card payment"', '"card bill payment"', '"payment to credit card"'
]

const RECEIPT_TERMS = [
  'receipt', 'invoice', 'bill', 'tax invoice', 'payment confirmation', 'payment received',
  'order confirmation', 'booking confirmation', 'flight itinerary', 'travel itinerary',
  'itinerary', 'e-ticket', 'air ticket', 'amount paid', 'total paid'
]

const PAYMENT_ALERT_TERMS = [
  'paynow', 'pay now', 'paylah', 'fund transfer', 'funds transfer', 'bank transfer',
  'fast transfer', 'transfer successful', 'successful transfer', 'payment alert',
  'transaction alert', 'transaction notification', 'debit advice', 'you have paid',
  'paid to', 'sent to', 'transferred to', 'payment to', 'uen', 'credit card payment',
  'card bill payment', 'payment to credit card', 'credit card bill'
]

const AMOUNT_RE =
  /(?:(?:[$€£¥₹]|sgd|s\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|(?:[$€£¥₹]|sgd|s\$)\s?\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/i

function containsAny(terms: string[], text: string): boolean {
  return terms.some((t) => text.includes(t))
}

function looksLikeReceipt(text: string): boolean {
  return (containsAny(RECEIPT_TERMS, text) || containsAny(PAYMENT_ALERT_TERMS, text)) && AMOUNT_RE.test(text)
}

function base64UrlDecode(encoded: string): string {
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
  headers?: { name: string; value: string }[]
}

function extractText(payload: GmailPart): string {
  const pieces: string[] = []
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    pieces.push(base64UrlDecode(payload.body.data))
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    pieces.push(stripHtml(base64UrlDecode(payload.body.data)))
  }
  for (const part of payload.parts ?? []) {
    const t = extractText(part)
    if (t) pieces.push(t)
  }
  return pieces.join('\n')
}

function headerValue(name: string, headers?: { name: string; value: string }[]): string | null {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

// ---- Currency (mirrors process-sms-inbox / CurrencyConversionService) ----

const FALLBACK_RATES_TO_SGD: Record<string, number> = {
  SGD: 1, USD: 1.35, EUR: 1.46, GBP: 1.71, AUD: 0.89, CAD: 0.99, JPY: 0.0091,
  CNY: 0.19, HKD: 0.17, INR: 0.016, MYR: 0.29, THB: 0.037, IDR: 0.000083,
  PHP: 0.023, VND: 0.000053, KRW: 0.00098, AED: 0.37
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function convertCurrency(amount: number, from: string, to: string, onDateISO: string) {
  if (from === to) return { rate: 1, converted: round2(amount) }
  const now = new Date()
  const parsed = new Date(onDateISO)
  const clamped = Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() ? now : parsed
  try {
    const resp = await fetch(`https://api.frankfurter.app/${clamped.toISOString().slice(0, 10)}?from=${from}&to=${to}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = data?.rates?.[to]
    if (typeof rate !== 'number') throw new Error('missing rate')
    return { rate, converted: round2(amount * rate) }
  } catch {
    const rate = (FALLBACK_RATES_TO_SGD[from] ?? 1) / (FALLBACK_RATES_TO_SGD[to] ?? 1)
    return { rate, converted: round2(amount * rate) }
  }
}

// ---- Main ----

type RestHeaders = Record<string, string>

function adminHeaders(): RestHeaders {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
    'Content-Type': 'application/json'
  }
}

function jwtRole(token: string): string | null {
  const segments = token.split('.')
  if (segments.length !== 3) return null
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    return JSON.parse(atob(padded))?.role ?? null
  } catch {
    return null
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error('scan-gmail: environment is incomplete.')
    return json({ error: 'scan-gmail is not configured' }, 500)
  }

  // Cron-only, same reasoning as process-sms-inbox: verify_jwt alone would let
  // anyone holding the public anon key drive this.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!timingSafeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY) && jwtRole(bearer) !== 'service_role') {
    return json({ error: 'Unauthorized' }, 401)
  }

  const headers = adminHeaders()
  const summary: Record<string, unknown>[] = []

  try {
    const connResp = await fetch(
      `${SUPABASE_URL}/rest/v1/gmail_connections?select=user_id,email,last_scan_at&revoked_at=is.null`,
      { headers }
    )
    if (!connResp.ok) throw new Error(`gmail_connections fetch failed: ${connResp.status}`)
    const connections = await connResp.json()

    for (const conn of connections) {
      summary.push(await scanForUser(conn, headers))
    }

    return json({ users: connections.length, results: summary })
  } catch (err) {
    console.error(`scan-gmail failed: ${err instanceof Error ? err.message : String(err)}`)
    return json({ error: 'scan-gmail failed', results: summary }, 500)
  }
})

async function scanForUser(
  conn: { user_id: string; email: string; last_scan_at: string | null },
  headers: RestHeaders
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { user: conn.email, imported: 0, skipped: 0, failed: 0 }

  const accessToken = await accessTokenFor(conn.user_id, headers)
  if (!accessToken) {
    // Most likely the user revoked access at Google, or the refresh token
    // expired because the consent screen is still in "Testing". Surfaced on the
    // Settings screen rather than failing silently forever.
    await recordError(conn.user_id, 'Gmail access expired — please reconnect.', headers)
    out.error = 'reconnect_required'
    return out
  }

  // Overlap the window by a day: a message that arrived while the previous run
  // was mid-flight would otherwise be skipped forever. Duplicate protection
  // downstream makes the overlap harmless.
  const since = conn.last_scan_at
    ? new Date(new Date(conn.last_scan_at).getTime() - 24 * 60 * 60 * 1000)
    : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const afterDate = since.toISOString().slice(0, 10).replace(/-/g, '/')
  const lookbackDays = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)))
  const query = `newer_than:${lookbackDays}d after:${afterDate} {${QUERY_TERMS.join(' ')}}`

  let ids: string[] = []
  try {
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
    listUrl.searchParams.set('q', query)
    listUrl.searchParams.set('maxResults', String(MAX_MESSAGES_PER_USER))
    const listResp = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!listResp.ok) throw new Error(`list failed: ${listResp.status}`)
    const listed = await listResp.json()
    ids = (listed.messages ?? []).map((m: { id: string }) => m.id)
  } catch (err) {
    console.error(`Gmail list failed for ${conn.email}: ${err instanceof Error ? err.message : err}`)
    await recordError(conn.user_id, 'Could not search Gmail.', headers)
    out.error = 'list_failed'
    return out
  }

  const owner = await loadOwnerContext(conn.user_id, headers)

  for (const id of ids) {
    const outcome = await processMessage(id, accessToken, owner, headers)
    if (outcome === 'imported') (out.imported as number)++
    else if (outcome === 'failed') (out.failed as number)++
    else (out.skipped as number)++
  }

  // Advance the watermark only after a clean pass, so a failure re-scans rather
  // than skipping the window.
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${conn.user_id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ last_scan_at: new Date().toISOString(), last_error: null })
  })

  return out
}

async function accessTokenFor(userId: string, headers: RestHeaders): Promise<string | null> {
  const tokenResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_gmail_refresh_token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user_id: userId })
  })
  if (!tokenResp.ok) return null
  const refreshToken = await tokenResp.json()
  if (typeof refreshToken !== 'string' || !refreshToken) return null

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID!,
      client_secret: GMAIL_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  })
  if (!resp.ok) {
    console.error(`Gmail token refresh failed: ${resp.status}`)
    return null
  }
  const data = await resp.json()
  return data.access_token ?? null
}

type OwnerContext = { userId: string; householdId: string | null; defaultCurrency: string }

async function loadOwnerContext(userId: string, headers: RestHeaders): Promise<OwnerContext> {
  const fallback: OwnerContext = { userId, householdId: null, defaultCurrency: 'SGD' }
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?select=default_currency,active_household_id&user_id=eq.${userId}&limit=1`,
      { headers }
    )
    if (!resp.ok) return fallback
    const rows = await resp.json()
    const s = rows?.[0]
    if (!s) return fallback
    return {
      userId,
      householdId: s.active_household_id ?? null,
      defaultCurrency: s.default_currency || 'SGD'
    }
  } catch {
    return fallback
  }
}

async function processMessage(
  messageId: string,
  accessToken: string,
  owner: OwnerContext,
  headers: RestHeaders
): Promise<'imported' | 'skipped' | 'failed'> {
  // Already imported? gmail_message_id is unique per user, so this is the
  // authoritative guard against re-importing on the overlapping window.
  const seen = await fetch(
    `${SUPABASE_URL}/rest/v1/receipts?select=id&gmail_message_id=eq.${messageId}&user_id=eq.${owner.userId}&limit=1`,
    { headers }
  )
  if (seen.ok) {
    const rows = await seen.json()
    if (Array.isArray(rows) && rows.length > 0) return 'skipped'
  }

  let rawText = ''
  let receivedISO = new Date().toISOString()
  try {
    const resp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`)
    const msg = await resp.json()
    const payload = msg.payload ?? {}
    const subject = headerValue('subject', payload.headers) ?? 'Gmail receipt'
    const sender = headerValue('from', payload.headers) ?? 'Unknown sender'
    const emailDate = headerValue('date', payload.headers) ?? ''
    const body = extractText(payload) || msg.snippet || ''
    if (msg.internalDate) receivedISO = new Date(Number(msg.internalDate)).toISOString()

    // Same envelope the iOS scanner built, so parse-receipt sees familiar input.
    rawText = `Email Subject: ${subject}\nEmail From: ${sender}\nEmail Date: ${emailDate}\n\n${body}`
      .slice(0, MAX_RAW_TEXT_CHARS)
  } catch (err) {
    console.error(`Gmail message ${messageId} fetch failed: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }

  if (!looksLikeReceipt(rawText.toLowerCase())) return 'skipped'

  let parsed: Record<string, unknown>
  try {
    const parseResp = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: 'POST',
      headers,
      // The email's own internalDate is a far better anchor for inferring a
      // missing year than the parser's own clock — same reasoning as
      // process-sms-inbox's reference_date.
      body: JSON.stringify({ raw_text: rawText, reference_date: receivedISO })
    })
    if (!parseResp.ok) throw new Error(`parse-receipt HTTP ${parseResp.status}`)
    parsed = await parseResp.json()
  } catch (err) {
    console.error(`parse failed for ${messageId}: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }

  const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : ''
  const totalRaw = typeof parsed.total === 'number' ? parsed.total : Number(parsed.total)
  if (!merchant || !Number.isFinite(totalRaw) || totalRaw <= 0) return 'skipped'

  const receiptCurrency = (typeof parsed.currency === 'string' && parsed.currency) || owner.defaultCurrency
  const category = (typeof parsed.category === 'string' && parsed.category) || 'Miscellaneous'
  const dateISO = typeof parsed.date === 'string' && parsed.date
    ? new Date(parsed.date).toISOString()
    : receivedISO
  const normalizedDate = Number.isNaN(new Date(dateISO).getTime()) ? receivedISO : dateISO

  let cardLast4: string | null = null
  const rawDigits = (typeof parsed.card_last4 === 'string' && parsed.card_last4)
    || (typeof parsed.extracted_digits === 'string' ? parsed.extracted_digits : '')
  if (rawDigits) {
    const d = String(rawDigits).replace(/[^0-9]/g, '').slice(-4)
    if (d.length === 4) cardLast4 = d
  }
  let cardBank = typeof parsed.card_bank === 'string' && parsed.card_bank ? parsed.card_bank : null
  if (cardLast4) {
    const scope = owner.householdId ? `&household_id=eq.${owner.householdId}` : '&household_id=is.null'
    const pm = await fetch(
      `${SUPABASE_URL}/rest/v1/payment_methods?select=bank_name&last_digits=eq.${cardLast4}${scope}`,
      { headers }
    )
    if (pm.ok) {
      const rows = await pm.json()
      cardBank = rows?.[0]?.bank_name ?? cardBank ?? 'Unknown Bank'
    }
  }

  const { rate, converted } = await convertCurrency(
    totalRaw, receiptCurrency, owner.defaultCurrency, normalizedDate
  )

  // Cross-source duplicate guard — mirrors process-sms-inbox's: the same
  // charge often reaches this owner as both a bank SMS and a receipt email
  // (e.g. "NOVOWATT EV CHARGING SINGAPORE SGP" via SMS vs "Novowatt" via
  // Gmail), and gmail_message_id alone only stops re-importing the same
  // email twice, not the same real-world charge arriving from two sources.
  try {
    const scope = owner.householdId ? `household_id=eq.${owner.householdId}` : `user_id=eq.${owner.userId}`
    const d = new Date(normalizedDate)
    const from = new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString()
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
      if (match) return 'skipped'
    }
  } catch (_err) {
    // A failed duplicate check shouldn't block a legitimate import.
  }

  const body = {
    merchant,
    date: normalizedDate,
    total: converted,
    currency: owner.defaultCurrency,
    file_url: null,
    category,
    card_last4: cardLast4,
    card_bank: cardBank,
    user_id: owner.userId,
    household_id: owner.householdId,
    visibility: 'household',
    source: 'gmail',
    gmail_message_id: messageId,
    raw_ocr_json: {
      raw_text: rawText,
      extracted_digits: cardLast4 ?? '',
      receipt_amount: String(totalRaw),
      card_last4: cardLast4 ?? '',
      card_bank: cardBank ?? '',
      category,
      default_currency: owner.defaultCurrency,
      receipt_currency: receiptCurrency,
      conversion_rate: String(rate),
      converted_total: String(converted),
      line_items: []
    }
  }

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/receipts`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  })
  if (!insert.ok) {
    // A unique violation here means a concurrent run already imported it.
    if (insert.status === 409) return 'skipped'
    console.error(`insert failed for ${messageId}: ${insert.status} ${(await insert.text()).slice(0, 200)}`)
    return 'failed'
  }
  return 'imported'
}

async function recordError(userId: string, message: string, headers: RestHeaders) {
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ last_error: message })
  }).catch(() => {})
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extra } })
}
