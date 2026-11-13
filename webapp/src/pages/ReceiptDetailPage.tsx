import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { getSignedUrl, markReceiptsReviewed } from '../lib/supabaseClient'
import {
  displayReceiptAmount, displayReceiptCurrency, hasMergedSources, needsReview, receiptSourceLabels,
  reportingCurrency, reportingTotal
} from '../lib/receiptShape'
import { formatDate, formatMoney } from '../lib/format'
import { receiptCategory, receiptMerchant, receiptMonthKey, ALL_TIME } from '../lib/insights'
import { extendTrail, useTrail } from '../lib/trail'
import { PageHeader } from '../components/PageHeader'
import { CategoryIcon } from '../components/CategoryIcon'
import { Card, CardTitle, EmptyState, NavRow, Notice, btn } from '../components/ui'
import { Icon } from '../components/Icon'

// The bottom of every drill-down: one receipt, read-only. Editing is one tap
// away, but the default view is for reading — what was paid, where, how, and
// how the app came to believe that.

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3.5 text-[15px] last:border-b-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium break-words text-ink">{children}</span>
    </div>
  )
}

export function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { receipts, loading, patchReceiptLocal } = useReceipts()
  const { defaultCurrency, nameFor } = useSettings()
  const { session } = useAuth()
  const trail = useTrail([{ label: 'Receipts', to: '/receipts' }])
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stored receipt images aren't publicly readable; a short-lived signed URL
  // is fetched only when the image is actually asked for.
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)

  const receipt = receipts.find((r) => r.id === id)

  if (!receipt) {
    return (
      <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6">
        <PageHeader backTo="/receipts" trail={trail} />
        <EmptyState>{loading ? 'Loading…' : 'This receipt no longer exists.'}</EmptyState>
      </div>
    )
  }

  const total = reportingTotal(receipt)
  const currency = reportingCurrency(receipt) || defaultCurrency
  const originalAmount = displayReceiptAmount(receipt)
  const originalCurrency = displayReceiptCurrency(receipt)
  const isForeign = originalAmount != null && originalCurrency !== currency
  const unreviewed = needsReview(receipt)
  const owner = nameFor(receipt.userId)
  const month = receiptMonthKey(receipt) ?? ALL_TIME
  const category = receiptCategory(receipt)
  const merchant = receiptMerchant(receipt)
  const paidWith = [receipt.cardBank, receipt.cardLast4 ? `•••• ${receipt.cardLast4}` : null].filter(Boolean).join(' ')
  const isTransfer = receipt.category === 'Local Transfer'
  const down = extendTrail(trail, { label: merchant, to: `/receipts/${receipt.id}` })

  async function approve() {
    if (!session?.userId || approving || !receipt) return
    setApproving(true)
    setError(null)
    try {
      await markReceiptsReviewed([receipt.id], session.userId)
      patchReceiptLocal(receipt.id, { reviewedAt: new Date().toISOString() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApproving(false)
    }
  }

  async function showImage() {
    if (!receipt?.fileUrl || imageBusy) return
    setImageBusy(true)
    setError(null)
    try {
      const url = await getSignedUrl(receipt.fileUrl)
      if (url) setImageUrl(url)
      else setError('Couldn’t load the receipt image.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImageBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6">
      <PageHeader backTo="/receipts" trail={trail} />

      <Card className="p-[22px]">
        <div className="flex items-center gap-3">
          <CategoryIcon category={receipt.category} size={36} />
          <span className="text-sm text-muted">{category}</span>
        </div>
        <h1 className="mt-4 font-display text-2xl leading-tight font-semibold tracking-tight break-words text-ink">
          {receipt.merchant || 'Unknown merchant'}
        </h1>
        <div className="mt-2 font-display text-[52px] leading-none font-semibold tracking-tighter text-ink">
          {total != null ? formatMoney(total, currency, { cents: true }) : '—'}
        </div>
        <p className="mt-3 text-sm text-muted">
          {formatDate(receipt.date)}
          {isForeign && originalAmount != null && (
            <> · paid {formatMoney(originalAmount, originalCurrency, { cents: true, code: true })}
              {receipt.conversionRate ? ` at ${receipt.conversionRate.toFixed(4)}` : ''}</>
          )}
        </p>
        {(unreviewed || hasMergedSources(receipt) || receipt.visibility === 'private') && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {unreviewed && (
              <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent">Needs a check</span>
            )}
            {hasMergedSources(receipt) && (
              <span className="flex items-center gap-1 rounded-full bg-card-2 px-2.5 py-1 text-xs font-medium text-ink">
                <Icon name="link" size={12} /> Merged
              </span>
            )}
            {receipt.visibility === 'private' && (
              <span className="flex items-center gap-1 rounded-full bg-card-2 px-2.5 py-1 text-xs font-medium text-ink">
                <Icon name="lock" size={12} /> Private
              </span>
            )}
          </div>
        )}
      </Card>

      {error && <Notice tone="error" role="alert">{error}</Notice>}

      <div className="flex gap-2.5">
        {unreviewed && (
          <button type="button" onClick={approve} disabled={approving} className={`${btn.primary} flex-1`}>
            <Icon name="check" size={18} />
            {approving ? 'Saving…' : 'Looks right'}
          </button>
        )}
        <Link to={`/receipts/${receipt.id}/edit`} className={`${btn.secondary} flex-1`}>
          <Icon name="pencil" size={18} />
          Edit
        </Link>
      </div>

      <Card className="px-[18px] py-1">
        {paidWith && <Fact label="Paid with">{paidWith}</Fact>}
        {isTransfer && (receipt.transferFromBank || receipt.transferToBank) && (
          <Fact label="Transfer">
            {receipt.transferFromBank || '—'} → {receipt.transferToBank || '—'}
            {receipt.transferKind ? ` (${receipt.transferKind === 'self' ? 'own account' : 'someone else'})` : ''}
          </Fact>
        )}
        <Fact label="Came from">{receiptSourceLabels(receipt).join(' + ')}</Fact>
        {owner && <Fact label="Added by">{owner}</Fact>}
        <Fact label="Visible to">{receipt.visibility === 'private' ? 'Only you' : 'The household'}</Fact>
        <Fact label="Status">{unreviewed ? 'Needs a check' : 'Checked'}</Fact>
      </Card>

      {receipt.lineItems.length > 0 && (
        <Card className="px-[18px] pt-2 pb-1">
          <CardTitle>Items</CardTitle>
          {receipt.lineItems.map((item, i) => (
            <div key={`${i}-${item.description}`} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[15px] last:border-b-0">
              <span className="min-w-0 break-words text-ink">{item.description}</span>
              {item.amount != null && (
                <span className="shrink-0 font-display font-medium text-ink">
                  {formatMoney(item.amount, originalCurrency, { cents: true, code: isForeign })}
                </span>
              )}
            </div>
          ))}
        </Card>
      )}

      {receipt.comment && (
        <Card className="p-[18px]">
          <div className="text-[13px] text-muted">How it was read</div>
          <p className="mt-1.5 text-[15px] leading-relaxed break-words whitespace-pre-line text-ink">{receipt.comment}</p>
        </Card>
      )}

      {receipt.fileUrl && (
        imageUrl ? (
          <img src={imageUrl} alt={`Receipt from ${merchant}`} className="w-full rounded-3xl" />
        ) : (
          <button type="button" onClick={showImage} disabled={imageBusy} className={btn.secondary}>
            <Icon name="receipt" size={18} />
            {imageBusy ? 'Loading…' : 'Show the original receipt'}
          </button>
        )
      )}

      {/* Sideways from the leaf: the same merchant and category, in context. */}
      <Card className="px-[18px]">
        <NavRow
          to={`/reports/merchant/${encodeURIComponent(merchant)}?month=${ALL_TIME}`}
          state={down}
          label={`Everything from ${merchant}`}
        />
        <div className="border-t border-line" />
        <NavRow
          to={`/reports/category/${encodeURIComponent(category)}?month=${month}`}
          state={down}
          label={`More ${category}`}
        />
      </Card>
    </div>
  )
}
