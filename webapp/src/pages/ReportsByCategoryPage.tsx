import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { ReceiptCard } from '../components/ReceiptCard'
import { reportingTotal } from '../lib/receiptShape'
import { useSettings } from '../hooks/useSettings'

export function ReportsByCategoryPage() {
  const { category } = useParams<{ category: string }>()
  const decoded = decodeURIComponent(category ?? '')
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const filtered = useMemo(
    () => receipts.filter((r) => (r.category || 'Miscellaneous') === decoded),
    [receipts, decoded]
  )
  const total = useMemo(
    () => filtered.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [filtered]
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
      <Link to="/reports" className="text-sm text-teal-700 dark:text-teal-400">← Reports</Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">{decoded}</h1>
        <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{formatMoney(total)}</span>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No receipts in this category.</p>
        ) : (
          filtered.map((r) => <ReceiptCard key={r.id} receipt={r} />)
        )}
      </div>
    </div>
  )
}
