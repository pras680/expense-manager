import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { PageHeader } from '../components/PageHeader'
import { reportingTotal, isExpenseReceipt } from '../lib/receiptShape'

const NON_EXPENSE_REPORT_CATEGORIES = ['Local Transfer', 'Credit Card Bill Payment'] as const

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(0)}`
  }
}

export function ReportsCategoriesPage() {
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of receipts.filter(isExpenseReceipt)) {
      const key = r.category || 'Miscellaneous'
      map.set(key, (map.get(key) ?? 0) + (reportingTotal(r) ?? 0))
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [receipts])

  const notCountedAsSpend = useMemo(() => {
    return NON_EXPENSE_REPORT_CATEGORIES.map((category) => {
      const inCategory = receipts.filter((r) => (r.category || '') === category)
      const total = inCategory.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
      return { category, total, count: inCategory.length }
    }).filter((c) => c.count > 0)
  }, [receipts])

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader title="By Category" backTo="/reports" />

      <h2 className="mt-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">All Time</h2>
      <div className="mt-2 flex flex-col gap-2">
        {byCategory.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No receipts yet.</p>
        )}
        {byCategory.map(([category, total]) => (
          <Link
            key={category}
            to={`/reports/category/${encodeURIComponent(category)}`}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{category}</span>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {formatMoney(total, defaultCurrency)}
            </span>
          </Link>
        ))}
      </div>

      {notCountedAsSpend.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Not Counted as Spend</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Money that moved, but wasn't spent — kept out of the totals above.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {notCountedAsSpend.map(({ category, total, count }) => (
              <Link
                key={category}
                to={`/reports/category/${encodeURIComponent(category)}`}
                className="flex items-center justify-between rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900/50"
              >
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {category} <span className="text-neutral-400 dark:text-neutral-500">· {count}</span>
                </span>
                <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {formatMoney(total, defaultCurrency)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
