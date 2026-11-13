import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ReceiptForm, type ReceiptFormValues } from '../components/ReceiptForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { Icon } from '../components/Icon'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { updateReceipt, deleteReceipt, type ReceiptWriteInput } from '../lib/supabaseClient'
import { displayReceiptAmount, displayReceiptCurrency, hasMergedSources, receiptSourceLabels } from '../lib/receiptShape'
import { DEFAULT_CURRENCY } from '../lib/categories'
import { goBack } from '../lib/navigation'

export function EditReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { receipts, refresh } = useReceipts()
  const { defaultCurrency } = useSettings()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const receipt = receipts.find((r) => r.id === id)

  if (!receipt) {
    return (
      <div className="px-4 pt-4">
        <PageHeader title="Edit receipt" backTo="/receipts" />
        <p className="px-2 py-10 text-center text-[15px] text-muted">This receipt no longer exists.</p>
      </div>
    )
  }

  const initial: ReceiptFormValues = {
    merchant: receipt.merchant || '',
    date: receipt.date ? receipt.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    receiptAmount: displayReceiptAmount(receipt) != null ? String(displayReceiptAmount(receipt)) : '',
    receiptCurrency: displayReceiptCurrency(receipt) || DEFAULT_CURRENCY,
    category: receipt.category || 'Miscellaneous',
    cardLast4: receipt.cardLast4 || '',
    cardBank: receipt.cardBank || '',
    transferFromBank: receipt.transferFromBank || '',
    transferToBank: receipt.transferToBank || '',
    transferKind: receipt.transferKind || '',
    rawText: receipt.rawText,
    lineItems: receipt.lineItems,
    fileUrl: receipt.fileUrl,
    visibility: receipt.visibility,
    source: receipt.source,
    comment: receipt.comment || ''
  }

  async function handleSubmit(input: ReceiptWriteInput) {
    await updateReceipt(receipt!.id, input)
    await refresh()
    // Pop back to wherever this edit was opened from (the receipt's own page)
    // instead of pushing a fresh entry — a push would leave this now-stale
    // edit screen sitting in the back stack, so the next back tap would land
    // right back on it instead of leaving the flow.
    goBack(navigate, `/receipts/${receipt!.id}`)
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteReceipt(receipt!.id)
      await refresh()
      // This screen is opened from the receipt's own page, which no longer
      // has anything to show: pop past both when there's history for it,
      // otherwise land on the list.
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
      if (idx >= 2) navigate(-2)
      else navigate('/receipts', { replace: true })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader
        title="Edit receipt"
        backTo={`/receipts/${receipt.id}`}
        action={
          <button
            onClick={() => setConfirmingDelete(true)}
            className="flex h-11 shrink-0 items-center rounded-full bg-card px-4 text-sm font-semibold text-red-600 dark:text-red-400"
          >
            Delete
          </button>
        }
      />
      {hasMergedSources(receipt) && (
        <div className="mt-3 flex gap-2.5 rounded-2xl bg-card px-4 py-3 text-sm text-ink">
          <Icon name="link" size={18} className="mt-0.5 shrink-0 text-muted" />
          <p>
            Merged: this receipt combines data from {receiptSourceLabels(receipt).join(' + ')}. A later import of
            the same charge was folded in here instead of creating a duplicate.
          </p>
        </div>
      )}
      <div className="mt-4">
        <ReceiptForm
          initial={initial}
          defaultCurrency={defaultCurrency}
          submitLabel="Save Changes"
          onSubmit={handleSubmit}
        />
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this receipt?"
          message={`This will permanently remove "${receipt.merchant || 'this receipt'}". This can't be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
