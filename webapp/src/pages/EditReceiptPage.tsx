import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ReceiptForm, type ReceiptFormValues } from '../components/ReceiptForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { updateReceipt, deleteReceipt, type ReceiptWriteInput } from '../lib/supabaseClient'
import { displayReceiptAmount, displayReceiptCurrency } from '../lib/receiptShape'
import { DEFAULT_CURRENCY } from '../lib/categories'

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
        <p className="text-sm text-neutral-500">Receipt not found.</p>
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
    rawText: receipt.rawText,
    lineItems: receipt.lineItems,
    fileUrl: receipt.fileUrl,
    visibility: receipt.visibility,
    source: receipt.source
  }

  async function handleSubmit(input: ReceiptWriteInput) {
    await updateReceipt(receipt!.id, input)
    await refresh()
    navigate('/')
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteReceipt(receipt!.id)
      await refresh()
      navigate('/')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader
        title="Edit Receipt"
        backTo="/"
        action={
          <button
            onClick={() => setConfirmingDelete(true)}
            className="shrink-0 px-1 text-sm font-medium text-red-600"
          >
            Delete
          </button>
        }
      />
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
