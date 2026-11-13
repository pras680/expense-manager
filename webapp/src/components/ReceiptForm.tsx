import { useState } from 'react'
import { EXPENSE_CATEGORIES, COMMON_CURRENCIES, TRANSFER_KINDS } from '../lib/categories'
import { convertCurrency } from '../lib/currency'
import { findPaymentMethod, learnReceiptCorrection } from '../lib/supabaseClient'
import type { ReceiptWriteInput } from '../lib/supabaseClient'
import type { ReceiptVisibility, ReceiptSource } from '../types/receipt'
import { useSettings } from '../hooks/useSettings'

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
  /** Auto-filled from the parser's one-liner; freely editable. */
  comment: string
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
  const { householdId, customCategories } = useSettings()
  // Include the receipt's current category even if it's since been removed
  // from Settings (or predates this list entirely) — otherwise editing an
  // older receipt would silently swap its category to whatever the <select>
  // falls back to the moment the form loads.
  const categoryOptions = [...EXPENSE_CATEGORIES, ...customCategories]
  if (values.category && !categoryOptions.includes(values.category)) {
    categoryOptions.push(values.category)
  }

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
        source: values.source,
        comment: values.comment
      }

      await onSubmit(input)

      // Fire-and-forget: teaches future parses from this merchant, but a
      // failure here must never make an otherwise-successful save look
      // like it failed (learnReceiptCorrection already catches its own
      // errors internally).
      learnReceiptCorrection(
        householdId,
        {
          merchant: initial.merchant,
          category: initial.category,
          receiptCurrency: initial.receiptCurrency,
          cardLast4: initial.cardLast4,
          cardBank: initial.cardBank,
          rawText: initial.rawText
        },
        {
          merchant,
          category: values.category || 'Miscellaneous',
          receiptCurrency,
          cardLast4: values.cardLast4 ? values.cardLast4.replace(/[^0-9]/g, '').slice(-4) : '',
          cardBank: values.cardBank || '',
          rawText: values.rawText
        },
        values.comment
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-muted">
          {isTransfer ? 'Recipient' : 'Merchant'}
        </span>
        <input
          type="text"
          value={values.merchant}
          onChange={(e) => set('merchant', e.target.value)}
          className="field"
          placeholder={isTransfer ? 'e.g. John Tan, or self' : 'e.g. Starbucks'}
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="px-1 text-[13px] font-medium text-muted">Amount</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={values.receiptAmount}
            onChange={(e) => set('receiptAmount', e.target.value)}
            className="field"
            placeholder="0.00"
            required
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="px-1 text-[13px] font-medium text-muted">Currency</span>
          <select
            value={values.receiptCurrency}
            onChange={(e) => set('receiptCurrency', e.target.value)}
            className="field"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-muted">Date</span>
        <input
          type="date"
          value={values.date || todayISODate()}
          onChange={(e) => set('date', e.target.value)}
          className="field"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-muted">Category</span>
        <select
          value={values.category}
          onChange={(e) => set('category', e.target.value)}
          className="field"
        >
          {categoryOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {isTransfer && (
          <p className="px-1 text-[13px] text-muted">
            Local transfers aren't counted in your monthly spending — they show up separately in Insights.
          </p>
        )}
      </label>

      {isTransfer && (
        <div className="flex flex-col gap-3 rounded-3xl bg-card p-4">
          <span className="text-sm font-semibold text-ink">Transfer details</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="px-1 text-[13px] font-medium text-muted">From bank</span>
              <input
                type="text"
                value={values.transferFromBank}
                onChange={(e) => set('transferFromBank', e.target.value)}
                className="field"
                placeholder="e.g. DBS"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="px-1 text-[13px] font-medium text-muted">To bank</span>
              <input
                type="text"
                value={values.transferToBank}
                onChange={(e) => set('transferToBank', e.target.value)}
                className="field"
                placeholder="e.g. OCBC"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium text-muted">Transfer type</span>
            <div className="flex gap-2">
              {TRANSFER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => set('transferKind', kind)}
                  aria-pressed={values.transferKind === kind}
                  className={`min-h-12 flex-1 rounded-full text-sm font-semibold capitalize ${
                    values.transferKind === kind
                      ? 'bg-accent text-on-accent'
                      : 'bg-card text-ink'
                  }`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <p className="px-1 text-[13px] text-muted">
              Self = between your own accounts. External = to someone else's account.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="px-1 text-[13px] font-medium text-muted">Card last 4</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={values.cardLast4}
            onChange={(e) => set('cardLast4', e.target.value)}
            onBlur={handleCardLast4Blur}
            className="field"
            placeholder="1234"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="px-1 text-[13px] font-medium text-muted">Bank</span>
          <input
            type="text"
            value={values.cardBank}
            onChange={(e) => set('cardBank', e.target.value)}
            className="field"
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-muted">Raw extracted text</span>
        {values.rawText ? (
          <textarea
            readOnly
            value={values.rawText}
            rows={6}
            className="rounded-2xl border border-line bg-card-2 px-3 py-2.5 font-mono text-xs text-ink"
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-muted">
            No source text for this receipt — it was entered manually.
          </p>
        )}
        <p className="px-1 text-[13px] text-muted">
          What the SMS, email, or photo actually said — check the fields above against this before saving.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-muted">Comment</span>
        <textarea
          value={values.comment}
          onChange={(e) => set('comment', e.target.value)}
          rows={2}
          placeholder="How these values were derived — add your own notes here"
          className="field text-sm"
        />
        <p className="px-1 text-[13px] text-muted">
          Auto-filled with the parser's reasoning; edit freely. Saving with a changed field or a note here helps
          future receipts from this merchant get parsed correctly.
        </p>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-muted">Visibility</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => set('visibility', 'household')}
            aria-pressed={values.visibility === 'household'}
            className={`min-h-12 flex-1 rounded-full text-sm font-semibold ${
              values.visibility === 'household'
                ? 'bg-accent text-on-accent'
                : 'bg-card text-ink'
            }`}
          >
            Household
          </button>
          <button
            type="button"
            onClick={() => set('visibility', 'private')}
            aria-pressed={values.visibility === 'private'}
            className={`min-h-12 flex-1 rounded-full text-sm font-semibold ${
              values.visibility === 'private'
                ? 'bg-ink text-bg'
                : 'bg-card text-ink'
            }`}
          >
            Private
          </button>
        </div>
        <p className="px-1 text-[13px] text-muted">
          {values.visibility === 'household'
            ? 'Everyone in your household can see and edit this receipt.'
            : 'Only you can see this receipt. It is excluded from household totals for everyone else.'}
        </p>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="mt-2 min-h-14 rounded-full bg-accent text-base font-semibold text-on-accent disabled:opacity-60 active:opacity-80"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
