import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReceiptForm, type ReceiptFormValues } from '../components/ReceiptForm'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { insertReceipt, parseReceiptText, type ReceiptWriteInput } from '../lib/supabaseClient'
import { DEFAULT_CURRENCY } from '../lib/categories'

const MAX_RAW_TEXT_CHARS = 18_000

function emptyFormValues(rawText: string): ReceiptFormValues {
  return {
    merchant: '',
    date: new Date().toISOString().slice(0, 10),
    receiptAmount: '',
    receiptCurrency: DEFAULT_CURRENCY,
    category: 'Miscellaneous',
    cardLast4: '',
    cardBank: '',
    rawText,
    fileUrl: null
  }
}

export function AddReceiptPage() {
  const navigate = useNavigate()
  const { refresh } = useReceipts()
  const { defaultCurrency } = useSettings()

  const [rawText, setRawText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<ReceiptFormValues | null>(null)

  async function handleParse() {
    const trimmed = rawText.trim()
    if (!trimmed) return
    setParsing(true)
    setParseError(null)
    try {
      const parsed = await parseReceiptText(trimmed.slice(0, MAX_RAW_TEXT_CHARS))
      setFormValues({
        merchant: parsed.merchant?.trim() || '',
        date: parsed.date ? String(parsed.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
        receiptAmount: parsed.total != null ? String(parsed.total) : '',
        receiptCurrency: parsed.currency || DEFAULT_CURRENCY,
        category: parsed.category || 'Miscellaneous',
        cardLast4: parsed.card_last4 || '',
        cardBank: parsed.card_bank || '',
        rawText: trimmed,
        fileUrl: null
      })
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
      // Always let the user proceed to the form even if parsing fails.
      setFormValues(emptyFormValues(trimmed))
    } finally {
      setParsing(false)
    }
  }

  async function handleSubmit(input: ReceiptWriteInput) {
    await insertReceipt(input)
    await refresh()
    navigate('/')
  }

  if (!formValues) {
    return (
      <div className="px-4 pt-4 pb-6">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Add Receipt</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Paste the receipt or SMS text below, then review before saving.
        </p>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value.slice(0, MAX_RAW_TEXT_CHARS))}
          rows={8}
          placeholder="Paste receipt text, SMS alert, or email content…"
          className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="mt-1 text-right text-xs text-neutral-400">
          {rawText.length}/{MAX_RAW_TEXT_CHARS}
        </div>

        {parseError && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Parsing failed ({parseError}). You can still fill in the details manually.
          </div>
        )}

        <div className="mt-3 flex gap-3">
          <button
            onClick={handleParse}
            disabled={parsing || !rawText.trim()}
            className="flex-1 rounded-lg bg-teal-700 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {parsing ? 'Parsing…' : 'Parse & Review'}
          </button>
          <button
            onClick={() => setFormValues(emptyFormValues(rawText.trim()))}
            className="rounded-lg bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
          >
            Skip
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Review Receipt</h1>
        <button
          onClick={() => setFormValues(null)}
          className="text-sm text-neutral-500 dark:text-neutral-400"
        >
          Back
        </button>
      </div>
      <div className="mt-4">
        <ReceiptForm
          initial={formValues}
          defaultCurrency={defaultCurrency}
          submitLabel="Save Receipt"
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  )
}
