import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { StatTile } from '../components/StatTile'
import { reportingTotal, isExpenseReceipt } from '../lib/receiptShape'
import { monthKey } from '../lib/months'

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
  // Stable for the component's lifetime rather than recomputed on every
  // render — matches the pattern used by the other Reports pages, and keeps
  // the memos below honestly dependent on just `expenseReceipts`.
  const currentMonthKey = useMemo(() => monthKey(new Date()), [])

  // Local Transfer / Credit Card Bill Payment are money moving between
  // accounts, not spend — every total/chart below is expense-only. They're
  // still browsable (just not summed here) via the By Category page.
  const expenseReceipts = useMemo(() => receipts.filter(isExpenseReceipt), [receipts])

  const totalSpend = useMemo(
    () => expenseReceipts.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [expenseReceipts]
  )

  const thisMonthSpend = useMemo(
    () => expenseReceipts
      .filter((r) => r.date && monthKey(new Date(r.date)) === currentMonthKey)
      .reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [expenseReceipts, currentMonthKey]
  )

  // One bar per of the last 3 calendar months (this one included, partial or
  // not) — a quick trend read, separate from the full month-by-month drill-down.
  const last3Months = useMemo(() => {
    const now = new Date()
    const months: { key: string; label: string; total: number }[] = []
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthKey(d)
      const total = expenseReceipts
        .filter((r) => r.date && monthKey(new Date(r.date)) === key)
        .reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
      months.push({ key, label: d.toLocaleDateString(undefined, { month: 'short' }), total })
    }
    return months
  }, [expenseReceipts])
  const maxMonth = Math.max(1, ...last3Months.map((m) => m.total))

  // Category split for the current month only — the all-time version lives on
  // the dedicated By Category page so this page doesn't turn back into a long list.
  const thisMonthByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of expenseReceipts) {
      if (!r.date || monthKey(new Date(r.date)) !== currentMonthKey) continue
      const key = r.category || 'Miscellaneous'
      map.set(key, (map.get(key) ?? 0) + (reportingTotal(r) ?? 0))
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [expenseReceipts, currentMonthKey])
  const maxCategory = Math.max(1, ...thisMonthByCategory.map(([, total]) => total))

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Reports</h1>

      <div className="mt-3 flex gap-2">
        <StatTile label="Total" value={formatMoney(totalSpend, defaultCurrency)} />
        <StatTile label="This Month" value={formatMoney(thisMonthSpend, defaultCurrency)} />
        <StatTile label="Receipts" value={String(receipts.length)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          to="/reports/monthly"
          className="flex flex-col gap-1 rounded-2xl border-2 border-teal-600 bg-teal-50 p-4 active:bg-teal-100 dark:border-teal-500 dark:bg-teal-950/40 dark:active:bg-teal-950/70"
        >
          <span className="text-2xl" aria-hidden="true">📅</span>
          <span className="text-base font-bold text-teal-900 dark:text-teal-100">Monthly</span>
          <span className="text-xs text-teal-800/80 dark:text-teal-300/80">Spend broken down by month</span>
        </Link>
        <Link
          to="/reports/categories"
          className="flex flex-col gap-1 rounded-2xl border-2 border-teal-600 bg-teal-50 p-4 active:bg-teal-100 dark:border-teal-500 dark:bg-teal-950/40 dark:active:bg-teal-950/70"
        >
          <span className="text-2xl" aria-hidden="true">🏷️</span>
          <span className="text-base font-bold text-teal-900 dark:text-teal-100">By Category</span>
          <span className="text-xs text-teal-800/80 dark:text-teal-300/80">Spend broken down by category</span>
        </Link>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Last 3 Months</h2>
      <div className="mt-2 flex items-end gap-3 rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800" style={{ height: 120 }}>
        {last3Months.map((m) => (
          <Link key={m.key} to={`/reports/monthly/${m.key}`} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-teal-600"
              style={{ height: `${Math.max(4, (m.total / maxMonth) * 80)}px` }}
              title={formatMoney(m.total, defaultCurrency)}
            />
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{m.label}</span>
          </Link>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">This Month by Category</h2>
      <div className="mt-2 flex flex-col gap-2">
        {thisMonthByCategory.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No spending this month.</p>
        )}
        {thisMonthByCategory.map(([category, total]) => (
          <Link
            key={category}
            to={`/reports/category/${encodeURIComponent(category)}?month=${currentMonthKey}`}
            className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-900 dark:text-neutral-50">{category}</span>
              <span className="font-semibold text-neutral-900 dark:text-neutral-50">
                {formatMoney(total, defaultCurrency)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${(total / maxCategory) * 100}%` }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
