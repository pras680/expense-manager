import { env } from './env'
import { receiptFromRow } from './receiptShape'
import { randomId } from './id'
import type { Receipt, ParsedReceipt, PaymentMethod, ReceiptSource } from '../types/receipt'

const REST_URL = `${env.supabaseUrl}/rest/v1`
const FUNCTIONS_URL = `${env.supabaseUrl}/functions/v1`
const BUCKET = 'receipt-documents'

/** Thrown when there is no usable session. Callers should route the user to sign in. */
export class AuthRequiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

// AuthProvider registers a provider that returns a *fresh* token, refreshing it
// first if it is close to expiry. Going through a provider rather than a cached
// string closes two holes at once: requests can no longer go out with a token
// that expired since the last 5-minute refresh tick, and there is no import
// cycle between this module and the auth module.
type TokenProvider = () => Promise<string | null>

let tokenProvider: TokenProvider | null = null
let onAuthFailure: (() => void) | null = null

export function configureAuth(provider: TokenProvider | null, onFailure: (() => void) | null): void {
  tokenProvider = provider
  onAuthFailure = onFailure
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = tokenProvider ? await tokenProvider() : null
  if (!token) {
    // Deliberately no anon-key fallback. Falling back would silently downgrade
    // the request to the anon role, which post-migration reads as "no rows"
    // rather than an error — data would just look like it had vanished.
    onAuthFailure?.()
    throw new AuthRequiredError()
  }
  return { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}`, ...extra }
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders((init.headers as Record<string, string>) ?? {})
  const resp = await fetch(url, { ...init, headers })
  if (resp.status === 401) {
    onAuthFailure?.()
    throw new AuthRequiredError()
  }
  return resp
}

async function throwIfNotOk(resp: Response, prefix: string) {
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`${prefix}: HTTP ${resp.status} ${body.slice(0, 300)}`)
  }
}

function isMissingColumnError(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('pgrst204') || m.includes('42703') || m.includes('schema cache') ||
    (m.includes('column') && (m.includes('could not find') || m.includes('does not exist')))
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

// receipts only has category/card_last4/card_bank as real optional top-level
// columns (confirmed against the live schema) — default_currency/receipt_amount/
// receipt_currency/conversion_rate/converted_total live only inside raw_ocr_json,
// so there's no reason to ever request them here (unlike insert/update, which
// still probe for them in case the schema changes and fall back on a miss).
const RECEIPTS_SELECT =
  'id,merchant,date,total,currency,file_url,raw_ocr_json,card_last4,card_bank,category,user_id,household_id,visibility,source,reviewed_at,comment'

export async function listReceipts(): Promise<Receipt[]> {
  // RLS decides what comes back: own rows plus household-shared ones. No client
  // filter needed, and adding one would be a false sense of security anyway.
  const resp = await authorizedFetch(`${REST_URL}/receipts?select=${encodeURIComponent(RECEIPTS_SELECT)}`)
  await throwIfNotOk(resp, 'Fetch receipts failed')
  const rows = await resp.json()
  if (!Array.isArray(rows)) return []
  return rows.map(receiptFromRow).filter((r): r is Receipt => r !== null)
}

export interface ReceiptWriteInput {
  merchant: string
  date: string // ISO string
  total: number
  receiptAmount: number
  currency: string
  defaultCurrency: string
  receiptCurrency: string
  conversionRate: number
  convertedTotal: number
  category: string
  cardLast4: string | null
  cardBank: string | null
  /** Only meaningful when category is 'Local Transfer'. */
  transferFromBank: string | null
  transferToBank: string | null
  transferKind: 'self' | 'external' | null
  rawText: string
  lineItems: { description: string; amount: number | null }[]
  fileUrl: string | null
  visibility: 'private' | 'household'
  /** Preserve the original provenance on edit — an SMS receipt stays 'sms'. */
  source?: ReceiptSource
  comment: string
}

function buildReceiptBody(input: ReceiptWriteInput, includeOptionalColumns: boolean) {
  // user_id and household_id are intentionally absent: the receipts_set_owner
  // trigger stamps them from auth.uid() server-side. Sending them from the
  // client would be both redundant and rejected by the insert policy if wrong.
  const body: Record<string, unknown> = {
    merchant: input.merchant,
    date: input.date,
    total: input.total,
    currency: input.receiptCurrency || input.currency,
    file_url: input.fileUrl,
    visibility: input.visibility,
    source: input.source ?? 'manual',
    comment: input.comment || null,
    // Confirmed real top-level columns on every deployed environment (unlike
    // the truly-optional ones below) — these must always be sent, never
    // gated behind includeOptionalColumns. They used to live in that block
    // too, which meant a schema-cache miss on one of the *actually* optional
    // columns (e.g. receipt_amount, missing on some deployments) made the
    // retry-without-optional-columns path silently drop category/card_last4/
    // card_bank as well: the retry itself succeeded, so the save looked
    // fine, but the real category column never changed — only the copy
    // inside raw_ocr_json did, which nothing reads back from once the
    // top-level column already holds a non-null (if stale) value.
    category: input.category,
    card_last4: input.cardLast4,
    card_bank: input.cardBank,
    // A receipt the user typed or corrected by hand needs no separate review
    // step — filling the form IS the review.
    reviewed_at: new Date().toISOString(),
    raw_ocr_json: {
      raw_text: input.rawText,
      receipt_amount: String(input.receiptAmount),
      receipt_currency: input.receiptCurrency,
      default_currency: input.defaultCurrency,
      conversion_rate: String(input.conversionRate),
      converted_total: String(input.convertedTotal),
      category: input.category,
      card_last4: input.cardLast4 ?? '',
      card_bank: input.cardBank ?? '',
      transfer_from_bank: input.transferFromBank ?? '',
      transfer_to_bank: input.transferToBank ?? '',
      transfer_kind: input.transferKind ?? '',
      // Kept so a receipt stays searchable by what was bought on it, not just
      // by merchant — previously the parser returned these and they were dropped.
      line_items: input.lineItems
    }
  }
  if (includeOptionalColumns) {
    body.receipt_amount = input.receiptAmount
    body.default_currency = input.defaultCurrency
    body.receipt_currency = input.receiptCurrency
    body.conversion_rate = input.conversionRate
    body.converted_total = input.convertedTotal
    body.transfer_from_bank = input.transferFromBank
    body.transfer_to_bank = input.transferToBank
    body.transfer_kind = input.transferKind
  }
  return body
}

// Mirrors SupabaseService.insertReceiptToDB's try-with-optional-columns,
// retry-without-on-schema-cache-miss pattern.
export async function insertReceipt(input: ReceiptWriteInput): Promise<string> {
  const post = (withOptional: boolean) =>
    authorizedFetch(`${REST_URL}/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(buildReceiptBody(input, withOptional))
    })

  let resp = await post(true)
  if (!resp.ok) {
    const errBody = await resp.text()
    if (isMissingColumnError(errBody)) {
      resp = await post(false)
    } else {
      throw new Error(`Insert receipt failed: HTTP ${resp.status} ${errBody.slice(0, 300)}`)
    }
  }
  await throwIfNotOk(resp, 'Insert receipt failed')
  const rows = await resp.json()
  const id = Array.isArray(rows) ? rows[0]?.id : rows?.id
  if (typeof id !== 'string') throw new Error('Insert receipt: response missing id')
  return id
}

export async function updateReceipt(id: string, input: ReceiptWriteInput): Promise<void> {
  const patch = (withOptional: boolean) =>
    authorizedFetch(`${REST_URL}/receipts?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(buildReceiptBody(input, withOptional))
    })

  let resp = await patch(true)
  if (!resp.ok) {
    const errBody = await resp.text()
    if (isMissingColumnError(errBody)) {
      resp = await patch(false)
    } else {
      throw new Error(`Update receipt failed: HTTP ${resp.status} ${errBody.slice(0, 300)}`)
    }
  }
  await throwIfNotOk(resp, 'Update receipt failed')

  // return=representation (rather than minimal) so an RLS refusal is visible:
  // PostgREST reports a row the policy rejects as 200 with an empty array, not
  // an error, which would otherwise look like a successful save that vanishes.
  const rows = await resp.json()
  if (Array.isArray(rows) && rows.length === 0) {
    throw new Error("You can't edit this receipt — it belongs to someone outside your household.")
  }
}

// Richer sources should never be silently dropped as duplicates of a thinner
// one, and shouldn't be silently downgraded by one either — 'manual' and
// 'photo' rank the same since both are typed/confirmed by a person right in
// the form, regardless of whether a photo happens to be attached.
const SOURCE_RICHNESS: Record<ReceiptSource, number> = { sms: 0, gmail: 1, manual: 2, photo: 2 }

export interface DuplicateCandidateRow {
  id: string
  merchant: string | null
  date: string | null
  card_bank: string | null
  card_last4: string | null
  source: string | null
  reviewed_at: string | null
  comment: string | null
  file_url: string | null
  raw_ocr_json: unknown
}

// Mirrors the household/user-scoped, total+date+(merchant-or-card) duplicate
// guard in process-sms-inbox/scan-gmail. Those two run as service_role and
// filter by household by hand; here RLS already scopes the select to the
// caller's own + household rows, so no explicit filter is needed.
// Calendar day (UTC, same basis every pipeline normalizes dates to) of a
// stored or incoming date. The card rule below used to compare raw strings,
// which never matched: PostgREST returns '2026-09-27T00:00:00+00:00' while
// toISOString() gives '2026-09-27T00:00:00.000Z' — same instant, different text.
function utcDay(value: string | null | undefined): string | null {
  const t = new Date(value ?? '')
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10)
}

// Exported so a caller can check for a match and let the user confirm before
// committing to a merge (AddReceiptPage), instead of merging silently.
export async function findDuplicateForMerge(input: ReceiptWriteInput): Promise<DuplicateCandidateRow | null> {
  const incomingRichness = SOURCE_RICHNESS[input.source ?? 'manual'] ?? 2
  const d = new Date(input.date)
  if (Number.isNaN(d.getTime())) return null
  const incomingDay = utcDay(input.date)
  const from = new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const to = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const resp = await authorizedFetch(
    `${REST_URL}/receipts?select=id,merchant,date,card_bank,card_last4,source,reviewed_at,comment,file_url,raw_ocr_json` +
    `&total=gte.${(input.total - 0.01).toFixed(2)}&total=lte.${(input.total + 0.01).toFixed(2)}` +
    `&date=gte.${from}&date=lte.${to}&limit=10`
  )
  if (!resp.ok) return null
  const rows = await resp.json()
  if (!Array.isArray(rows)) return null

  const needle = input.merchant.trim().toLowerCase()
  const cardKey = input.cardBank && input.cardLast4 ? `${input.cardBank.toLowerCase()}|${input.cardLast4}` : null
  const matches = (rows as DuplicateCandidateRow[]).filter((r) => {
    // Only worth merging into a strictly less-rich existing source — an
    // equal-or-richer one is either a genuinely separate purchase or already
    // the best copy of this data, so it's left alone (a plain duplicate, same
    // as before this existed).
    const existingRichness = SOURCE_RICHNESS[(r.source as ReceiptSource) ?? 'manual'] ?? 2
    if (existingRichness >= incomingRichness) return false
    const other = (r.merchant ?? '').toLowerCase()
    if (other === needle || (other !== '' && needle !== '' && (other.includes(needle) || needle.includes(other)))) return true
    // Same reasoning as the edge functions' guard: merchant text disagrees
    // across sources more often than expected, but the same card charged on
    // the same calendar date is an independently strong signal on its own.
    if (cardKey && r.card_bank && r.card_last4 && utcDay(r.date) === incomingDay) {
      return `${r.card_bank.toLowerCase()}|${r.card_last4}` === cardKey
    }
    return false
  })
  // More than one thinner copy of the same charge can exist (e.g. two SMS
  // alerts for one purchase). Prefer the one still waiting for review — that's
  // the copy this save is meant to complete — then the closest in time.
  const distance = (r: DuplicateCandidateRow) => Math.abs(new Date(r.date ?? '').getTime() - d.getTime()) || 0
  matches.sort((a, b) =>
    Number(a.reviewed_at !== null) - Number(b.reviewed_at !== null) || distance(a) - distance(b)
  )
  return matches[0] ?? null
}

// baseRaw is what the merged row's raw_ocr_json content actually becomes;
// existingRaw is only consulted for its merged_from history, which always
// carries forward regardless of which side's content wins.
function mergeRawOcrJson(
  baseRaw: Record<string, unknown>,
  existingRaw: Record<string, unknown>,
  input: ReceiptWriteInput
): Record<string, unknown> {
  const mergedFrom = Array.isArray(existingRaw.merged_from) ? existingRaw.merged_from as unknown[] : []
  return {
    ...baseRaw,
    merged_from: [
      ...mergedFrom,
      { source: input.source ?? 'manual', merged_at: new Date().toISOString() }
    ]
  }
}

// Folds a richer manual/photo entry into an existing sms/gmail-sourced
// duplicate instead of creating a second record for the same charge — the
// one gap insertReceipt alone doesn't cover (manual/photo skip the duplicate
// guard entirely otherwise). Two write modes, same split as scan-gmail's:
//
// - Not yet reviewed: this save IS the review, so the incoming source's own
//   content replaces the thinner existing content outright, everywhere —
//   structured fields (merchant, category, card info, source) AND raw
//   content (raw_ocr_json, so a photo/PDF's own OCR transcription becomes
//   the receipt's raw text instead of the original SMS body staying behind
//   under a 'merged' label).
// - Already reviewed by a human: their confirmed fields are left untouched;
//   only raw, non-interpretive content (raw text/line items, a receipt image
//   if one wasn't already attached, an appended comment) is folded in.
export async function mergeIntoReceipt(existing: DuplicateCandidateRow, input: ReceiptWriteInput): Promise<void> {
  const existingRaw = (existing.raw_ocr_json && typeof existing.raw_ocr_json === 'object'
    ? existing.raw_ocr_json as Record<string, unknown>
    : {}) as Record<string, unknown>
  const commentLabel = input.source === 'photo' ? 'photo' : 'manual entry'
  const mergedComment = input.comment && !(existing.comment ?? '').includes(input.comment)
    ? (existing.comment ? `${existing.comment}\n\n[Also seen via ${commentLabel}] ${input.comment}` : input.comment)
    : existing.comment

  if (existing.reviewed_at) {
    const mergedRaw = mergeRawOcrJson(existingRaw, existingRaw, input)
    const body: Record<string, unknown> = { raw_ocr_json: mergedRaw, comment: mergedComment }
    if (!existing.file_url && input.fileUrl) body.file_url = input.fileUrl
    const resp = await authorizedFetch(`${REST_URL}/receipts?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body)
    })
    await throwIfNotOk(resp, 'Merge receipt failed')
    await throwIfNoRowsUpdated(resp)
    return
  }

  const patch = (withOptional: boolean) => {
    const incomingBody = buildReceiptBody(input, withOptional)
    const incomingRaw = incomingBody.raw_ocr_json as Record<string, unknown>
    return authorizedFetch(`${REST_URL}/receipts?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        ...incomingBody,
        raw_ocr_json: mergeRawOcrJson(incomingRaw, existingRaw, input),
        comment: mergedComment
      })
    })
  }
  let resp = await patch(true)
  if (!resp.ok) {
    const errBody = await resp.text()
    if (isMissingColumnError(errBody)) {
      resp = await patch(false)
    } else {
      throw new Error(`Merge receipt failed: HTTP ${resp.status} ${errBody.slice(0, 300)}`)
    }
  }
  await throwIfNotOk(resp, 'Merge receipt failed')
  await throwIfNoRowsUpdated(resp)
}

// PostgREST reports a row RLS refused to update as 200 with an empty array —
// without this, a refused merge looks exactly like a successful one.
async function throwIfNoRowsUpdated(resp: Response) {
  const rows = await resp.json()
  if (Array.isArray(rows) && rows.length === 0) {
    throw new Error("Couldn't merge into the matching receipt — it belongs to someone you can't edit.")
  }
}

export async function deleteReceipt(id: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/receipts?id=eq.${id}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  })
  await throwIfNotOk(resp, 'Delete receipt failed')
  const rows = await resp.json()
  if (Array.isArray(rows) && rows.length === 0) {
    throw new Error("You can't delete this receipt — it belongs to someone outside your household.")
  }
}

// ---------------------------------------------------------------------------
// Receipt parsing (Edge Function)
// ---------------------------------------------------------------------------

/**
 * The parser's LLM provider is rate limited or out of quota (HTTP 429 from
 * parse-receipt). Distinct from a generic failure so the UI can say "wait N
 * seconds" instead of "something broke" — nothing is wrong with the receipt.
 */
export class ParserRateLimitedError extends Error {
  retryAfterSeconds: number | null

  constructor(retryAfterSeconds: number | null) {
    super(
      retryAfterSeconds != null
        ? `The receipt reader is at its limit — try again in ${retryAfterSeconds}s.`
        : 'The receipt reader is at its limit — try again shortly.'
    )
    this.name = 'ParserRateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function callParseReceipt(body: Record<string, unknown>, failurePrefix: string): Promise<ParsedReceipt> {
  const resp = await authorizedFetch(`${FUNCTIONS_URL}/parse-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (resp.status === 429) {
    let retryAfter: number | null = null
    try {
      const parsed = await resp.json()
      if (typeof parsed?.retry_after_seconds === 'number') retryAfter = parsed.retry_after_seconds
    } catch { /* body isn't JSON — fall back to the header */ }
    if (retryAfter == null) {
      const header = Number.parseFloat(resp.headers.get('Retry-After') ?? '')
      if (Number.isFinite(header)) retryAfter = Math.ceil(header)
    }
    throw new ParserRateLimitedError(retryAfter)
  }
  await throwIfNotOk(resp, failurePrefix)
  return resp.json()
}

export function parseReceiptText(rawText: string): Promise<ParsedReceipt> {
  return callParseReceipt({ raw_text: rawText }, 'Parse receipt failed')
}

export function parseReceiptImage(imageBase64: string, imageMimeType: string): Promise<ParsedReceipt> {
  return callParseReceipt({ image_base64: imageBase64, image_mime_type: imageMimeType }, 'Parse receipt image failed')
}

// ---------------------------------------------------------------------------
// Talk to me (ask-spending agent)
// ---------------------------------------------------------------------------

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentToolCall {
  round: number
  tool: string
  args: Record<string, unknown>
  error?: string
}

export interface AskSpendingReply {
  reply: string
  toolCalls: AgentToolCall[]
  stepsExhausted: boolean
}

/** The message is user-facing as-is (the edge function words its errors for people). */
export class AskSpendingError extends Error {
  /** False when asking again can't help (not deployed, not configured). */
  readonly retryable: boolean
  constructor(message: string, retryable = true) {
    super(message)
    this.name = 'AskSpendingError'
    this.retryable = retryable
  }
}

// Longer than the function's own worst case (a few 20s model calls), so the
// server's clearer timeout error normally arrives first.
const ASK_TIMEOUT_MS = 90_000

export async function askSpending(message: string, history: ChatTurn[]): Promise<AskSpendingReply> {
  let resp: Response
  try {
    resp = await authorizedFetch(`${FUNCTIONS_URL}/ask-spending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS)
    })
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err
    // fetch() itself rejected: no readable response at all. Safari words
    // this "Load failed", Chrome "Failed to fetch"; both mean the same here.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new AskSpendingError('That took too long. Try again, or ask something narrower.')
    }
    throw new AskSpendingError("Couldn't reach the chat. Check your connection and try again.")
  }
  let body: Record<string, unknown> | null = null
  try {
    body = await resp.json()
  } catch { /* non-JSON body: fall through to the status-based message */ }
  if (!resp.ok) {
    const serverMessage = typeof body?.error === 'string' ? body.error : null
    if (resp.status === 404) throw new AskSpendingError("Talk to me isn't set up on this server yet.", false)
    if (resp.status === 503) throw new AskSpendingError(serverMessage ?? "Talk to me isn't configured yet.", false)
    if (resp.status === 429) throw new AskSpendingError(serverMessage ?? "I'm getting too many questions right now. Try again in a minute.")
    throw new AskSpendingError(serverMessage ?? `Something went wrong (HTTP ${resp.status}).`)
  }
  return {
    reply: typeof body?.reply === 'string' ? body.reply : '',
    toolCalls: Array.isArray(body?.tool_calls) ? (body.tool_calls as AgentToolCall[]) : [],
    stepsExhausted: body?.steps_exhausted === true
  }
}

/**
 * Last-known rate-limit state of the parser's LLM key, as recorded by
 * parse-receipt from the provider's response headers on its most recent call
 * from any caller (multiuser-20-llm-quota-status.sql). Deployment-wide, not
 * per user — the SMS and Gmail crons draw on the same quota.
 */
export interface LlmQuotaStatus {
  model: string | null
  limitRequests: number | null
  remainingRequests: number | null
  requestsResetAt: string | null
  limitTokens: number | null
  remainingTokens: number | null
  tokensResetAt: string | null
  rateLimitedUntil: string | null
  lastStatus: number | null
  updatedAt: string
}

/** Null when nothing has been recorded yet or the table isn't deployed — callers treat that as "unknown", never as an error. */
export async function getLlmQuotaStatus(): Promise<LlmQuotaStatus | null> {
  try {
    const resp = await authorizedFetch(`${REST_URL}/llm_quota_status?provider=eq.groq&select=*`)
    if (!resp.ok) return null
    const rows = await resp.json()
    const r = Array.isArray(rows) ? rows[0] : null
    if (!r) return null
    return {
      model: r.model ?? null,
      limitRequests: r.limit_requests ?? null,
      remainingRequests: r.remaining_requests ?? null,
      requestsResetAt: r.requests_reset_at ?? null,
      limitTokens: r.limit_tokens ?? null,
      remainingTokens: r.remaining_tokens ?? null,
      tokensResetAt: r.tokens_reset_at ?? null,
      rateLimitedUntil: r.rate_limited_until ?? null,
      lastStatus: r.last_status ?? null,
      updatedAt: r.updated_at
    }
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err
    return null
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function sanitizedStorageFilename(filename: string): string {
  const sanitized = filename
    .replace(/[^A-Za-z0-9-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return sanitized || randomId()
}

/**
 * Uploads to `<user_id>/<uuid>-<name>` and returns that object path.
 *
 * The uid prefix is load-bearing, not cosmetic: the storage policies key off the
 * first path segment to decide who owns an object and which household may read
 * it. A flat path would be rejected on write and unreadable afterwards.
 *
 * Returns a path rather than a URL because the bucket is private — a stored
 * `/object/public/...` URL no longer resolves. Use getSignedUrl() to display.
 */
export async function uploadReceiptImage(
  blob: Blob,
  filenameHint: string,
  userId: string
): Promise<string> {
  if (!userId) throw new AuthRequiredError()
  const objectPath = `${userId}/${randomId()}-${sanitizedStorageFilename(filenameHint)}`

  const resp = await authorizedFetch(`${env.supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob
  })
  await throwIfNotOk(resp, 'Upload receipt image failed')
  return objectPath
}

/** Accepts either a bare object path or a legacy full `/object/public/...` URL. */
export function objectPathFromFileUrl(fileUrl: string): string {
  const marker = `/${BUCKET}/`
  return fileUrl.includes(marker) ? fileUrl.split(marker)[1] : fileUrl
}

/** Short-lived signed URL for a private-bucket object. Null if it can't be signed. */
export async function getSignedUrl(fileUrl: string, expiresInSeconds = 3600): Promise<string | null> {
  const objectPath = objectPathFromFileUrl(fileUrl)
  if (!objectPath) return null
  try {
    const resp = await authorizedFetch(`${env.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds })
    })
    if (!resp.ok) return null
    const { signedURL } = await resp.json()
    return signedURL ? `${env.supabaseUrl}/storage/v1${signedURL}` : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Payment methods (household-shared)
// ---------------------------------------------------------------------------

export async function findPaymentMethod(lastDigits: string): Promise<PaymentMethod | null> {
  const normalized = lastDigits.replace(/[^0-9]/g, '').slice(-4)
  if (normalized.length !== 4) return null

  // No household filter here — RLS already restricts this table to the caller's
  // household, and last_digits is unique within one.
  const resp = await authorizedFetch(
    `${REST_URL}/payment_methods?select=id,last_digits,bank_name,card_name&last_digits=eq.${normalized}`
  )
  if (!resp.ok) return null
  const rows = await resp.json()
  const first = Array.isArray(rows) ? rows[0] : null
  if (!first) return null
  return {
    id: first.id,
    lastDigits: normalized,
    bankName: first.bank_name ?? 'Unknown Bank',
    cardName: first.card_name ?? null
  }
}

// ---------------------------------------------------------------------------
// Per-user settings + household
// ---------------------------------------------------------------------------

export interface UserSettings {
  userId: string
  displayName: string | null
  defaultCurrency: string
  activeHouseholdId: string | null
}

export interface HouseholdMember {
  userId: string
  displayName: string | null
  role: string
}

/** Replaces the retired global app_settings.default_currency row. */
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const resp = await authorizedFetch(
    `${REST_URL}/user_settings?select=user_id,display_name,default_currency,active_household_id&user_id=eq.${userId}&limit=1`
  )
  if (!resp.ok) return null
  const rows = await resp.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  return {
    userId: row.user_id,
    displayName: row.display_name ?? null,
    defaultCurrency: row.default_currency ?? 'SGD',
    activeHouseholdId: row.active_household_id ?? null
  }
}

export async function updateUserSettings(
  userId: string,
  patch: Partial<Pick<UserSettings, 'displayName' | 'defaultCurrency'>>
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.displayName !== undefined) body.display_name = patch.displayName
  if (patch.defaultCurrency !== undefined) body.default_currency = patch.defaultCurrency
  if (Object.keys(body).length === 0) return

  const resp = await authorizedFetch(`${REST_URL}/user_settings?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  })
  await throwIfNotOk(resp, 'Save settings failed')
}

/**
 * Everyone in the caller's household, used to attribute receipts to a person.
 *
 * Two round trips rather than a PostgREST embed: household_members and
 * user_settings both reference auth.users but have no foreign key between each
 * other, so there is no relationship for PostgREST to traverse. RLS scopes both
 * queries to the caller's household, so this returns peers and nobody else.
 */
export async function listHouseholdMembers(): Promise<HouseholdMember[]> {
  const membersResp = await authorizedFetch(`${REST_URL}/household_members?select=user_id,role`)
  if (!membersResp.ok) return []
  const memberRows = await membersResp.json()
  if (!Array.isArray(memberRows) || memberRows.length === 0) return []

  const names = new Map<string, string | null>()
  const settingsResp = await authorizedFetch(`${REST_URL}/user_settings?select=user_id,display_name`)
  if (settingsResp.ok) {
    const settingsRows = await settingsResp.json()
    if (Array.isArray(settingsRows)) {
      for (const row of settingsRows) names.set(row.user_id, row.display_name ?? null)
    }
  }

  return memberRows.map((r: { user_id: string; role: string }) => ({
    userId: r.user_id,
    displayName: names.get(r.user_id) ?? null,
    role: r.role
  }))
}

// ---------------------------------------------------------------------------
// SMS ingest tokens
// ---------------------------------------------------------------------------

export interface SmsIngestToken {
  id: string
  label: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export async function listSmsTokens(): Promise<SmsIngestToken[]> {
  const resp = await authorizedFetch(
    `${REST_URL}/sms_ingest_tokens?select=id,label,created_at,last_used_at,revoked_at&order=created_at.desc`
  )
  if (!resp.ok) return []
  const rows = await resp.json()
  if (!Array.isArray(rows)) return []
  return rows.map((r: Record<string, string | null>) => ({
    id: r.id as string,
    label: r.label,
    createdAt: r.created_at as string,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at
  }))
}

/** Returns the raw token. It is shown once and cannot be recovered afterwards. */
export async function createSmsToken(label: string | null): Promise<string> {
  const resp = await authorizedFetch(`${REST_URL}/rpc/create_sms_ingest_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_label: label })
  })
  await throwIfNotOk(resp, 'Create SMS token failed')
  const token = await resp.json()
  if (typeof token !== 'string' || !token) throw new Error('Create SMS token: unexpected response')
  return token
}

// ---------------------------------------------------------------------------
// Learned corrections (see receipt_correction_rules in
// multiuser-14-receipt-comment-and-learning.sql) — mirrors the keyword
// normalization from ExpenseManager/ReceiptStore.swift's
// normalizedMerchantKey/normalizedKey so a keyword learned from an iOS
// correction and one learned here can still land on the same rule.
// ---------------------------------------------------------------------------

const CORRECTION_KEYWORD_STOP_WORDS = new Set([
  'email', 'subject', 'from', 'gmail', 'receipt', 'invoice', 'bill', 'payment',
  'confirmation', 'statement', 'alert', 'notification', 'card', 'credit'
])

function normalizedCorrectionKey(value: string | null | undefined): string | null {
  if (!value) return null
  const tokens = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !CORRECTION_KEYWORD_STOP_WORDS.has(t))
  const key = tokens.join(' ').trim()
  return key === '' || key === 'unknown bank' ? null : key
}

export interface ReceiptCorrectionSnapshot {
  merchant: string
  category: string
  receiptCurrency: string
  cardLast4: string
  cardBank: string
  rawText: string
}

/**
 * Best-effort: called after a receipt is saved, to remember a correction for
 * next time. Never throws — a failed learning write must not make a
 * successful save look like it failed.
 */
export async function learnReceiptCorrection(
  householdId: string | null,
  before: ReceiptCorrectionSnapshot,
  after: ReceiptCorrectionSnapshot,
  comment: string
): Promise<void> {
  if (!householdId) return

  const norm = (v: string) => v.trim().toLowerCase()
  const fieldsChanged =
    norm(before.merchant) !== norm(after.merchant) ||
    norm(before.category) !== norm(after.category) ||
    norm(before.receiptCurrency) !== norm(after.receiptCurrency) ||
    norm(before.cardLast4) !== norm(after.cardLast4) ||
    norm(before.cardBank) !== norm(after.cardBank)

  const trimmedComment = comment.trim()
  if (!fieldsChanged && !trimmedComment) return

  const keyword =
    normalizedCorrectionKey(after.merchant) ??
    after.rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 3 && line.length <= 60)
      .map((line) => normalizedCorrectionKey(line))
      .find((key): key is string => key !== null) ??
    null
  if (!keyword) return

  try {
    const resp = await authorizedFetch(`${REST_URL}/rpc/learn_receipt_correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_household_id: householdId,
        p_merchant_keyword: keyword,
        p_corrected_merchant: after.merchant || null,
        p_corrected_category: after.category || null,
        p_corrected_currency: after.receiptCurrency || null,
        p_corrected_card_last4: after.cardLast4 || null,
        p_corrected_card_bank: after.cardBank || null,
        p_note: trimmedComment || null
      })
    })
    if (!resp.ok) console.error(`learn_receipt_correction failed: HTTP ${resp.status}`)
  } catch (err) {
    console.error('learn_receipt_correction failed', err)
  }
}

export async function revokeSmsToken(id: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/sms_ingest_tokens?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() })
  })
  await throwIfNotOk(resp, 'Revoke SMS token failed')
}

// ---------------------------------------------------------------------------
// Household-custom categories (household_categories) — additions layered on
// top of the fixed EXPENSE_CATEGORIES list, never touching it.
// ---------------------------------------------------------------------------

export interface HouseholdCategory {
  id: string
  name: string
}

export async function listHouseholdCategories(): Promise<HouseholdCategory[]> {
  const resp = await authorizedFetch(
    `${REST_URL}/household_categories?select=id,name&order=created_at.asc`
  )
  if (!resp.ok) return []
  const rows = await resp.json()
  if (!Array.isArray(rows)) return []
  return rows.map((r: Record<string, string>) => ({ id: r.id, name: r.name }))
}

export async function addHouseholdCategory(name: string, householdId: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/household_categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ name: name.trim(), household_id: householdId })
  })
  await throwIfNotOk(resp, 'Add category failed')
}

export async function deleteHouseholdCategory(id: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/household_categories?id=eq.${id}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  })
  await throwIfNotOk(resp, 'Delete category failed')
}

/**
 * Renames a custom category and moves everything filed under the old name
 * with it — the household's receipts (including other members' private ones)
 * and its learned correction rules. That cross-member update is why this goes
 * through an RPC rather than a plain PATCH (multiuser-18-rename-household-category.sql).
 */
export async function renameHouseholdCategory(id: string, name: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/rpc/rename_household_category`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id, p_new_name: name.trim() })
  })
  if (!resp.ok) {
    // The function raises human-readable messages ("X" already exists) —
    // show those rather than the raw PostgREST error envelope.
    const body = await resp.text()
    let message = body.slice(0, 300)
    try {
      const parsed = JSON.parse(body)
      if (typeof parsed?.message === 'string') message = parsed.message
    } catch { /* not JSON — keep the raw text */ }
    throw new Error(`Rename failed: ${message}`)
  }
}

/** Clears the "needs review" flag once a member has confirmed the details. */
export async function markReceiptsReviewed(ids: string[], userId: string): Promise<void> {
  if (ids.length === 0) return
  const list = ids.map((id) => `"${id}"`).join(',')
  const resp = await authorizedFetch(`${REST_URL}/receipts?id=in.(${list})`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ reviewed_at: new Date().toISOString(), reviewed_by: userId })
  })
  await throwIfNotOk(resp, 'Mark reviewed failed')
}

// ---------------------------------------------------------------------------
// Household membership (privileged — goes through the manage-household function)
// ---------------------------------------------------------------------------

export interface AddedMember {
  userId: string
  email: string
  displayName: string
  /** Present only for a brand-new account. Shown once; never recoverable. */
  password: string | null
}

async function manageHousehold(body: Record<string, unknown>) {
  const resp = await authorizedFetch(`${FUNCTIONS_URL}/manage-household`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data?.error ?? `Request failed (HTTP ${resp.status})`)
  return data
}

export async function addHouseholdMember(email: string, displayName: string): Promise<AddedMember> {
  const d = await manageHousehold({ action: 'add', email, display_name: displayName })
  return {
    userId: d.user_id,
    email: d.email,
    displayName: d.display_name,
    password: d.password ?? null
  }
}

export async function removeHouseholdMember(userId: string): Promise<void> {
  await manageHousehold({ action: 'remove', user_id: userId })
}

// ---------------------------------------------------------------------------
// Gmail connection
// ---------------------------------------------------------------------------

export interface GmailConnection {
  email: string
  connectedAt: string
  lastScanAt: string | null
  lastError: string | null
}

/** The redirect must match one registered in Google Cloud AND allow-listed server-side. */
export function gmailRedirectUri(): string {
  return `${window.location.origin}/settings/gmail/callback`
}

async function gmailConnect(body: Record<string, unknown>) {
  const resp = await authorizedFetch(`${FUNCTIONS_URL}/gmail-connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uri: gmailRedirectUri(), ...body })
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data?.error ?? `Request failed (HTTP ${resp.status})`)
  return data
}

/** Returns Google's consent URL to send the browser to. */
export async function startGmailConnect(): Promise<string> {
  const d = await gmailConnect({ action: 'start' })
  return d.url
}

export async function completeGmailConnect(code: string): Promise<string> {
  const d = await gmailConnect({ action: 'callback', code })
  return d.email
}

export async function disconnectGmail(): Promise<void> {
  await gmailConnect({ action: 'disconnect' })
}

export async function getGmailConnection(): Promise<GmailConnection | null> {
  const resp = await authorizedFetch(
    `${REST_URL}/gmail_connections?select=email,connected_at,last_scan_at,last_error&limit=1`
  )
  if (!resp.ok) return null
  const rows = await resp.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  return {
    email: row.email,
    connectedAt: row.connected_at,
    lastScanAt: row.last_scan_at,
    lastError: row.last_error
  }
}

/**
 * Triggers scan-gmail for the caller's own mailbox only — not the cron path,
 * which scans every connected household member. The function enforces the
 * same scoping server-side from the caller's own JWT, so this can't be used
 * to trigger anyone else's scan even if the request were tampered with.
 */
export async function scanGmailNow(): Promise<void> {
  const resp = await authorizedFetch(`${FUNCTIONS_URL}/scan-gmail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data?.error ?? `Scan failed (HTTP ${resp.status})`)
}

// ---------------------------------------------------------------------------
// Gmail scan log — diagnostic trail of emails scan-gmail found and rejected,
// with the reason. Not every email it looked at: RLS scopes this to the
// caller's own mailbox, same as gmail_connections.
// ---------------------------------------------------------------------------

export interface GmailScanLogEntry {
  id: string
  subject: string | null
  sender: string | null
  emailDate: string | null
  reason: string
  scannedAt: string
  /** How many genuine (non-rate-limit) attempts this message has used. */
  retryCount: number
}

export async function getGmailScanLog(limit = 50): Promise<GmailScanLogEntry[]> {
  const resp = await authorizedFetch(
    `${REST_URL}/gmail_scan_log?select=id,subject,sender,email_date,reason,scanned_at,retry_count` +
    `&order=scanned_at.desc&limit=${limit}`
  )
  if (!resp.ok) return []
  const rows = await resp.json()
  if (!Array.isArray(rows)) return []
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    sender: row.sender,
    emailDate: row.email_date,
    reason: row.reason,
    scannedAt: row.scanned_at,
    retryCount: typeof row.retry_count === 'number' ? row.retry_count : 1
  }))
}

export async function clearGmailScanLog(): Promise<void> {
  // PostgREST requires an explicit filter on DELETE; user_id is NOT NULL, so
  // this matches every row the caller can see — which RLS has already scoped
  // to their own log — without needing to know individual ids up front.
  const resp = await authorizedFetch(`${REST_URL}/gmail_scan_log?user_id=not.is.null`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  })
  await throwIfNotOk(resp, 'Clear scan log failed')
}

/**
 * Gives one message a fresh retry budget. scan-gmail's hasExhaustedRetries()
 * only sees a message as "used up its attempts" via its gmail_scan_log row —
 * deleting that row makes the next scan treat it as never-attempted, no
 * different from a message it's never seen before.
 */
export async function retryGmailScanLogEntry(id: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/gmail_scan_log?id=eq.${id}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  })
  await throwIfNotOk(resp, 'Retry failed')
}

// ---------------------------------------------------------------------------
// SMS processing log — unlike Gmail there's no separate log table: sms_inbox
// itself already records what happened to every message (status +
// error_message + retry_count), so this just surfaces the skipped/failed
// rows. RLS scopes this to the caller's own rows
// (multiuser-16-sms-inbox-rls-and-cleanup.sql) — earlier this table was
// readable across every household, a gap this UI made worth closing first.
// ---------------------------------------------------------------------------

export interface SmsInboxLogEntry {
  id: string
  body: string
  sender: string | null
  receivedAt: string
  status: 'skipped' | 'failed'
  reason: string | null
  /** How many genuine (non-rate-limit) attempts this message has used. */
  retryCount: number
}

export async function getSmsInboxLog(limit = 50): Promise<SmsInboxLogEntry[]> {
  const resp = await authorizedFetch(
    `${REST_URL}/sms_inbox?select=id,body,sender,received_at,status,error_message,retry_count` +
    `&status=in.(skipped,failed)&order=received_at.desc&limit=${limit}`
  )
  if (!resp.ok) return []
  const rows = await resp.json()
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row: { status?: string }) => row.status === 'skipped' || row.status === 'failed')
    .map((row) => ({
      id: row.id,
      body: row.body ?? '',
      sender: row.sender ?? null,
      receivedAt: row.received_at,
      status: row.status,
      reason: row.error_message ?? null,
      retryCount: typeof row.retry_count === 'number' ? row.retry_count : 0
    }))
}

export async function clearSmsInboxLog(): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/sms_inbox?status=in.(skipped,failed)`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  })
  await throwIfNotOk(resp, 'Clear SMS log failed')
}

/**
 * Gives one message a fresh retry budget. sms_inbox IS the processing queue
 * itself (unlike gmail_scan_log, a separate table) — resetting the row back
 * to pending, rather than deleting it, is what makes process-sms-inbox pick
 * it up again on the next tick without losing its body_hash identity.
 */
export async function retrySmsInboxEntry(id: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/sms_inbox?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'pending', retry_count: 0, error_message: null })
  })
  await throwIfNotOk(resp, 'Retry failed')
}

/**
 * Same reset as retrySmsInboxEntry, applied to every failed/skipped row at
 * once — for the case where a whole outage window's worth of messages (e.g.
 * an LLM provider outage) needs re-queuing in one shot, not one tap each.
 */
export async function retryAllSmsInboxEntries(): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/sms_inbox?status=in.(skipped,failed)`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'pending', retry_count: 0, error_message: null })
  })
  await throwIfNotOk(resp, 'Retry all failed')
}
