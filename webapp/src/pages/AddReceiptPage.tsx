import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReceiptForm, type ReceiptFormValues } from '../components/ReceiptForm'
import { useReceipts } from '../hooks/useReceipts'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import {
  insertReceipt,
  parseReceiptText,
  parseReceiptImage,
  uploadReceiptImage,
  type ReceiptWriteInput
} from '../lib/supabaseClient'
import { compressImage, blobToBase64 } from '../lib/imageUtils'
import { DEFAULT_CURRENCY } from '../lib/categories'
import type { ParsedReceipt } from '../types/receipt'

const MAX_RAW_TEXT_CHARS = 18_000
type Mode = 'photo' | 'text'

function valuesFromParsed(parsed: ParsedReceipt, rawText: string, fileUrl: string | null): ReceiptFormValues {
  return {
    merchant: parsed.merchant?.trim() || '',
    date: parsed.date ? String(parsed.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    receiptAmount: parsed.total != null ? String(parsed.total) : '',
    receiptCurrency: parsed.currency || DEFAULT_CURRENCY,
    category: parsed.category || 'Miscellaneous',
    cardLast4: parsed.card_last4 || '',
    cardBank: parsed.card_bank || '',
    // The parser's transcription wins for photos (there is no other source of
    // receipt text); pasted text keeps what the user actually pasted.
    rawText: rawText || (parsed.raw_text ?? ''),
    lineItems: (parsed.line_items ?? []).flatMap((li) =>
      li?.description ? [{ description: li.description, amount: li.amount ?? null }] : []
    ),
    fileUrl,
    visibility: 'household',
    source: fileUrl ? 'photo' : 'manual'
  }
}

function emptyFormValues(rawText: string, fileUrl: string | null = null): ReceiptFormValues {
  return {
    merchant: '',
    date: new Date().toISOString().slice(0, 10),
    receiptAmount: '',
    receiptCurrency: DEFAULT_CURRENCY,
    category: 'Miscellaneous',
    cardLast4: '',
    cardBank: '',
    rawText,
    lineItems: [],
    fileUrl,
    visibility: 'household',
    source: fileUrl ? 'photo' : 'manual'
  }
}

export function AddReceiptPage() {
  const navigate = useNavigate()
  const { refresh } = useReceipts()
  const { session } = useAuth()
  const { defaultCurrency } = useSettings()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('photo')
  const [rawText, setRawText] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<ReceiptFormValues | null>(null)

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(null)
    setBusy(true)
    try {
      setBusyLabel('Preparing photo…')
      const compressed = await compressImage(file)
      const previewUrl = URL.createObjectURL(compressed)
      setImagePreviewUrl(previewUrl)

      setBusyLabel('Reading receipt…')
      const base64 = await blobToBase64(compressed)
      const [fileUrl, parsed] = await Promise.all([
        // The uid prefix is what the storage policies authorize against, so the
        // upload cannot be attributed after the fact — it has to be passed here.
        uploadReceiptImage(compressed, file.name || 'receipt.jpg', session!.userId),
        parseReceiptImage(base64, 'image/jpeg').catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
          return null
        })
      ])

      setFormValues(parsed ? valuesFromParsed(parsed, '', fileUrl) : emptyFormValues('', fileUrl))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleParseText() {
    const trimmed = rawText.trim()
    if (!trimmed) return
    setBusy(true)
    setBusyLabel('Parsing…')
    setError(null)
    try {
      const parsed = await parseReceiptText(trimmed.slice(0, MAX_RAW_TEXT_CHARS))
      setFormValues(valuesFromParsed(parsed, trimmed, null))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      // Always let the user proceed to the form even if parsing fails.
      setFormValues(emptyFormValues(trimmed))
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(input: ReceiptWriteInput) {
    await insertReceipt(input)
    await refresh()
    navigate('/')
  }

  function reset() {
    setFormValues(null)
    setImagePreviewUrl(null)
    setRawText('')
    setError(null)
  }

  if (!formValues) {
    return (
      <div className="px-4 pt-4 pb-6">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Add Receipt</h1>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setMode('photo')}
            className={`flex-1 rounded-full py-2 text-sm font-medium ${
              mode === 'photo' ? 'bg-teal-700 text-white' : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            Photo
          </button>
          <button
            onClick={() => setMode('text')}
            className={`flex-1 rounded-full py-2 text-sm font-medium ${
              mode === 'text' ? 'bg-teal-700 text-white' : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            Paste Text
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {error}
          </div>
        )}

        {mode === 'photo' ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelected}
              className="hidden"
            />
            {imagePreviewUrl && (
              <img src={imagePreviewUrl} alt="Receipt preview" className="max-h-56 rounded-lg border border-neutral-200 object-contain dark:border-neutral-800" />
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="w-full rounded-lg bg-teal-700 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? busyLabel || 'Working…' : imagePreviewUrl ? 'Retake / Choose Different Photo' : '📷 Take Photo or Upload'}
            </button>
            <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
              Works with your camera or photo library, on iPhone and Android.
            </p>
          </div>
        ) : (
          <>
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

            <div className="mt-3 flex gap-3">
              <button
                onClick={handleParseText}
                disabled={busy || !rawText.trim()}
                className="flex-1 rounded-lg bg-teal-700 py-3 text-base font-semibold text-white disabled:opacity-60"
              >
                {busy ? busyLabel || 'Working…' : 'Parse & Review'}
              </button>
              <button
                onClick={() => setFormValues(emptyFormValues(rawText.trim()))}
                className="rounded-lg bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
              >
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Review Receipt</h1>
        <button onClick={reset} className="text-sm text-neutral-500 dark:text-neutral-400">
          Start over
        </button>
      </div>
      {imagePreviewUrl && (
        <img src={imagePreviewUrl} alt="Receipt preview" className="mt-3 max-h-40 rounded-lg border border-neutral-200 object-contain dark:border-neutral-800" />
      )}
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
