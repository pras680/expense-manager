import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { PageHeader } from '../components/PageHeader'
import { StatTile } from '../components/StatTile'
import { reportingTotal, isExpenseReceipt } from '../lib/receiptShape'
import { monthKey, monthLabel } from '../lib/months'

const NON_EXPENSE_REPORT_CATEGORIES = ['Local Transfer', 'Credit Card Bill Payment'] as const

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function ReportsMonthDetailPage() {
  const { month } = useParams<{ month: string }>()
  const key = month ?? ''
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const inMonth = useMemo(
    () => receipts.filter((r) => {
      if (!r.date) return false
      const d = new Date(r.date)
      return !Number.isNaN(d.getTime()) && monthKey(d) === key
    }),
    [receipts, key]
  )

  const expenseInMonth = useMemo(() => inMonth.filter(isExpenseReceipt), [inMonth])

  const total = useMemo(
    () => expenseInMonth.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [expenseInMonth]
  )

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of expenseInMonth) {
      const cat = r.category || 'Miscellaneous'
      map.set(cat, (map.get(cat) ?? 0) + (reportingTotal(r) ?? 0))
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [expenseInMonth])

  const notCountedAsSpend = useMemo(() => {
    return NON_EXPENSE_REPORT_CATEGORIES.map((category) => {
      const rows = inMonth.filter((r) => (r.category || '') === category)
      const catTotal = rows.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
      return { category, total: catTotal, count: rows.length }
    }).filter((c) => c.count > 0)
  }, [inMonth])

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader title={monthLabel(key)} backTo="/reports/monthly" />

      <div className="mt-3 flex gap-2">
        <StatTile label="Total" value={formatMoney(total, defaultCurrency)} />
        <StatTile label="Receipts" value={String(inMonth.length)} />
      </div>

      <Link
        to={`/reports/category/All?month=${key}`}
        className="mt-4 flex items-center justify-between rounded-lg border-2 border-accent-600 bg-accent-50 px-4 py-3 dark:border-accent-500 dark:bg-accent-950/40"
      >
        <span className="text-sm font-bold text-accent-900 dark:text-accent-100">All Receipts</span>
        <span className="text-sm font-semibold text-accent-900 dark:text-accent-100">
          {formatMoney(total, defaultCurrency)}
        </span>
      </Link>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">By Category</h2>
      <div className="mt-2 flex flex-col gap-2">
        {byCategory.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No spending this month.</p>
        )}
        {byCategory.map(([category, catTotal]) => (
          <Link
            key={category}
            to={`/reports/category/${encodeURIComponent(category)}?month=${key}`}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{category}</span>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {formatMoney(catTotal, defaultCurrency)}
            </span>
          </Link>
        ))}
      </div>

      {notCountedAsSpend.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Not Counted as Spend</h2>
          <div className="mt-2 flex flex-col gap-2">
            {notCountedAsSpend.map(({ category, total: catTotal, count }) => (
              <Link
                key={category}
                to={`/reports/category/${encodeURIComponent(category)}?month=${key}`}
                className="flex items-center justify-between rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900/50"
              >
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {category} <span className="text-neutral-400 dark:text-neutral-500">· {count}</span>
                </span>
                <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {formatMoney(catTotal, defaultCurrency)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
