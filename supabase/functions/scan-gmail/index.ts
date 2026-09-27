import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Gmail receipt scanner — the server-side replacement for the iOS app's
// GmailReceiptScanner, which only ran while that app was open. Two triggers:
// the twice-daily cron (schedule-scan-gmail-cron.sql), which runs it for
// every connected household member in turn, and the webapp's "Scan now"
// button (Settings > Gmail import), which runs it for just the caller's own
// mailbox — see isCron/callerId below.
//
// Each person's own refresh token is used, so a receipt from sumi's mailbox
// is owned by sumi.
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
// Same cap and reasoning as process-sms-inbox's retry_count: a genuine failure
// gets a few chances (a flaky fetch, a brief parser fault) before the scanner
// gives up and stops re-attempting it every tick. Rate limits don't count
// against this budget at all — see logScan — because a 429 says nothing about
// whether the email is a valid receipt, only that the request timing was bad.
const MAX_PARSE_ATTEMPTS = 3

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

// ---- Was ported from GmailReceiptScanner.swift; redesigned after the
// Redmart/Lazada miss below (see git history for the original) ----
//
// The original filter here was ~30 exact quoted phrases ("order confirmed",
// "order is completed", "payment alert", ...), used both to build the Gmail
// search query and, after fetching, to gate whether to spend an LLM call on a
// message at all. It kept losing to real-world subject lines: a Lazada order
// email titled "your order is confirmed!" matched none of them, because
// Gmail's search treats a quoted multi-word term as an exact phrase — "order
// confirmed" does not match text containing "order is confirmed". Every fix
// was another phrase, for one more retailer's exact wording, forever.
//
// Two changes, matching the two places a decision actually gets made:
//
// 1. The Gmail search query (QUERY_TERMS) still has to be keyword-based —
//    that's a Gmail API constraint, not a choice made here — but it's now a
//    short list of common single words. A single word is far more forgiving
//    of phrasing than a quoted exact phrase: "order" alone matches "order
//    confirmed", "order is confirmed", "your order has shipped", and every
//    other tense/wording variant at once. Gmail's own -category:promotions
//    and -category:social exclusions do the noise-cutting that the long
//    phrase list used to attempt, without having to enumerate every retailer.
//
// 2. The old looksLikeReceipt() keyword-gated whether an already-fetched
//    email was even worth an LLM call — but it's the same brittleness one
//    step later, and it's entirely our own logic, not a Gmail API constraint.
//    It's replaced with the one check that's actually about content rather
//    than wording (does a number resembling money appear anywhere?), and
//    real qualification — "does this describe an actual purchase or
//    transfer" — moves to the LLM itself, which reads meaning rather than
//    matching strings. See parse-receipt's system prompt.

const QUERY_TERMS = [
  'receipt', 'invoice', 'bill', 'order', 'payment', 'paid', 'transaction',
  'confirmed', 'delivered', 'itinerary', 'ticket', 'booking',
  'paynow', 'paylah', 'transfer', 'uen'
]

const AMOUNT_RE =
  /(?:(?:[$€£¥₹]|sgd|s\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|(?:[$€£¥₹]|sgd|s\$)\s?\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/i

// The one cheap, content-based (not wording-based) pre-check: an email with
// no number resembling a monetary amount anywhere in it cannot be a receipt,
// whatever else it says. Everything else is left to the LLM.
function looksLikeReceipt(text: string): boolean {
  return AMOUNT_RE.test(text)
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

// Marketing-template receipts (Lazada order confirmations, Stripe-hosted
// invoices) route every nav link and unsubscribe footer through a tracking
// redirect with a huge query string — individually harmless, but dozens of
// them together can dominate the character budget before real content ever
// gets a chance to be truncated out. None of it is ever receipt information.
function collapseLongUrls(text: string): string {
  return text.replace(/https?:\/\/\S{60,}/g, '[link]')
}

function extractText(payload: GmailPart): string {
  const plainPieces: string[] = []
  const htmlPieces: string[] = []
  function walk(part: GmailPart) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      plainPieces.push(base64UrlDecode(part.body.data))
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlPieces.push(stripHtml(base64UrlDecode(part.body.data)))
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  // multipart/alternative means "pick one representation, not both" — text/plain
  // says the same thing in a fraction of the characters. The previous code
  // concatenated every part it found, which silently doubled the size of every
  // email that included both (nearly all of them) and was consuming truncation
  // budget on a second, HTML-derived copy of content already captured above.
  // HTML is only used when a sender omits the plain part entirely.
  const text = plainPieces.length > 0 ? plainPieces.join('\n') : htmlPieces.join('\n')
  return collapseLongUrls(text)
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

// For the manual "Scan now" button: identifies a normal signed-in caller
// (role=authenticated) so their request can be scoped to their own mailbox
// only, never anyone else's. Safe to trust the token's own claims here
// because the function is deployed with verify_jwt=true — Supabase's gateway
// has already checked the signature and expiry before this code runs.
function callerUserId(req: Request): string | null {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const segments = token.split('.')
  if (segments.length !== 3) return null
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded))
    return claims?.role === 'authenticated' && typeof claims?.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error('scan-gmail: environment is incomplete.')
    return json({ error: 'scan-gmail is not configured' }, 500)
  }

  // Two ways in: the cron job (service_role — verify_jwt alone would let
  // anyone holding the public anon key drive this, since that's also a valid
  // JWT), or a normal signed-in user hitting the "Scan now" button — scoped
  // below to that one person's own mailbox, never the whole household's.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const isCron = timingSafeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY) || jwtRole(bearer) === 'service_role'
  const callerId = isCron ? null : callerUserId(req)
  if (!isCron && !callerId) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const headers = adminHeaders()
  const summary: Record<string, unknown>[] = []

  try {
    const connUrl = isCron
      ? `${SUPABASE_URL}/rest/v1/gmail_connections?select=user_id,email,last_scan_at&revoked_at=is.null`
      : `${SUPABASE_URL}/rest/v1/gmail_connections?select=user_id,email,last_scan_at&revoked_at=is.null&user_id=eq.${callerId}`
    const connResp = await fetch(connUrl, { headers })
    if (!connResp.ok) throw new Error(`gmail_connections fetch failed: ${connResp.status}`)
    const connections = await connResp.json()

    if (!isCron) {
      if (connections.length === 0) {
        return json({ error: 'No Gmail connection found for your account.' }, 404)
      }
      // Cooldown against a double-tap or repeated clicks re-running seconds
      // apart and paying for LLM calls on a diff that hasn't changed yet.
      const lastScanAt = connections[0].last_scan_at
      if (lastScanAt) {
        const secondsSince = (Date.now() - new Date(lastScanAt).getTime()) / 1000
        if (secondsSince < 60) {
          return json({ error: `Already scanned ${Math.ceil(secondsSince)}s ago — try again in a moment.` }, 429)
        }
      }
    }

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
  const out: Record<string, unknown> = { user: conn.email, imported: 0, merged: 0, skipped: 0, failed: 0 }

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
  // Category exclusions do the noise-cutting a longer keyword list used to
  // attempt — bulk marketing and social notifications are excluded by Gmail's
  // own classification rather than by guessing every promotional phrase.
  const query =
    `newer_than:${lookbackDays}d after:${afterDate} {${QUERY_TERMS.join(' ')}} ` +
    `-category:promotions -category:social -category:forums`

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
    else if (outcome === 'merged') (out.merged as number)++
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

  // Keep the diagnostic log bounded — 90 days is far past what a "why didn't
  // this show up" investigation needs, and this runs once per user per tick
  // rather than once per message.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  await fetch(
    `${SUPABASE_URL}/rest/v1/gmail_scan_log?user_id=eq.${conn.user_id}&scanned_at=lt.${cutoff}`,
    { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } }
  ).catch(() => {})

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

interface DupCandidateRow {
  id: string
  merchant?: string | null
  date?: string | null
  card_bank?: string | null
  card_last4?: string | null
  source?: string | null
  reviewed_at?: string | null
  comment?: string | null
  file_url?: string | null
  raw_ocr_json?: unknown
}

// Household-scoped corrections learned from past edits (see
// receipt_correction_rules / match_correction_rules in
// multiuser-14-receipt-comment-and-learning.sql) — passed to parse-receipt
// as learning_hints so a mistake fixed once (by anyone in the household, on
// any of the three ingestion paths) doesn't keep repeating for this merchant.
// Best-effort: a failed lookup must not block parsing a receipt that would
// otherwise succeed.
async function fetchCorrectionHints(
  householdId: string | null,
  rawText: string,
  headers: RestHeaders
): Promise<unknown[]> {
  if (!householdId) return []
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_correction_rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_household_id: householdId, p_raw_text: rawText })
    })
    if (!resp.ok) return []
    const hints = await resp.json()
    return Array.isArray(hints) ? hints : []
  } catch {
    return []
  }
}

// Household-added categories (Settings -> Categories, household_categories
// table) — passed to parse-receipt so it's allowed to use them, not just the
// fixed built-in list. Best-effort, same shape as fetchCorrectionHints.
async function fetchHouseholdCategories(householdId: string | null, headers: RestHeaders): Promise<string[]> {
  if (!householdId) return []
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/household_categories?household_id=eq.${householdId}&select=name`,
      { headers }
    )
    if (!resp.ok) return []
    const rows = await resp.json()
    return Array.isArray(rows) ? rows.map((r: { name?: string }) => r.name).filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

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
): Promise<'imported' | 'merged' | 'skipped' | 'failed'> {
  // Already imported? gmail_message_id is unique per user, so this is the
  // authoritative guard against re-importing on the overlapping window. Not
  // logged: this fires every run for the same handful of messages in the
  // overlap window, and "already have this one" isn't a finding.
  const seen = await fetch(
    `${SUPABASE_URL}/rest/v1/receipts?select=id&gmail_message_id=eq.${messageId}&user_id=eq.${owner.userId}&limit=1`,
    { headers }
  )
  if (seen.ok) {
    const rows = await seen.json()
    if (Array.isArray(rows) && rows.length > 0) return 'skipped'
  }

  // Already tried this exact message MAX_PARSE_ATTEMPTS times and it never
  // became a receipt? Stop here — no Gmail fetch, no LLM call, no new log
  // write. The scan log's existing row already explains why.
  if (await hasExhaustedRetries(owner.userId, messageId, headers)) return 'skipped'

  let rawText = ''
  let receivedISO = new Date().toISOString()
  let subject = ''
  let sender = ''
  try {
    const resp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`)
    const msg = await resp.json()
    const payload = msg.payload ?? {}
    subject = headerValue('subject', payload.headers) ?? 'Gmail receipt'
    sender = headerValue('from', payload.headers) ?? 'Unknown sender'
    const emailDate = headerValue('date', payload.headers) ?? ''
    const body = extractText(payload) || msg.snippet || ''
    if (msg.internalDate) receivedISO = new Date(Number(msg.internalDate)).toISOString()

    // Same envelope the iOS scanner built, so parse-receipt sees familiar input.
    rawText = `Email Subject: ${subject}\nEmail From: ${sender}\nEmail Date: ${emailDate}\n\n${body}`
      .slice(0, MAX_RAW_TEXT_CHARS)
  } catch (err) {
    // No subject/sender yet — the fetch that would have gotten them is what
    // failed — so the log entry is necessarily bare beyond the message id.
    await logScan(owner.userId, messageId, null, null, null,
      'Could not fetch this email from Gmail.', headers)
    console.error(`Gmail message ${messageId} fetch failed: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }

  if (!looksLikeReceipt(rawText.toLowerCase())) {
    await logScan(owner.userId, messageId, subject, sender, receivedISO,
      "No amount found in this email, so it can't be a receipt.", headers)
    return 'skipped'
  }

  const [learningHints, householdCategories] = await Promise.all([
    fetchCorrectionHints(owner.householdId, rawText, headers),
    fetchHouseholdCategories(owner.householdId, headers)
  ])

  let parsed: Record<string, unknown>
  try {
    const parseResp = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: 'POST',
      headers,
      // The email's own internalDate is a far better anchor for inferring a
      // missing year than the parser's own clock — same reasoning as
      // process-sms-inbox's reference_date.
      body: JSON.stringify({
        raw_text: rawText,
        reference_date: receivedISO,
        learning_hints: learningHints,
        household_categories: householdCategories
      })
    })
    if (!parseResp.ok) {
      // A 429 says the LLM provider was rate limited or out of quota at this
      // exact moment — nothing about whether the email is a valid receipt.
      // Logged distinctly and NOT counted against the retry budget, so it
      // keeps being retried on the next tick like a fresh message, rather
      // than one bad-luck rate limit permanently burying a real receipt.
      if (parseResp.status === 429) {
        await logScan(owner.userId, messageId, subject, sender, receivedISO,
          'The receipt parser was rate limited — will retry automatically on the next scan.',
          headers, true)
        return 'failed'
      }
      // parse-receipt's error body carries a `truncated` flag (its response
      // was cut off mid-JSON by its own token budget, distinct from every
      // other failure mode) — worth a specific message rather than the same
      // bucket as "couldn't reach the parser at all", since the fix for each
      // is different and this is exactly what was previously indistinguishable.
      const errBody = await parseResp.json().catch(() => null)
      const reason = errBody?.truncated
        ? "The receipt was too large for the parser to finish reading (response was cut off)."
        : errBody?.upstream_status === 413
        ? 'This email was too large for the parser to read at all.'
        : `The receipt parser returned an error (HTTP ${parseResp.status}).`
      await logScan(owner.userId, messageId, subject, sender, receivedISO, reason, headers)
      console.error(`parse-receipt HTTP ${parseResp.status} for ${messageId}: ${JSON.stringify(errBody)}`)
      return 'failed'
    }
    parsed = await parseResp.json()
  } catch (err) {
    // Only genuine network/unreachable failures land here now — every
    // response-received-but-not-ok case is handled, and logged distinctly,
    // above.
    await logScan(owner.userId, messageId, subject, sender, receivedISO,
      'Could not reach the receipt parser.', headers)
    console.error(`parse-receipt unreachable for ${messageId}: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }

  const derivationNote = typeof parsed.derivation_note === 'string' ? parsed.derivation_note : null

  const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : ''
  const totalRaw = typeof parsed.total === 'number' ? parsed.total : Number(parsed.total)
  if (!merchant || !Number.isFinite(totalRaw) || totalRaw <= 0) {
    await logScan(owner.userId, messageId, subject, sender, receivedISO,
      'Looked like a receipt, but no merchant or amount could be read from it.', headers)
    return 'skipped'
  }

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
      `${SUPABASE_URL}/rest/v1/receipts?select=id,merchant,date,card_bank,card_last4,source,reviewed_at,comment,file_url,raw_ocr_json&${scope}` +
      `&total=gte.${(converted - 0.01).toFixed(2)}&total=lte.${(converted + 0.01).toFixed(2)}` +
      `&date=gte.${from}&date=lte.${to}&limit=10`,
      { headers }
    )
    if (dupResp.ok) {
      const dupRows = await dupResp.json()
      const needle = merchant.toLowerCase()
      const cardKey = cardBank && cardLast4 ? `${cardBank.toLowerCase()}|${cardLast4}` : null
      const candidates = Array.isArray(dupRows) ? (dupRows as DupCandidateRow[]).filter((r: DupCandidateRow) => {
        const other = (r.merchant ?? '').toLowerCase()
        if (other === needle || (other !== '' && (other.includes(needle) || needle.includes(other)))) return true
        // Merchant text disagrees between sources more often than it should — e.g. an
        // SMS names the actual merchant ("Transit") while the bank's own email names
        // the bank instead ("UOB"), for the same charge. Same card + same amount + same
        // calendar date is an independent signal strong enough to catch that case even
        // when merchant text shares nothing.
        if (cardKey && r.card_bank && r.card_last4 && utcDay(r.date) === utcDay(normalizedDate)) {
          return `${r.card_bank.toLowerCase()}|${r.card_last4}` === cardKey
        }
        return false
      }) : []
      // Two thinner copies of one charge can exist (e.g. two SMS alerts) —
      // prefer the one still waiting for review, then the closest in time.
      const distance = (r: DupCandidateRow) => Math.abs(new Date(r.date ?? '').getTime() - d.getTime()) || 0
      candidates.sort((a, b) =>
        Number(a.reviewed_at != null) - Number(b.reviewed_at != null) || distance(a) - distance(b)
      )
      const matchRow = candidates[0]
      if (matchRow) {
        // An SMS alert is the least informative of the three sources — terse,
        // no line items, often names the bank instead of the merchant. Rather
        // than discard a richer email parse of the same charge, fold it into
        // the SMS-created row instead of leaving two records (or losing the
        // better data). An existing gmail/photo/manual row is never downgraded
        // this way — this import doesn't out-rank those, so it's left a plain
        // skip, same as before.
        if (matchRow.source === 'sms') {
          const merged = await mergeIntoExistingReceipt(matchRow, messageId, {
            merchant, date: normalizedDate, total: converted, category,
            cardBank, cardLast4, comment: derivationNote, rawText,
            receiptCurrency, defaultCurrency: owner.defaultCurrency,
            conversionRate: rate, convertedTotal: converted,
            totalRaw, source: 'gmail', headers
          })
          // Not logged, same as a plain successful import: gmail_scan_log is
          // deliberately a "what went wrong" list, and a merge is a success —
          // it enriched an existing receipt, nothing here needs explaining.
          if (merged) return 'merged'
        }
        await logScan(owner.userId, messageId, subject, sender, receivedISO,
          `Matched an existing receipt from "${matchRow.merchant ?? 'another source'}" — treated as a duplicate.`, headers)
        return 'skipped'
      }
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
    comment: derivationNote,
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
    // A unique violation here means a concurrent run already imported it —
    // not logged, for the same reason the earlier "already imported" check
    // isn't: it's not a finding, it's this same message racing itself.
    if (insert.status === 409) return 'skipped'
    await logScan(owner.userId, messageId, subject, sender, receivedISO,
      'Parsed successfully, but saving the receipt failed.', headers)
    console.error(`insert failed for ${messageId}: ${insert.status} ${(await insert.text()).slice(0, 200)}`)
    return 'failed'
  }
  return 'imported'
}

// Folds a richer Gmail parse into an existing SMS-sourced receipt instead of
// leaving two records for the same charge. Two different write modes depending
// on whether a human has already reviewed the SMS-created row:
//
// - Not yet reviewed (reviewed_at is null): the email's structured fields win
//   outright — merchant, category, card info, source flips to 'gmail' — same
//   as if the email had been imported first. reviewed_at is left null; this
//   is still an unattended import, nobody has confirmed it.
// - Already reviewed: a human already confirmed this receipt's merchant/
//   category/etc, so those are left untouched. Only raw, non-interpretive
//   content is attached (the email's own text/line items, and a receipt
//   image/file if the SMS-created row didn't already have one).
//
// Idempotent by design: the scanner re-lists messages inside its lookback
// window on every run (see the "already imported" comment above), so the
// same email can be handed to this function more than once. raw_ocr_json's
// merged_from list is checked first and is what makes a repeat call a no-op
// rather than double-appending the same comment/line items.
async function mergeIntoExistingReceipt(
  existing: DupCandidateRow,
  messageId: string,
  candidate: {
    merchant: string
    date: string
    total: number
    category: string
    cardBank: string | null
    cardLast4: string | null
    comment: string | null
    rawText: string
    receiptCurrency: string
    defaultCurrency: string
    conversionRate: number
    convertedTotal: number
    totalRaw: number
    source: 'gmail'
    headers: RestHeaders
  }
): Promise<boolean> {
  const existingRaw = (existing.raw_ocr_json && typeof existing.raw_ocr_json === 'object'
    ? existing.raw_ocr_json as Record<string, unknown>
    : {}) as Record<string, unknown>
  const mergedFrom = Array.isArray(existingRaw.merged_from) ? existingRaw.merged_from as unknown[] : []
  const alreadyMerged = mergedFrom.some((m) =>
    m && typeof m === 'object' && (m as Record<string, unknown>).source === candidate.source &&
    (m as Record<string, unknown>).ref === messageId
  )
  if (alreadyMerged) return true

  const rawOcrJson = {
    ...existingRaw,
    merged_from: [...mergedFrom, { source: candidate.source, ref: messageId, merged_at: new Date().toISOString() }]
  }

  const commentLabel = 'email'
  const mergedComment = candidate.comment && !(existing.comment ?? '').includes(candidate.comment)
    ? (existing.comment ? `${existing.comment}\n\n[Also seen via ${commentLabel}] ${candidate.comment}` : candidate.comment)
    : existing.comment

  const body: Record<string, unknown> = existing.reviewed_at
    ? {
        // Reviewed — only raw content and provenance may change.
        raw_ocr_json: rawOcrJson,
        comment: mergedComment,
        // The message id is provenance, not a reviewed field: it's what makes
        // this merge idempotent on the next scan, regardless of whether this
        // receipt belongs to the caller or a household-mate.
        gmail_message_id: messageId
      }
    : {
        // Not yet reviewed — the email's own read of the charge wins.
        merchant: candidate.merchant,
        date: candidate.date,
        total: candidate.total,
        currency: candidate.defaultCurrency,
        category: candidate.category,
        card_bank: candidate.cardBank,
        card_last4: candidate.cardLast4,
        source: candidate.source,
        gmail_message_id: messageId,
        comment: mergedComment,
        raw_ocr_json: {
          ...rawOcrJson,
          raw_text: candidate.rawText,
          extracted_digits: candidate.cardLast4 ?? '',
          receipt_amount: String(candidate.totalRaw),
          card_last4: candidate.cardLast4 ?? '',
          card_bank: candidate.cardBank ?? '',
          category: candidate.category,
          default_currency: candidate.defaultCurrency,
          receipt_currency: candidate.receiptCurrency,
          conversion_rate: String(candidate.conversionRate),
          converted_total: String(candidate.convertedTotal)
        }
      }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/receipts?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { ...candidate.headers, Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  })
  return resp.ok
}

// Diagnostic trail for "why didn't this email become a receipt" — see
// multiuser-11-gmail-scan-log.sql. Best-effort: a logging failure must never
// take down the scan itself, so this never throws.
// Upsert rather than always-insert: repeated failures on the same message
// update one row (bumping retry_count) instead of piling up duplicate log
// entries every 15 minutes, and retry_count is what hasExhaustedRetries()
// checks to stop re-attempting a message that's genuinely never going to
// succeed. isRateLimited messages do NOT bump retry_count — a 429 says
// nothing about whether the email is a valid receipt, only that the request
// landed at a bad moment, and it should keep being retried like new.
async function logScan(
  userId: string,
  messageId: string,
  subject: string | null,
  sender: string | null,
  emailDate: string | null,
  reason: string,
  headers: RestHeaders,
  isRateLimited = false
): Promise<void> {
  try {
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/gmail_scan_log?select=retry_count&user_id=eq.${userId}&message_id=eq.${messageId}&limit=1`,
      { headers }
    )
    const existingRows = existingResp.ok ? await existingResp.json() : []
    const existing = Array.isArray(existingRows) ? existingRows[0] : null

    const body = {
      user_id: userId,
      message_id: messageId,
      subject,
      sender,
      email_date: emailDate,
      reason,
      scanned_at: new Date().toISOString(),
      retry_count: existing
        ? (isRateLimited ? existing.retry_count : existing.retry_count + 1)
        : (isRateLimited ? 0 : 1)
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/gmail_scan_log?on_conflict=user_id,message_id`,
      {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body)
      }
    )
  } catch (_err) {
    // Never block the scan on a logging failure.
  }
}

// The cheap early-exit that actually saves the wasted work: no Gmail fetch,
// no LLM call, not even a log write, for a message that's already used up its
// retries. The existing log row (with its original reason and timestamp)
// speaks for it — this is the "carry the error, don't rescan" the UI shows.
async function hasExhaustedRetries(userId: string, messageId: string, headers: RestHeaders): Promise<boolean> {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/gmail_scan_log?select=retry_count&user_id=eq.${userId}&message_id=eq.${messageId}&limit=1`,
      { headers }
    )
    if (!resp.ok) return false
    const rows = await resp.json()
    const row = Array.isArray(rows) ? rows[0] : null
    return typeof row?.retry_count === 'number' && row.retry_count >= MAX_PARSE_ATTEMPTS
  } catch {
    return false
  }
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

// Calendar day (UTC) of a stored or incoming date. The card+same-day duplicate
// rule used to compare raw strings, which never matched: PostgREST returns
// '2026-09-27T00:00:00+00:00' where toISOString() gives '...T00:00:00.000Z'.
function utcDay(value: string | null | undefined): string | null {
  const t = new Date(value ?? '')
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10)
}
