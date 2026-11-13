import type { Receipt } from '../types/receipt'
import { isExpenseReceipt, reportingTotal } from './receiptShape'
import { monthKey } from './months'

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
