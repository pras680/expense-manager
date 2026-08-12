import type { Receipt } from '../types/receipt'
import { DEFAULT_CURRENCY } from './categories'

// Ported from ExpenseManager/ExpenseManager/Models/Invoice.swift's
// `init?(from dictionary:)` — prefer the top-level column, fall back to
// raw_ocr_json.<field> when null. Some existing rows have null top-level
// category/card_last4/etc. from a since-fixed iOS bug, and the currency/
// amount fields (receipt_amount, conversion_rate, etc.) live ONLY inside
// raw_ocr_json on this schema — they were never real top-level columns
// despite both iOS and this webapp's insert code trying to write them there
// (PostgREST silently drops unknown columns on some inserts / iOS retries
// without them on a schema-cache miss). Always read from raw_ocr_json first
// for those five fields, top-level as a bonus fallback in case that ever
// changes.

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number') return String(value)
  return null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function receiptFromRow(row: Record<string, unknown>): Receipt | null {
  if (typeof row.id !== 'string') return null

  const rawJson = (row.raw_ocr_json && typeof row.raw_ocr_json === 'object'
    ? row.raw_ocr_json as Record<string, unknown>
    : {}) as Record<string, unknown>

  const currency = stringValue(row.currency)
  const defaultCurrency = stringValue(row.default_currency) ?? stringValue(rawJson.default_currency)
  const receiptCurrency = stringValue(row.receipt_currency) ?? stringValue(rawJson.receipt_currency) ?? currency
  const category = stringValue(row.category) ?? stringValue(rawJson.category)
  const cardLast4 = stringValue(row.card_last4) ?? stringValue(rawJson.card_last4)
  const cardBank = stringValue(row.card_bank) ?? stringValue(rawJson.card_bank)

  const storedTotal = numberValue(row.total)
  const receiptAmount = numberValue(row.receipt_amount) ?? numberValue(rawJson.receipt_amount) ?? storedTotal
  const conversionRate = numberValue(row.conversion_rate) ?? numberValue(rawJson.conversion_rate)
  const convertedTotal = numberValue(row.converted_total) ?? numberValue(rawJson.converted_total)

  const targetCurrency = defaultCurrency || DEFAULT_CURRENCY
  const sourceCurrency = receiptCurrency || currency || targetCurrency
  const reportingTotal = convertedTotal ?? (sourceCurrency === targetCurrency ? storedTotal : null)

  const rawText = stringValue(rawJson.raw_text) ?? ''

  return {
    id: row.id,
    merchant: stringValue(row.merchant),
    date: stringValue(row.date),
    total: reportingTotal,
    receiptAmount,
    currency: receiptCurrency ?? currency,
    defaultCurrency,
    receiptCurrency,
    conversionRate,
    convertedTotal,
    category,
    cardLast4,
    cardBank,
    rawText,
    fileUrl: stringValue(row.file_url),
    userId: stringValue(row.user_id),
    householdId: stringValue(row.household_id),
    // Default to 'household' to match the column default: a row that predates
    // the column (or a legacy select that omits it) is shared, not silently
    // hidden from the rest of the household.
    visibility: stringValue(row.visibility) === 'private' ? 'private' : 'household',
    source: (['manual', 'photo', 'sms', 'gmail'] as const)
      .find((s) => s === stringValue(row.source)) ?? 'manual',
    reviewedAt: stringValue(row.reviewed_at)
  }
}

// Note: there is deliberately no canEditReceipt() helper. Household receipts are
// co-managed and private ones are only visible to their owner, so anything a
// user can see, they can edit — the RLS predicate is the same for both.

export function reportingTotal(r: Receipt): number | null {
  return r.total ?? r.convertedTotal
}

export function reportingCurrency(r: Receipt): string {
  return r.defaultCurrency || DEFAULT_CURRENCY
}

export function displayReceiptCurrency(r: Receipt): string {
  return r.receiptCurrency || r.currency || DEFAULT_CURRENCY
}

export function displayReceiptAmount(r: Receipt): number | null {
  return r.receiptAmount ?? r.total
}

// Ported from Invoice.matches(_:) in Invoice.swift
export function receiptMatches(r: Receipt, query: string): boolean {
  const q = query.toLowerCase()
  if (!q) return true
  if (r.merchant?.toLowerCase().includes(q)) return true
  if (r.currency?.toLowerCase().includes(q)) return true
  if (r.category?.toLowerCase().includes(q)) return true
  if (r.cardLast4?.toLowerCase().includes(q)) return true
  if (r.cardBank?.toLowerCase().includes(q)) return true
  if (r.rawText.toLowerCase().includes(q)) return true
  if (r.date) {
    const formatted = new Date(r.date).toLocaleDateString(undefined, { dateStyle: 'medium' }).toLowerCase()
    if (formatted.includes(q)) return true
  }
  if (r.total != null && String(r.total).includes(q)) return true
  return false
}

/** Auto-imported and not yet verified by anyone in the household. */
export function needsReview(r: Receipt): boolean {
  return r.reviewedAt === null && (r.source === 'sms' || r.source === 'gmail')
}
