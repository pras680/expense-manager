import type { Receipt } from '../types/receipt'
import { reportingTotal, isExpenseReceipt } from './receiptShape'

export type SpendingPace = 'no-history' | 'under' | 'on-track' | 'over' | 'well-over'

export interface SpendingInsight {
  /** Spend booked in the current calendar month. */
  thisMonth: number
  /** Mean spend across completed months that have any receipts. */
  monthlyAverage: number
  /** How many completed months the average is drawn from. */
  monthsOfHistory: number
  /**
   * What an average month would have reached by today. The honest comparison:
   * measuring a part-month against a whole-month average always looks like a
   * saving, which would make the assessment misleading for most of the month.
   */
  expectedByNow: number
  /** thisMonth / monthlyAverage, for the meter. Null without history. */
  fractionOfAverage: number | null
  /** Signed share above/below the pro-rated expectation. Null without history. */
  paceDelta: number | null
  pace: SpendingPace
  /** One-line plain-language read on the month so far. */
  assessment: string
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function computeSpendingInsight(receipts: Receipt[], now = new Date()): SpendingInsight {
  const currentKey = monthKey(now)

  // Bucket by month, ignoring undated receipts — they can't be attributed to a
  // month, and folding them into "this month" would overstate it. Money
  // Transfer / Credit Card Bill Payment are excluded too: that money moved
  // between accounts, it wasn't spent, so it shouldn't count toward pace.
  const byMonth = new Map<string, number>()
  for (const r of receipts) {
    if (!r.date || !isExpenseReceipt(r)) continue
    const d = new Date(r.date)
    if (Number.isNaN(d.getTime())) continue
    const amount = reportingTotal(r) ?? 0
    const key = monthKey(d)
    byMonth.set(key, (byMonth.get(key) ?? 0) + amount)
  }

  const thisMonth = byMonth.get(currentKey) ?? 0

  // The current month is partial, so it must not drag the average down. Future
  // months (possible via a mis-parsed date) are excluded for the same reason.
  const completed = Array.from(byMonth.entries())
    .filter(([key]) => key < currentKey)
    .map(([, total]) => total)

  const monthsOfHistory = completed.length
  const monthlyAverage = monthsOfHistory > 0
    ? completed.reduce((sum, n) => sum + n, 0) / monthsOfHistory
    : 0

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const monthProgress = dayOfMonth / daysInMonth
  const expectedByNow = monthlyAverage * monthProgress

  if (monthsOfHistory === 0) {
    return {
      thisMonth,
      monthlyAverage: 0,
      monthsOfHistory: 0,
      expectedByNow: 0,
      fractionOfAverage: null,
      paceDelta: null,
      pace: 'no-history',
      assessment: thisMonth > 0
        ? 'First month of tracking — next month there will be an average to compare against.'
        : 'No spending recorded yet this month.'
    }
  }

  const fractionOfAverage = monthlyAverage > 0 ? thisMonth / monthlyAverage : 0
  // Guard the divide: a household whose only completed months were all zero
  // would otherwise produce Infinity here.
  const paceDelta = expectedByNow > 0 ? (thisMonth - expectedByNow) / expectedByNow : 0

  let pace: SpendingPace
  if (paceDelta > 0.35) pace = 'well-over'
  else if (paceDelta > 0.1) pace = 'over'
  else if (paceDelta < -0.15) pace = 'under'
  else pace = 'on-track'

  const pct = Math.round(Math.abs(paceDelta) * 100)
  const daysLeft = daysInMonth - dayOfMonth
  const assessment = {
    'well-over': `Spending is ${pct}% above your usual pace for day ${dayOfMonth} — noticeably heavier than a typical month.`,
    over: `Running about ${pct}% ahead of your usual pace, with ${daysLeft} day${daysLeft === 1 ? '' : 's'} to go.`,
    'on-track': `Right about on track — roughly a normal month so far, with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`,
    under: `Tracking ${pct}% below your usual pace — a lighter month than normal so far.`,
    'no-history': ''
  }[pace]

  return {
    thisMonth,
    monthlyAverage,
    monthsOfHistory,
    expectedByNow,
    fractionOfAverage,
    paceDelta,
    pace,
    assessment
  }
}

export interface CategorySpend {
  category: string
  amount: number
  /** Share of this month's total expense spend, 0–100 rounded. */
  sharePct: number
  /** Amount relative to the largest category returned — for a comparative bar width, not an absolute measure. */
  barPct: number
}

/** Top categories by spend for the current calendar month, largest first. */
export function computeTopCategories(receipts: Receipt[], now = new Date(), limit = 4): CategorySpend[] {
  const currentKey = monthKey(now)
  const byCategory = new Map<string, number>()
  let total = 0
  for (const r of receipts) {
    if (!r.date || !isExpenseReceipt(r)) continue
    const d = new Date(r.date)
    if (Number.isNaN(d.getTime()) || monthKey(d) !== currentKey) continue
    const amount = reportingTotal(r) ?? 0
    const category = r.category || 'Miscellaneous'
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount)
    total += amount
  }
  if (total <= 0) return []

  const top = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
  const max = top[0]?.[1] ?? 0

  return top.map(([category, amount]) => ({
    category,
    amount,
    sharePct: Math.round((amount / total) * 100),
    barPct: max > 0 ? Math.round((amount / max) * 100) : 0
  }))
}
