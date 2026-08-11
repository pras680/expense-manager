import { env } from './env'
import { receiptFromRow } from './receiptShape'
import { randomId } from './id'
import type { Receipt, ParsedReceipt, PaymentMethod } from '../types/receipt'

const REST_URL = `${env.supabaseUrl}/rest/v1`
const FUNCTIONS_URL = `${env.supabaseUrl}/functions/v1`

// Set by AuthProvider whenever the session changes (mirrors how iOS's
// ReceiptStore.signInToSupabase pushes the access token into
// PaymentMappingService). apikey stays the anon key always — that's a
// gateway-routing header, not an auth decision; RLS is enforced off the
// Authorization bearer token's role (anon vs authenticated).
let currentAccessToken: string | null = null

export function setAuthToken(token: string | null): void {
  currentAccessToken = token
}

function baseHeaders(): Record<string, string> {
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${currentAccessToken ?? env.supabaseAnonKey}`
  }
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

// receipts only has category/card_last4/card_bank as real optional top-level
// columns (confirmed against the live schema) — default_currency/receipt_amount/
// receipt_currency/conversion_rate/converted_total live only inside raw_ocr_json,
// so there's no reason to ever request them here (unlike insert/update, which
// still probe for them in case the schema changes and fall back on a miss).
const RECEIPTS_SELECT = 'id,merchant,date,total,currency,file_url,raw_ocr_json,card_last4,card_bank,category'

export async function listReceipts(): Promise<Receipt[]> {
  const resp = await fetch(`${REST_URL}/receipts?select=${encodeURIComponent(RECEIPTS_SELECT)}`, {
    headers: baseHeaders()
  })
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
}

function buildReceiptBody(input: ReceiptWriteInput, includeOptionalColumns: boolean) {
  const body: Record<string, unknown> = {
    merchant: input.merchant,
    date: input.date,
    total: input.total,
    currency: input.receiptCurrency || input.currency,
    file_url: input.fileUrl,
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
// retry-without-on-schema-cache-miss pattern (receipts doesn't actually have
// top-level receipt_amount/default_currency/receipt_currency/conversion_rate/
// converted_total columns — only category/card_last4/card_bank do).
export async function insertReceipt(input: ReceiptWriteInput): Promise<string> {
  let resp = await fetch(`${REST_URL}/receipts`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(buildReceiptBody(input, true))
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    if (isMissingColumnError(errBody)) {
      resp = await fetch(`${REST_URL}/receipts`, {
        method: 'POST',
        headers: { ...baseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(buildReceiptBody(input, false))
      })
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
  let resp = await fetch(`${REST_URL}/receipts?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(buildReceiptBody(input, true))
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    if (isMissingColumnError(errBody)) {
      resp = await fetch(`${REST_URL}/receipts?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...baseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(buildReceiptBody(input, false))
      })
    } else {
      throw new Error(`Update receipt failed: HTTP ${resp.status} ${errBody.slice(0, 300)}`)
    }
  }
  await throwIfNotOk(resp, 'Update receipt failed')
}

export async function deleteReceipt(id: string): Promise<void> {
  const resp = await fetch(`${REST_URL}/receipts?id=eq.${id}`, {
    method: 'DELETE',
    headers: { ...baseHeaders(), Prefer: 'return=minimal' }
  })
  await throwIfNotOk(resp, 'Delete receipt failed')
}

export async function parseReceiptText(rawText: string): Promise<ParsedReceipt> {
  const resp = await fetch(`${FUNCTIONS_URL}/parse-receipt`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: rawText })
  })
  await throwIfNotOk(resp, 'Parse receipt failed')
  return resp.json()
}

export async function parseReceiptImage(imageBase64: string, imageMimeType: string): Promise<ParsedReceipt> {
  const resp = await fetch(`${FUNCTIONS_URL}/parse-receipt`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: imageBase64, image_mime_type: imageMimeType })
  })
  await throwIfNotOk(resp, 'Parse receipt image failed')
  return resp.json()
}

function sanitizedStorageFilename(filename: string): string {
  const sanitized = filename
    .replace(/[^A-Za-z0-9-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return sanitized || randomId()
}

// Uploads under a flat, random-UUID-prefixed name rather than a <uid>/ path.
// That's deliberate: receipts are shared across the household, so scoping
// objects per user would hide each member's photos from the others without
// defending against the threat that matters (an unauthenticated stranger) —
// that's handled by the bucket being private with authenticated-only policies
// (see supabase-edge/storage-lockdown-receipt-documents.sql). baseHeaders()
// carries the signed-in user's access token, so these uploads satisfy them.
export async function uploadReceiptImage(blob: Blob, filenameHint: string): Promise<string> {
  const bucket = 'receipt-documents'
  const safeFilename = `${randomId()}-${sanitizedStorageFilename(filenameHint)}`

  const resp = await fetch(`${env.supabaseUrl}/storage/v1/object/${bucket}/${safeFilename}`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': blob.type || 'image/jpeg' },
    body: blob
  })
  await throwIfNotOk(resp, 'Upload receipt image failed')
  return `${env.supabaseUrl}/storage/v1/object/public/${bucket}/${safeFilename}`
}

// Ported from PaymentMappingService.findPaymentMethod
export async function findPaymentMethod(lastDigits: string): Promise<PaymentMethod | null> {
  const normalized = lastDigits.replace(/[^0-9]/g, '').slice(-4)
  if (normalized.length !== 4) return null

  const resp = await fetch(
    `${REST_URL}/payment_methods?select=id,last_digits,bank_name,card_name&last_digits=eq.${normalized}`,
    { headers: baseHeaders() }
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

export async function getAppSetting<T = unknown>(key: string): Promise<T | null> {
  const resp = await fetch(`${REST_URL}/app_settings?select=value&key=eq.${encodeURIComponent(key)}`, {
    headers: baseHeaders()
  })
  if (!resp.ok) return null
  const rows = await resp.json()
  if (!Array.isArray(rows) || rows.length === 0) return null
  return rows[0].value as T
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const resp = await fetch(`${REST_URL}/app_settings?on_conflict=key`, {
    method: 'POST',
    headers: {
      ...baseHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ key, value })
  })
  await throwIfNotOk(resp, 'Save setting failed')
}
