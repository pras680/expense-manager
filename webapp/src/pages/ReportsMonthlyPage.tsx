import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { PageHeader } from '../components/PageHeader'
import { reportingTotal, isExpenseReceipt } from '../lib/receiptShape'
import { monthKey, monthLabel } from '../lib/months'

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(0)}`
  }
}

export function ReportsMonthlyPage() {
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const months = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>()
    for (const r of receipts) {
      if (!r.date) continue
      const d = new Date(r.date)
      if (Number.isNaN(d.getTime())) continue
      const key = monthKey(d)
      const entry = map.get(key) ?? { total: 0, count: 0 }
      // Every receipt counts toward the month's receipt count, but only real
      // spend (not Local Transfer / Credit Card Bill Payment) toward its total
      // — matches the definition used everywhere else in Reports.
      entry.count += 1
      if (isExpenseReceipt(r)) entry.total += reportingTotal(r) ?? 0
      map.set(key, entry)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [receipts])

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader title="Monthly Reports" backTo="/reports" />

      <div className="mt-3 flex flex-col gap-2">
        {months.length === 0 && (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No receipts yet.</p>
        )}
        {months.map(([key, { total, count }]) => (
          <Link
            key={key}
            to={`/reports/monthly/${key}`}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div>
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{monthLabel(key)}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {count} receipt{count === 1 ? '' : 's'}
              </div>
            </div>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {formatMoney(total, defaultCurrency)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
