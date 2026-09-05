import { Link } from 'react-router-dom'
import type { Receipt } from '../types/receipt'
import { CategoryBadge } from './CategoryBadge'
import { reportingTotal, reportingCurrency, needsReview, hasMergedSources, receiptSourceLabels } from '../lib/receiptShape'
import { useSettings } from '../hooks/useSettings'

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
  const { nameFor } = useSettings()
  // Only label other people's receipts — tagging every one of your own with
  // "You" is noise on the screen you look at most.
  const owner = nameFor(receipt.userId)
  const showOwner = owner !== null && owner !== 'You'
  const unreviewed = needsReview(receipt)
  const sourceLabel = receipt.source === 'sms' ? 'SMS'
    : receipt.source === 'gmail' ? 'Email'
    : receipt.source === 'photo' ? 'Photo' : null
  const merged = hasMergedSources(receipt)

  return (
    <Link
      to={`/receipts/${receipt.id}/edit`}
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${
        unreviewed
          ? 'border-amber-400 bg-amber-50 dark:border-amber-600/60 dark:bg-amber-950/30'
          : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-neutral-900 dark:text-neutral-50">
          {receipt.merchant || 'Unknown merchant'}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>{formatDate(receipt.date)}</span>
          {receipt.cardLast4 && <span>•••• {receipt.cardLast4}</span>}
        </div>
        {(receipt.category || showOwner || receipt.visibility === 'private' || sourceLabel || unreviewed || merged) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {unreviewed && (
              <span className="inline-block rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                Check
              </span>
            )}
            {merged && (
              <span
                title={`Combined data from ${receiptSourceLabels(receipt).join(' + ')}`}
                className="inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-900/50 dark:text-teal-300"
              >
                🔗 Merged
              </span>
            )}
            {receipt.category && <CategoryBadge category={receipt.category} />}
            {sourceLabel && (
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {sourceLabel}
              </span>
            )}
            {showOwner && (
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {owner}
              </span>
            )}
            {receipt.visibility === 'private' && (
              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                Private
              </span>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right font-semibold text-neutral-900 dark:text-neutral-50">
        {total != null ? formatMoney(total, currency) : '—'}
      </div>
    </Link>
  )
}
