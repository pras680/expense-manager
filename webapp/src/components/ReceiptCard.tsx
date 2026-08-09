import { Link } from 'react-router-dom'
import type { Receipt } from '../types/receipt'
import { CategoryBadge } from './CategoryBadge'
import { reportingTotal, reportingCurrency } from '../lib/receiptShape'

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatDate(iso: string | null) {
  if (!iso) return 'No date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'No date'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const total = reportingTotal(receipt)
  const currency = reportingCurrency(receipt)

  return (
    <Link
      to={`/receipts/${receipt.id}/edit`}
      className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 active:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-neutral-900 dark:text-neutral-50">
          {receipt.merchant || 'Unknown merchant'}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>{formatDate(receipt.date)}</span>
          {receipt.cardLast4 && <span>•••• {receipt.cardLast4}</span>}
        </div>
        {receipt.category && (
          <div className="mt-1.5">
            <CategoryBadge category={receipt.category} />
          </div>
        )}
      </div>
      <div className="shrink-0 text-right font-semibold text-neutral-900 dark:text-neutral-50">
        {total != null ? formatMoney(total, currency) : '—'}
      </div>
    </Link>
  )
}
