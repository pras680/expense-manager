import type { Receipt } from '../types/receipt'
import { isExpenseReceipt, reportingTotal } from './receiptShape'
import { monthKey } from './months'
import { dayKey } from './format'

// The grouping maths behind Insights and its drill-down pages. Every level
// (month -> category -> merchant -> receipts) filters the same receipt list
// with these, so a figure on one level always equals the sum of the level
// below it.

export const UNCATEGORISED = 'Miscellaneous'
/** Path segment meaning "every category" on the category drill-down page. */
export const ALL_CATEGORIES = 'All'
/** Search-param value meaning "all time" where a month key is expected. */
export const ALL_TIME = 'all'

/** "2026-11" for a dated receipt; null when the date is missing or unparseable. */
export function receiptMonthKey(r: Receipt): string | null {
  if (!r.date) return null
  const d = new Date(r.date)
  return Number.isNaN(d.getTime()) ? null : monthKey(d)
}

export function receiptCategory(r: Receipt): string {
  return r.category || UNCATEGORISED
}

export function sumTotals(receipts: Receipt[]): number {
  return receipts.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
}

/** Receipts in one month, or all of them for ALL_TIME / no month. */
export function inPeriod(receipts: Receipt[], month: string | null | undefined): Receipt[] {
  if (!month || month === ALL_TIME) return receipts
  return receipts.filter((r) => receiptMonthKey(r) === month)
}

export interface MonthTotal {
  key: string
  /** Expense spend only — transfers and card bill payments never count. */
  total: number
  /** Every receipt in the month, spend or not. */
  count: number
}

/** One entry per month that has any dated receipt, newest first. */
export function monthTotals(receipts: Receipt[]): MonthTotal[] {
  const map = new Map<string, MonthTotal>()
  for (const r of receipts) {
    const key = receiptMonthKey(r)
    if (!key) continue
    const entry = map.get(key) ?? { key, total: 0, count: 0 }
    entry.count += 1
    if (isExpenseReceipt(r)) entry.total += reportingTotal(r) ?? 0
    map.set(key, entry)
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1))
}

/** The `count` calendar months ending at `now`, oldest first — gaps included. */
export function recentMonthKeys(count: number, now = new Date()): string[] {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  }
  return keys
}

export interface Slice {
  name: string
  total: number
  count: number
  /** Share of the summed total, 0-100 (unrounded, for bar widths). */
  share: number
}

function slices(receipts: Receipt[], nameOf: (r: Receipt) => string): Slice[] {
  // Group case-insensitively so "Grab" and "GRAB" (an SMS alert and an email
  // rarely agree on capitalisation) land in one row; show the first spelling seen.
  const map = new Map<string, { name: string; total: number; count: number }>()
  for (const r of receipts) {
    const name = nameOf(r)
    const key = name.toLowerCase()
    const entry = map.get(key) ?? { name, total: 0, count: 0 }
    entry.total += reportingTotal(r) ?? 0
    entry.count += 1
    map.set(key, entry)
  }
  const list = Array.from(map.values()).sort((a, b) => b.total - a.total)
  const sum = list.reduce((acc, s) => acc + s.total, 0)
  return list.map((s) => ({ ...s, share: sum > 0 ? Math.max(0, (s.total / sum) * 100) : 0 }))
}

export function byCategory(receipts: Receipt[]): Slice[] {
  return slices(receipts, receiptCategory)
}

export const UNKNOWN_MERCHANT = 'Unknown merchant'

export function receiptMerchant(r: Receipt): string {
  return r.merchant?.trim() || UNKNOWN_MERCHANT
}

export function byMerchant(receipts: Receipt[]): Slice[] {
  return slices(receipts, receiptMerchant)
}

export function sameMerchant(r: Receipt, merchant: string): boolean {
  return receiptMerchant(r).toLowerCase() === merchant.toLowerCase()
}

// ---- Sorting and day grouping for the drill-down lists ----------------------

export type MerchantSort = 'spend' | 'spend-asc' | 'count' | 'name'
export type ReceiptSort = 'newest' | 'oldest' | 'highest' | 'lowest'
export type DaySort = 'newest' | 'oldest' | 'biggest'

export const MERCHANT_SORTS: { value: MerchantSort; label: string }[] = [
  { value: 'spend', label: 'Highest spend' },
  { value: 'spend-asc', label: 'Lowest spend' },
  { value: 'count', label: 'Most receipts' },
  { value: 'name', label: 'A to Z' }
]
export const RECEIPT_SORTS: { value: ReceiptSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'highest', label: 'Highest amount' },
  { value: 'lowest', label: 'Lowest amount' }
]
export const DAY_SORTS: { value: DaySort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'biggest', label: 'Biggest day' }
]

/** Reads a sort value from the URL, falling back to the list's first (default) option. */
export function readSort<T extends string>(value: string | null, options: { value: T }[]): T {
  return options.find((o) => o.value === value)?.value ?? options[0].value
}

export function sortSlices(list: Slice[], sort: MerchantSort): Slice[] {
  const sorted = [...list]
  if (sort === 'spend') sorted.sort((a, b) => b.total - a.total)
  else if (sort === 'spend-asc') sorted.sort((a, b) => a.total - b.total)
  else if (sort === 'count') sorted.sort((a, b) => b.count - a.count || b.total - a.total)
  else sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return sorted
}

function receiptTime(r: Receipt): number {
  const t = r.date ? new Date(r.date).getTime() : NaN
  return Number.isNaN(t) ? 0 : t
}

export function sortReceipts(list: Receipt[], sort: ReceiptSort): Receipt[] {
  const amount = (r: Receipt) => reportingTotal(r) ?? 0
  const sorted = [...list]
  if (sort === 'newest') sorted.sort((a, b) => receiptTime(b) - receiptTime(a))
  else if (sort === 'oldest') sorted.sort((a, b) => receiptTime(a) - receiptTime(b))
  else if (sort === 'highest') sorted.sort((a, b) => amount(b) - amount(a))
  else sorted.sort((a, b) => amount(a) - amount(b))
  return sorted
}

export interface DayGroup {
  /** "2026-11-13", or null for receipts the parser couldn't date. */
  key: string | null
  rows: Receipt[]
  total: number
}

/**
 * Receipts grouped by calendar day, each group with its own total. Undated
 * receipts form one group that always sorts last: they have no place in a
 * date order, and "biggest day" shouldn't be won by a pile of unknowns.
 */
export function byDay(receipts: Receipt[], sort: DaySort): DayGroup[] {
  const map = new Map<string, DayGroup>()
  const undated: Receipt[] = []
  for (const r of receipts) {
    const key = dayKey(r.date)
    if (!key) {
      undated.push(r)
      continue
    }
    const group = map.get(key) ?? { key, rows: [], total: 0 }
    group.rows.push(r)
    group.total += reportingTotal(r) ?? 0
    map.set(key, group)
  }
  const groups = Array.from(map.values())
  if (sort === 'newest') groups.sort((a, b) => (a.key! < b.key! ? 1 : -1))
  else if (sort === 'oldest') groups.sort((a, b) => (a.key! < b.key! ? -1 : 1))
  else groups.sort((a, b) => b.total - a.total)
  // Within a day, the largest receipt leads: time of day is rarely recorded
  // (most dates are midnight), so amount is the only meaningful order there.
  for (const g of groups) g.rows.sort((a, b) => (reportingTotal(b) ?? 0) - (reportingTotal(a) ?? 0))
  if (undated.length > 0) groups.push({ key: null, rows: undated, total: sumTotals(undated) })
  return groups
}
