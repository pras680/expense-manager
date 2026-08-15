import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { StatTile } from '../components/StatTile'
import { reportingTotal, isExpenseReceipt } from '../lib/receiptShape'

const NON_EXPENSE_REPORT_CATEGORIES = ['Local Transfer', 'Credit Card Bill Payment'] as const

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(0)}`
  }
}

export function ReportsOverviewPage() {
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  // Local Transfer / Credit Card Bill Payment are money moving between
  // accounts, not spend — every total/chart below is expense-only. They get
  // their own section further down instead.
  const expenseReceipts = useMemo(() => receipts.filter(isExpenseReceipt), [receipts])

  const totalSpend = useMemo(
    () => expenseReceipts.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [expenseReceipts]
  )

  const thisMonthSpend = useMemo(() => {
    const now = new Date()
    return expenseReceipts
      .filter((r) => {
        if (!r.date) return false
        const d = new Date(r.date)
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      })
      .reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
  }, [expenseReceipts])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of expenseReceipts) {
      const key = r.category || 'Miscellaneous'
      map.set(key, (map.get(key) ?? 0) + (reportingTotal(r) ?? 0))
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [expenseReceipts])

  const notCountedAsSpend = useMemo(() => {
    return NON_EXPENSE_REPORT_CATEGORIES.map((category) => {
      const inCategory = receipts.filter((r) => (r.category || '') === category)
      const total = inCategory.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
      return { category, total, count: inCategory.length }
    }).filter((c) => c.count > 0)
  }, [receipts])

  const last7Days = useMemo(() => {
    const days: { label: string; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      const total = expenseReceipts
        .filter((r) => {
          if (!r.date) return false
          const t = new Date(r.date).getTime()
          return t >= d.getTime() && t < next.getTime()
        })
        .reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
      days.push({ label: d.toLocaleDateString(undefined, { weekday: 'short' }), total })
    }
    return days
  }, [expenseReceipts])

  const maxDay = Math.max(1, ...last7Days.map((d) => d.total))

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Reports</h1>
        <Link to="/reports/monthly" className="text-sm font-medium text-teal-700 dark:text-teal-400">
          Monthly →
        </Link>
      </div>

      <div className="mt-3 flex gap-2">
        <StatTile label="Total" value={formatMoney(totalSpend, defaultCurrency)} />
        <StatTile label="This Month" value={formatMoney(thisMonthSpend, defaultCurrency)} />
        <StatTile label="Receipts" value={String(receipts.length)} />
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Last 7 Days</h2>
      <div className="mt-2 flex items-end gap-2 rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800" style={{ height: 120 }}>
        {last7Days.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-teal-600"
              style={{ height: `${Math.max(4, (d.total / maxDay) * 80)}px` }}
              title={formatMoney(d.total, defaultCurrency)}
            />
            <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{d.label}</span>
          </div>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">By Category</h2>
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
