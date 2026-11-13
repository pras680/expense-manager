import { monthLabel } from './months'
import { ALL_TIME } from './insights'

// A "period" on the Insights pages is either one month ("2026-11") or all time.

export function isMonthKey(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value)
}

/** "November 2026" / "All time". */
export function periodLabel(period: string | null | undefined): string {
  return isMonthKey(period) ? monthLabel(period) : 'All time'
}

/** "Nov 2026" / "All time" — for breadcrumb chips, where space is tight. */
export function periodShortLabel(period: string | null | undefined): string {
  if (!isMonthKey(period)) return 'All time'
  const [year, month] = period.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** Normalises a ?month= value: a valid month key, or ALL_TIME for anything else. */
export function readPeriod(value: string | null): string {
  return isMonthKey(value) ? value : ALL_TIME
}
