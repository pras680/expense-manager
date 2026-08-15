import { useState } from 'react'
import { EXPENSE_CATEGORIES, COMMON_CURRENCIES, TRANSFER_KINDS } from '../lib/categories'
import { convertCurrency } from '../lib/currency'
import { findPaymentMethod } from '../lib/supabaseClient'
import type { ReceiptWriteInput } from '../lib/supabaseClient'
import type { ReceiptVisibility, ReceiptSource } from '../types/receipt'

const LOCAL_TRANSFER_CATEGORY = 'Local Transfer'

export interface ReceiptFormValues {
  merchant: string
  date: string // yyyy-mm-dd
  receiptAmount: string
  receiptCurrency: string
  category: string
  cardLast4: string
  cardBank: string
  transferFromBank: string
  transferToBank: string
  transferKind: 'self' | 'external' | ''
  rawText: string
  lineItems: { description: string; amount: number | null }[]
  fileUrl: string | null
  visibility: ReceiptVisibility
  source: ReceiptSource
}

interface ReceiptFormProps {
  initial: ReceiptFormValues
  defaultCurrency: string
  submitLabel: string
  onSubmit: (input: ReceiptWriteInput) => Promise<void>
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10)
}

export function ReceiptForm({ initial, defaultCurrency, submitLabel, onSubmit }: ReceiptFormProps) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isTransfer = values.category === LOCAL_TRANSFER_CATEGORY

  function set<K extends keyof ReceiptFormValues>(key: K, value: ReceiptFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  async function handleCardLast4Blur() {
    const digits = values.cardLast4.replace(/[^0-9]/g, '').slice(-4)
    if (digits.length !== 4) return
    const match = await findPaymentMethod(digits)
    set('cardLast4', digits)
    if (match) set('cardBank', match.bankName)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const merchant = values.merchant.trim()
    const amount = Number(values.receiptAmount)
    if (!merchant) {
      setError('Merchant is required.')
      return
    }
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Amount cannot be zero.')
      return
    }

    setSaving(true)
    try {
      const dateISO = values.date ? new Date(values.date).toISOString() : new Date().toISOString()
      const receiptCurrency = values.receiptCurrency || defaultCurrency
      const { rate, converted } = await convertCurrency(amount, receiptCurrency, defaultCurrency, dateISO)

      const input: ReceiptWriteInput = {
        merchant,
        date: dateISO,
        total: converted,
        receiptAmount: amount,
        currency: receiptCurrency,
        defaultCurrency,
        receiptCurrency,
        conversionRate: rate,
        convertedTotal: converted,
        category: values.category || 'Miscellaneous',
        cardLast4: values.cardLast4 ? values.cardLast4.replace(/[^0-9]/g, '').slice(-4) : null,
        cardBank: values.cardBank || null,
        transferFromBank: values.transferFromBank.trim() || null,
        transferToBank: values.transferToBank.trim() || null,
        transferKind: values.transferKind || null,
        rawText: values.rawText,
        lineItems: values.lineItems,
        fileUrl: values.fileUrl,
        visibility: values.visibility,
        source: values.source
      }

      await onSubmit(input)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {isTransfer ? 'Recipient' : 'Merchant'}
        </span>
        <input
          type="text"
          value={values.merchant}
          onChange={(e) => set('merchant', e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
          placeholder={isTransfer ? 'e.g. John Tan, or self' : 'e.g. Starbucks'}
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Amount</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={values.receiptAmount}
            onChange={(e) => set('receiptAmount', e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="0.00"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Currency</span>
          <select
            value={values.receiptCurrency}
            onChange={(e) => set('receiptCurrency', e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Date</span>
        <input
          type="date"
          value={values.date || todayISODate()}
          onChange={(e) => set('date', e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Category</span>
        <select
          value={values.category}
          onChange={(e) => set('category', e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {isTransfer && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Local transfers aren't counted in your monthly spending — they show up separately in Reports.
          </p>
        )}
      </label>

      {isTransfer && (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Transfer details</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">From bank</span>
              <input
                type="text"
                value={values.transferFromBank}
                onChange={(e) => set('transferFromBank', e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
                placeholder="e.g. DBS"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">To bank</span>
              <input
                type="text"
                value={values.transferToBank}
                onChange={(e) => set('transferToBank', e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
                placeholder="e.g. OCBC"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Transfer type</span>
            <div className="flex gap-2">
              {TRANSFER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => set('transferKind', kind)}
                  aria-pressed={values.transferKind === kind}
                  className={`flex-1 rounded-lg py-2.5 text-sm font-medium capitalize ${
                    values.transferKind === kind
                      ? 'bg-teal-700 text-white'
                      : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Self = between your own accounts. External = to someone else's account.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Card last 4</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={values.cardLast4}
            onChange={(e) => set('cardLast4', e.target.value)}
            onBlur={handleCardLast4Blur}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="1234"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Bank</span>
          <input
            type="text"
            value={values.cardBank}
            onChange={(e) => set('cardBank', e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Raw extracted text</span>
        {values.rawText ? (
          <textarea
            readOnly
            value={values.rawText}
            rows={6}
            className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2.5 font-mono text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300"
          />
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-2.5 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            No source text for this receipt — it was entered manually.
          </p>
        )}
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          What the SMS, email, or photo actually said — check the fields above against this before saving.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Visibility</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => set('visibility', 'household')}
            aria-pressed={values.visibility === 'household'}
            className={`flex-1 rounded-lg py-2.5 text-sm font-medium ${
              values.visibility === 'household'
                ? 'bg-teal-700 text-white'
                : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            Household
          </button>
          <button
            type="button"
            onClick={() => set('visibility', 'private')}
            aria-pressed={values.visibility === 'private'}
            className={`flex-1 rounded-lg py-2.5 text-sm font-medium ${
              values.visibility === 'private'
                ? 'bg-amber-600 text-white'
                : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            Private
          </button>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {values.visibility === 'household'
            ? 'Everyone in your household can see and edit this receipt.'
            : 'Only you can see this receipt. It is excluded from household totals for everyone else.'}
        </p>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="mt-2 rounded-lg bg-teal-700 py-3 text-base font-semibold text-white disabled:opacity-60"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
