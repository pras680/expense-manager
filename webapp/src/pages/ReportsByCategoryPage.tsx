import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { ReceiptCard } from '../components/ReceiptCard'
import { PageHeader } from '../components/PageHeader'
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
      <PageHeader
        title={decoded}
        backTo="/reports"
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
