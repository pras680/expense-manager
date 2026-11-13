// One place for how money and dates read across the app, so a total on Home
// and the same total on Insights can't be formatted two different ways.

/**
 * Summary figures (totals, averages) drop the cents: they're noise at display
 * size. Individual receipts keep them — pass `{ cents: true }`.
 *
 * Amounts show the bare symbol ("$1,168") rather than the code ("SGD 1,168"):
 * nearly every figure in the app is in the viewer's own default currency, and
 * the code in front of each one crowds the large numerals. Where the currency
 * itself is the point (a receipt paid in another currency), pass `{ code: true }`.
 */
export function formatMoney(
  amount: number,
  currency: string,
  opts: { cents?: boolean; code?: boolean } = {}
): string {
  const digits = opts.cents ? 2 : 0
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: opts.code ? 'code' : 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(amount)
  } catch {
    // An unknown currency code makes Intl throw; show the raw code instead.
    return `${currency} ${amount.toFixed(digits)}`
  }
}

/** "13 Nov 2026", or "No date" for a receipt the parser couldn't date. */
export function formatDate(iso: string | null): string {
  if (!iso) return 'No date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'No date'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Local calendar day, "2026-11-13" — the key receipts are grouped by in lists. */
export function dayKey(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Today", "Yesterday", or "Thu 12 Nov" (with the year once it isn't this one). */
export function dayLabel(key: string, now = new Date()): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(y === now.getFullYear() ? {} : { year: 'numeric' })
  })
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
