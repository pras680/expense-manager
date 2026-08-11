import { env } from './env'
import { receiptFromRow } from './receiptShape'
import { randomId } from './id'
import type { Receipt, ParsedReceipt, PaymentMethod } from '../types/receipt'

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
  'id,merchant,date,total,currency,file_url,raw_ocr_json,card_last4,card_bank,category,user_id,household_id,visibility'

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
  rawText: string
  fileUrl: string | null
  visibility: 'private' | 'household'
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
    raw_ocr_json: {
      raw_text: input.rawText,
      receipt_amount: String(input.receiptAmount),
      receipt_currency: input.receiptCurrency,
      default_currency: input.defaultCurrency,
      conversion_rate: String(input.conversionRate),
      converted_total: String(input.convertedTotal),
      category: input.category,
      card_last4: input.cardLast4 ?? '',
      card_bank: input.cardBank ?? ''
    }
  }
  if (includeOptionalColumns) {
    body.receipt_amount = input.receiptAmount
    body.default_currency = input.defaultCurrency
    body.receipt_currency = input.receiptCurrency
    body.conversion_rate = input.conversionRate
    body.converted_total = input.convertedTotal
    body.category = input.category
    body.card_last4 = input.cardLast4
    body.card_bank = input.cardBank
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

export async function parseReceiptText(rawText: string): Promise<ParsedReceipt> {
  const resp = await authorizedFetch(`${FUNCTIONS_URL}/parse-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: rawText })
  })
  await throwIfNotOk(resp, 'Parse receipt failed')
  return resp.json()
}

export async function parseReceiptImage(imageBase64: string, imageMimeType: string): Promise<ParsedReceipt> {
  const resp = await authorizedFetch(`${FUNCTIONS_URL}/parse-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: imageBase64, image_mime_type: imageMimeType })
  })
  await throwIfNotOk(resp, 'Parse receipt image failed')
  return resp.json()
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

export async function revokeSmsToken(id: string): Promise<void> {
  const resp = await authorizedFetch(`${REST_URL}/sms_ingest_tokens?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() })
  })
  await throwIfNotOk(resp, 'Revoke SMS token failed')
}
