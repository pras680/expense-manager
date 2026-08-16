import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { ReceiptCard } from '../components/ReceiptCard'
import { PageHeader } from '../components/PageHeader'
import { reportingTotal, isExpenseReceipt } from '../lib/receiptShape'
import { monthKey, monthLabel } from '../lib/months'
import { useSettings } from '../hooks/useSettings'

// Sentinel path segment meaning "don't filter by category" — safe because it
// can never collide with a real category (the fixed list in categories.ts is
// all specific nouns like "Groceries"; 'Miscellaneous' is the only fallback).
const ALL_CATEGORIES = 'All'

export function ReportsByCategoryPage() {
  const { category } = useParams<{ category: string }>()
  const decoded = decodeURIComponent(category ?? '')
  const isAll = decoded === ALL_CATEGORIES
  const [searchParams] = useSearchParams()
  // Present only when reached from a Monthly Report drill-down — narrows this
  // otherwise all-time category list down to that one month.
  const month = searchParams.get('month')
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const filtered = useMemo(
    () => receipts.filter((r) => {
      if (!isAll && (r.category || 'Miscellaneous') !== decoded) return false
      if (!month) return true
      if (!r.date) return false
      const d = new Date(r.date)
      return !Number.isNaN(d.getTime()) && monthKey(d) === month
    }),
    [receipts, decoded, isAll, month]
  )
  // "All" mixes expense and non-expense receipts (transfers, card bill
  // payments) so the list is genuinely complete, but the header total stays
  // expense-only — it has to agree with the "Total" stat tile the user just
  // came from on the month page, which never counts money moving between
  // accounts as spend. A single category's total has no such ambiguity: it's
  // always just the sum of that one category.
  const total = useMemo(
    () => filtered
      .filter((r) => !isAll || isExpenseReceipt(r))
      .reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [filtered, isAll]
  )

  function formatMoney(amount: number) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: defaultCurrency }).format(amount)
    } catch {
      return `${defaultCurrency} ${amount.toFixed(2)}`
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader
        title={month
          ? `${isAll ? 'All Receipts' : decoded} · ${monthLabel(month)}`
          : (isAll ? 'All Receipts' : decoded)}
        backTo={month ? `/reports/monthly/${month}` : '/reports'}
        action={
          <span className="shrink-0 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {formatMoney(total)}
          </span>
        }
      />

      <div className="mt-3 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {isAll ? 'No receipts.' : 'No receipts in this category.'}
          </p>
        ) : (
          filtered.map((r) => <ReceiptCard key={r.id} receipt={r} />)
        )}
      </div>
    </div>
  )
}
