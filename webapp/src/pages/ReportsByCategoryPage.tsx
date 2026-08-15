import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { ReceiptCard } from '../components/ReceiptCard'
import { PageHeader } from '../components/PageHeader'
import { reportingTotal } from '../lib/receiptShape'
import { monthKey, monthLabel } from '../lib/months'
import { useSettings } from '../hooks/useSettings'

export function ReportsByCategoryPage() {
  const { category } = useParams<{ category: string }>()
  const decoded = decodeURIComponent(category ?? '')
  const [searchParams] = useSearchParams()
  // Present only when reached from a Monthly Report drill-down — narrows this
  // otherwise all-time category list down to that one month.
  const month = searchParams.get('month')
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const filtered = useMemo(
    () => receipts.filter((r) => {
      if ((r.category || 'Miscellaneous') !== decoded) return false
      if (!month) return true
      if (!r.date) return false
      const d = new Date(r.date)
      return !Number.isNaN(d.getTime()) && monthKey(d) === month
    }),
    [receipts, decoded, month]
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
      <PageHeader
        title={month ? `${decoded} · ${monthLabel(month)}` : decoded}
        backTo={month ? `/reports/monthly/${month}` : '/reports'}
        action={
          <span className="shrink-0 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {formatMoney(total)}
          </span>
        }
      />

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
