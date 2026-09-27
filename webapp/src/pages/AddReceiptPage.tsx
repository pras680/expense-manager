import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReceiptForm, type ReceiptFormValues } from '../components/ReceiptForm'
import { ParserStatusCard } from '../components/ParserStatusCard'
import { useReceipts } from '../hooks/useReceipts'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { useParserStatus } from '../hooks/useParserStatus'
import {
  insertOrMergeReceipt,
  parseReceiptText,
  parseReceiptImage,
  uploadReceiptImage,
  ParserRateLimitedError,
  type ReceiptWriteInput
} from '../lib/supabaseClient'
import { compressImage, blobToBase64 } from '../lib/imageUtils'
import { DEFAULT_CURRENCY } from '../lib/categories'
import { formatDuration } from '../lib/parserQuota'
import { ACCENT } from '../lib/theme'
import type { ParsedReceipt } from '../types/receipt'

const MAX_RAW_TEXT_CHARS = 18_000
type Mode = 'photo' | 'text'

/** What a parse was attempted on — kept so a rate-limited parse can be retried without re-picking the file. */
type ParseInput =
  | { kind: 'photo'; base64: string; fileUrl: string }
  | { kind: 'text'; text: string }

type ParseOutcome = { ok: true; parsed: ParsedReceipt } | { ok: false; error: unknown }

function valuesFromParsed(parsed: ParsedReceipt, rawText: string, fileUrl: string | null): ReceiptFormValues {
  return {
    merchant: parsed.merchant?.trim() || '',
    date: parsed.date ? String(parsed.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    receiptAmount: parsed.total != null ? String(parsed.total) : '',
    receiptCurrency: parsed.currency || DEFAULT_CURRENCY,
    category: parsed.category || 'Miscellaneous',
    cardLast4: parsed.card_last4 || '',
    cardBank: parsed.card_bank || '',
    // The parser never guesses these — bank alerts rarely name the receiving
    // bank, and "self vs external" is only known to the person reviewing it.
    transferFromBank: '',
    transferToBank: '',
    transferKind: '',
    // The parser's transcription wins for photos (there is no other source of
    // receipt text); pasted text keeps what the user actually pasted.
    rawText: rawText || (parsed.raw_text ?? ''),
    lineItems: (parsed.line_items ?? []).flatMap((li) =>
      li?.description ? [{ description: li.description, amount: li.amount ?? null }] : []
    ),
    fileUrl,
    visibility: 'household',
    source: fileUrl ? 'photo' : 'manual',
    comment: parsed.derivation_note ?? ''
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
    transferFromBank: '',
    transferToBank: '',
    transferKind: '',
    rawText,
    lineItems: [],
    fileUrl,
    visibility: 'household',
    source: fileUrl ? 'photo' : 'manual',
    comment: ''
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-rise">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-white" style={{ background: ACCENT }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </div>
          <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h1>
        </div>
        {action}
      </div>
      <div className="mt-3 h-1.5 w-16" style={{ background: ACCENT }} />
      {subtitle && <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{subtitle}</p>}
    </div>
  )
}

function ModeSwitch({ mode, onChange, disabled }: { mode: Mode; onChange: (m: Mode) => void; disabled: boolean }) {
  const option = (value: Mode, label: string, icon: React.ReactNode) => {
    const active = mode === value
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={disabled}
        onClick={() => onChange(value)}
        className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
          active
            ? 'bg-accent-700 text-white'
            : 'bg-white text-neutral-700 hover:bg-accent-50 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
        }`}
      >
        {icon}
        {label}
      </button>
    )
  }
  return (
    <div role="tablist" aria-label="How to add" className="mt-5 flex border-2 border-accent-700 motion-safe:animate-rise">
      {option('photo', 'Photo / PDF', (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      ))}
      {option('text', 'Paste text', (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </svg>
      ))}
    </div>
  )
}

function HowItWorks() {
  const steps = [
    { n: '1', title: 'Snap it', body: 'Photo, screenshot or PDF' },
    { n: '2', title: 'We read it', body: 'Merchant, total, date, card' },
    { n: '3', title: 'You confirm', body: 'Fix anything, then save' }
  ]
  return (
    <ol className="mt-4 grid grid-cols-3 gap-2">
      {steps.map((s, i) => (
        <li
          key={s.n}
          className="border-t-2 border-accent-700 pt-2 motion-safe:animate-rise"
          style={{ animationDelay: `${120 + i * 90}ms` }}
        >
          <div className="text-[11px] font-extrabold text-accent-700 dark:text-accent-400">{s.n}</div>
          <div className="text-sm font-extrabold leading-tight text-neutral-900 dark:text-neutral-50">{s.title}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">{s.body}</div>
        </li>
      ))}
    </ol>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function WorkingSteps({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {steps.map((label, i) => {
        const done = i < active
        const current = i === active
        return (
          <li key={label} className={`flex items-center gap-2.5 text-sm ${current ? 'font-extrabold text-neutral-900 dark:text-neutral-50' : done ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-400 dark:text-neutral-600'}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${done ? 'bg-emerald-500 text-white' : current ? 'bg-accent-700 text-white' : 'border border-neutral-300 dark:border-neutral-700'}`}>
              {done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : current ? <Spinner /> : <span className="text-[11px]">{i + 1}</span>}
            </span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}

function ScanningPreview({ src, scanning }: { src: string; scanning: boolean }) {
  return (
    <div className="relative mx-auto w-fit overflow-hidden border border-neutral-200 dark:border-neutral-800">
      <img src={src} alt="Receipt preview" className="block max-h-60 object-contain" />
      {scanning && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-accent-700/5" />
          <div
            className="pointer-events-none absolute inset-x-0 h-[3px] motion-safe:animate-scan"
            style={{ background: ACCENT, boxShadow: `0 0 14px 3px ${ACCENT}66` }}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AddReceiptPage() {
  const navigate = useNavigate()
  const { refresh } = useReceipts()
  const { session } = useAuth()
  const { defaultCurrency } = useSettings()
  const { view: parserView, now, refreshSoon } = useParserStatus()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('photo')
  const [rawText, setRawText] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [activeStep, setActiveStep] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<ReceiptFormValues | null>(null)
  // Shown above the review form when the automatic read didn't work, so an
  // empty form isn't mistaken for "the parser found nothing".
  const [parseNote, setParseNote] = useState<string | null>(null)
  // A parse the provider rate-limited: what to retry, and when it said to.
  const [cooldown, setCooldown] = useState<{ input: ParseInput; until: number | null } | null>(null)

  function applyOutcome(input: ParseInput, outcome: ParseOutcome) {
    refreshSoon()
    const fileUrl = input.kind === 'photo' ? input.fileUrl : null
    const text = input.kind === 'text' ? input.text : ''
    if (outcome.ok) {
      setCooldown(null)
      setParseNote(null)
      setFormValues(valuesFromParsed(outcome.parsed, text, fileUrl))
      return
    }
    if (outcome.error instanceof ParserRateLimitedError) {
      const seconds = outcome.error.retryAfterSeconds
      setCooldown({ input, until: seconds != null ? Date.now() + seconds * 1000 : null })
      return
    }
    // Any other failure: go straight to the form so the receipt can still be
    // saved by hand — the photo (if any) is already uploaded.
    setCooldown(null)
    setParseNote(`Couldn't read it automatically (${errorMessage(outcome.error)}). Fill in the details below.`)
    setFormValues(emptyFormValues(text, fileUrl))
  }

  async function processFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf && !file.type.startsWith('image/')) {
      setError('That file type isn’t supported — use a photo or a PDF.')
      return
    }

    setError(null)
    setCooldown(null)
    setBusy(true)
    setSteps([isPdf ? 'Reading PDF' : 'Preparing photo', 'Uploading & reading receipt', 'Filling in the details'])
    setActiveStep(0)
    try {
      // A PDF isn't an image parse-receipt can read directly — render its
      // first page to a canvas, then treat that exactly like a camera photo
      // from here on. Receipts are effectively always one page.
      //
      // Dynamically imported: pdf.js is a ~250KB (gzipped) dependency that
      // only a PDF upload ever needs. A static import pulled it into the
      // main bundle for every page load, on a PWA whose whole premise is a
      // lean install on a phone — this way it's its own chunk, fetched only
      // when someone actually picks a PDF.
      const source = isPdf
        ? await (await import('../lib/pdfUtils')).renderPdfFirstPageToBlob(file)
        : file
      const compressed = await compressImage(source)
      setImagePreviewUrl(URL.createObjectURL(compressed))

      setActiveStep(1)
      const base64 = await blobToBase64(compressed)
      // What's actually uploaded is always a JPEG (the rendered page, for a
      // PDF) — naming it receipt.pdf would be a lie about the stored bytes.
      const filenameHint = isPdf
        ? file.name.replace(/\.pdf$/i, '.jpg') || 'receipt.jpg'
        : (file.name || 'receipt.jpg')
      const [fileUrl, outcome] = await Promise.all([
        // The uid prefix is what the storage policies authorize against, so the
        // upload cannot be attributed after the fact — it has to be passed here.
        uploadReceiptImage(compressed, filenameHint, session!.userId),
        parseReceiptImage(base64, 'image/jpeg').then(
          (parsed): ParseOutcome => ({ ok: true, parsed }),
          (error): ParseOutcome => ({ ok: false, error })
        )
      ])

      setActiveStep(2)
      applyOutcome({ kind: 'photo', base64, fileUrl }, outcome)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function runParse(input: ParseInput) {
    setBusy(true)
    setError(null)
    setSteps(input.kind === 'photo' ? ['Reading receipt', 'Filling in the details'] : ['Reading your text', 'Filling in the details'])
    setActiveStep(0)
    try {
      const outcome: ParseOutcome = await (input.kind === 'photo'
        ? parseReceiptImage(input.base64, 'image/jpeg')
        : parseReceiptText(input.text.slice(0, MAX_RAW_TEXT_CHARS))
      ).then(
        (parsed): ParseOutcome => ({ ok: true, parsed }),
        (error): ParseOutcome => ({ ok: false, error })
      )
      setActiveStep(1)
      applyOutcome(input, outcome)
    } finally {
      setBusy(false)
    }
  }

  function handleParseText() {
    const trimmed = rawText.trim()
    if (!trimmed) return
    runParse({ kind: 'text', text: trimmed })
  }

  function fillInByHand() {
    if (!cooldown) return
    const { input } = cooldown
    setCooldown(null)
    setParseNote(null)
    setFormValues(input.kind === 'photo' ? emptyFormValues('', input.fileUrl) : emptyFormValues(input.text))
  }

  async function handleSubmit(input: ReceiptWriteInput) {
    // Silently folds into an existing sms/gmail-sourced receipt for the same
    // charge when one exists, rather than creating a second record — see
    // insertOrMergeReceipt.
    await insertOrMergeReceipt(input)
    await refresh()
    // The Add tab can be reached from any of the other three tabs, so unlike
    // EditReceiptPage's single-entry-point back-pop, landing on /receipts is
    // a deliberate destination here, not "wherever we came from" — but it
    // must still be a *replace*, not a plain push: a push would leave this
    // now-submitted Add screen in the back stack, so the next back tap from
    // /receipts would land right back on a stale add form instead of
    // wherever the user was before opening Add.
    navigate('/receipts', { replace: true })
  }

  function reset() {
    setFormValues(null)
    setImagePreviewUrl(null)
    setRawText('')
    setError(null)
    setParseNote(null)
    setCooldown(null)
  }

  // --- Review -------------------------------------------------------------
  if (formValues) {
    return (
      <div className="px-4 pt-4 pb-6">
        <PageTitle
          title="Review"
          subtitle={parseNote ? undefined : 'Here’s what we read — check it over, then save.'}
          action={
            <button onClick={reset} className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
              Start over
            </button>
          }
        />
        {parseNote && (
          <div className="mt-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {parseNote}
          </div>
        )}
        {imagePreviewUrl && (
          <div className="mt-4 motion-safe:animate-rise">
            <ScanningPreview src={imagePreviewUrl} scanning={false} />
          </div>
        )}
        <div className="mt-4 motion-safe:animate-rise" style={{ animationDelay: '80ms' }}>
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

  // --- Rate limited: wait or fill in by hand ------------------------------
  if (cooldown && !busy) {
    const msLeft = cooldown.until != null ? cooldown.until - now : 0
    const ready = msLeft <= 0
    return (
      <div className="px-4 pt-4 pb-6">
        <PageTitle title="Add Receipt" />
        <div className="mt-5 p-5 text-white motion-safe:animate-rise" style={{ background: ACCENT }}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/80">
            {ready ? 'Ready to try again' : 'The reader needs a breather'}
          </div>
          <div className="mt-2 text-[44px] font-extrabold leading-none tracking-tight tabular-nums">
            {ready ? 'Go' : formatDuration(msLeft)}
          </div>
          <p className="mt-2 text-sm text-white/90">
            {cooldown.input.kind === 'photo'
              ? 'Your photo is already uploaded. The parser’s provider is at its rate limit — retry when the timer runs out, or type the details in yourself now.'
              : 'The parser’s provider is at its rate limit — retry when the timer runs out, or type the details in yourself now.'}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => runParse(cooldown.input)}
              disabled={!ready}
              className="flex-1 bg-white py-3 text-sm font-extrabold text-accent-800 transition-opacity disabled:opacity-50"
            >
              {ready ? 'Try again' : 'Waiting…'}
            </button>
            <button onClick={fillInByHand} className="flex-1 border-2 border-white py-3 text-sm font-extrabold text-white">
              Fill in by hand
            </button>
          </div>
        </div>
        {imagePreviewUrl && (
          <div className="mt-4">
            <ScanningPreview src={imagePreviewUrl} scanning={false} />
          </div>
        )}
        <div className="mt-4">
          <ParserStatusCard view={parserView} now={now} />
        </div>
      </div>
    )
  }

  // --- Capture ------------------------------------------------------------
  return (
    <div className="px-4 pt-4 pb-6">
      <PageTitle title="Add Receipt" subtitle="Snap it, drop it, or paste it — we’ll do the typing." />

      <ModeSwitch mode={mode} onChange={(m) => { setMode(m); setError(null) }} disabled={busy} />

      {error && (
        <div className="mt-3 border-l-4 border-accent-700 bg-accent-50 px-3 py-2 text-sm text-accent-900 dark:bg-accent-950 dark:text-accent-200">
          {error}
        </div>
      )}

      {busy ? (
        <div className="mt-5 flex flex-col gap-5 motion-safe:animate-rise">
          {imagePreviewUrl && <ScanningPreview src={imagePreviewUrl} scanning />}
          <WorkingSteps steps={steps} active={activeStep} />
        </div>
      ) : mode === 'photo' ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            // Listing application/pdf alongside image/* is also what makes
            // iOS Safari show "Browse" (Files app / iCloud Drive) in the
            // picker — accept="image/*" alone limits it to Camera and
            // Photo Library and hides filesystem access entirely.
            accept="image/*,application/pdf"
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`group mt-4 flex min-h-[200px] w-full flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-8 text-center transition-colors motion-safe:animate-rise ${
              dragging
                ? 'border-accent-700 bg-accent-50 dark:bg-accent-950/40'
                : 'border-neutral-300 bg-white hover:border-accent-700 hover:bg-accent-50/60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800'
            }`}
            style={{ animationDelay: '60ms' }}
          >
            <span className="flex h-16 w-16 items-center justify-center text-white motion-safe:animate-bob" style={{ background: ACCENT }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </span>
            <span className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50">
              {dragging ? 'Drop it here' : imagePreviewUrl ? 'Try a different photo' : 'Snap a receipt'}
            </span>
            <span className="max-w-[18rem] text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              Tap for camera, photo library or files — or drag a photo or PDF here.
            </span>
          </button>
          <HowItWorks />
        </>
      ) : (
        <div className="motion-safe:animate-rise">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value.slice(0, MAX_RAW_TEXT_CHARS))}
            rows={8}
            placeholder="Paste receipt text, a bank SMS, or an email…"
            className="mt-4 w-full border-2 border-neutral-200 bg-white px-3 py-2.5 text-base outline-none transition-colors focus:border-accent-700 dark:border-neutral-800 dark:bg-neutral-900"
          />
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-accent-700 transition-[width] duration-300"
                style={{ width: `${(rawText.length / MAX_RAW_TEXT_CHARS) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {rawText.length.toLocaleString()}/{MAX_RAW_TEXT_CHARS.toLocaleString()}
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleParseText}
              disabled={!rawText.trim()}
              className="flex h-12 flex-1 items-center justify-between px-4 text-base font-extrabold text-white transition-opacity disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              Read it for me
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => setFormValues(emptyFormValues(rawText.trim()))}
              className="h-12 border-2 border-neutral-300 px-4 text-sm font-bold text-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
            >
              Type it myself
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <ParserStatusCard view={parserView} now={now} />
      </div>
    </div>
  )
}
