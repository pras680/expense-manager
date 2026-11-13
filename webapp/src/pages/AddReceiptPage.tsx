import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReceiptForm, type ReceiptFormValues } from '../components/ReceiptForm'
import { ParserStatusCard } from '../components/ParserStatusCard'
import { useReceipts } from '../hooks/useReceipts'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { useParserStatus } from '../hooks/useParserStatus'
import {
  findDuplicateForMerge,
  mergeIntoReceipt,
  insertReceipt,
  parseReceiptText,
  parseReceiptImage,
  uploadReceiptImage,
  ParserRateLimitedError,
  type ReceiptWriteInput,
  type DuplicateCandidateRow
} from '../lib/supabaseClient'
import { compressImage, blobToBase64 } from '../lib/imageUtils'
import { DEFAULT_CURRENCY } from '../lib/categories'
import { SOURCE_LABELS } from '../lib/receiptShape'
import { formatDuration } from '../lib/parserQuota'
import { Icon } from '../components/Icon'
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
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h1 className="font-display text-[30px] leading-none font-bold tracking-tight text-ink">{title}</h1>
        {action}
      </div>
      {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
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
        className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 ${
          active ? 'bg-ink text-bg' : 'text-ink'
        }`}
      >
        {icon}
        {label}
      </button>
    )
  }
  return (
    <div role="tablist" aria-label="How to add" className="mt-4 flex gap-1 rounded-full bg-card p-1 motion-safe:animate-rise">
      {option('photo', 'Photo / PDF', <Icon name="camera" size={16} />)}
      {option('text', 'Paste text', <Icon name="text" size={16} />)}
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
    <ol className="mt-3.5 grid grid-cols-3 gap-2.5">
      {steps.map((s, i) => (
        <li
          key={s.n}
          className="rounded-3xl bg-card p-3.5 motion-safe:animate-rise"
          style={{ animationDelay: `${120 + i * 90}ms` }}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-card-2 font-display text-xs font-semibold text-ink">{s.n}</div>
          <div className="mt-2 text-sm leading-tight font-semibold text-ink">{s.title}</div>
          <div className="mt-1 text-xs leading-snug text-muted">{s.body}</div>
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
    <ol className="flex flex-col gap-2.5 rounded-3xl bg-card p-[18px]" aria-live="polite">
      {steps.map((label, i) => {
        const done = i < active
        const current = i === active
        return (
          <li key={label} className={`flex items-center gap-3 text-[15px] ${current ? 'font-semibold text-ink' : done ? 'text-muted' : 'text-muted'}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-card-2 text-ink' : current ? 'bg-accent text-on-accent' : 'border border-line'}`}>
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
    <div className="relative mx-auto w-fit overflow-hidden rounded-2xl border border-line">
      <img src={src} alt="Receipt preview" className="block max-h-60 object-contain" />
      {scanning && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-accent/5" />
          <div className="pointer-events-none absolute inset-x-0 h-[3px] bg-accent shadow-[0_0_14px_3px_var(--accent)] motion-safe:animate-scan" />
        </>
      )}
    </div>
  )
}

function MergeConfirmDialog({
  duplicate,
  busy,
  onMerge,
  onKeepSeparate,
  onDismiss
}: {
  duplicate: DuplicateCandidateRow
  busy: boolean
  onMerge: () => void
  onKeepSeparate: () => void
  onDismiss: () => void
}) {
  const sourceLabel = SOURCE_LABELS[duplicate.source ?? ''] ?? duplicate.source ?? 'another source'
  const d = new Date(duplicate.date ?? '')
  const dateLabel = Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onDismiss}>
      <div
        className="w-full max-w-sm rounded-t-[28px] bg-card p-6 sm:rounded-[28px]"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-ink">Looks like a duplicate</h2>
        <p className="mt-1.5 text-sm text-muted">
          This matches a receipt already imported via {sourceLabel}
          {duplicate.merchant ? ` for ${duplicate.merchant}` : ''}
          {dateLabel ? ` on ${dateLabel}` : ''}, still waiting for review. Merge what you just read into it, or
          save this as a separate receipt?
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onMerge}
            disabled={busy}
            className="min-h-12 rounded-full bg-accent text-base font-semibold text-on-accent disabled:opacity-60"
          >
            {busy ? 'Merging…' : 'Merge into it'}
          </button>
          <button
            type="button"
            onClick={onKeepSeparate}
            disabled={busy}
            className="min-h-12 rounded-full bg-card-2 text-base font-semibold text-ink disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Keep as a separate receipt'}
          </button>
        </div>
      </div>
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
  // A likely duplicate found on submit — held here so the user picks merge
  // vs. separate instead of it happening silently.
  const [pendingMerge, setPendingMerge] = useState<{ input: ReceiptWriteInput; duplicate: DuplicateCandidateRow } | null>(null)
  const [mergeChoiceBusy, setMergeChoiceBusy] = useState(false)

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

  // The Add tab can be reached from any of the other three tabs, so unlike
  // EditReceiptPage's single-entry-point back-pop, landing on /receipts is a
  // deliberate destination here, not "wherever we came from" — but it must
  // still be a *replace*, not a plain push: a push would leave this
  // now-submitted Add screen in the back stack, so the next back tap from
  // /receipts would land right back on a stale add form instead of wherever
  // the user was before opening Add.
  //
  // A merge is otherwise invisible — the new data lands on an existing
  // receipt instead of a new row — so the list is told which one to point at.
  function goToReceiptsList(mergedInto?: { id: string; merchant: string | null }) {
    navigate('/receipts', { replace: true, state: mergedInto ? { mergedInto } : null })
  }

  async function handleSubmit(input: ReceiptWriteInput) {
    // A same-charge candidate from a thinner source (SMS/Gmail) pauses the
    // save here instead of merging silently — the user picks merge vs.
    // separate below. A failed check must never block a legitimate save,
    // same fail-open convention as the two server-side pipelines' own guards.
    let duplicate: DuplicateCandidateRow | null = null
    try {
      duplicate = await findDuplicateForMerge(input)
    } catch {
      duplicate = null
    }
    if (duplicate) {
      setPendingMerge({ input, duplicate })
      return
    }
    await insertReceipt(input)
    await refresh()
    goToReceiptsList()
  }

  async function handleMergeChoice(choice: 'merge' | 'separate') {
    if (!pendingMerge) return
    const { input, duplicate } = pendingMerge
    setMergeChoiceBusy(true)
    setError(null)
    try {
      if (choice === 'merge') {
        await mergeIntoReceipt(duplicate, input)
        await refresh()
        setPendingMerge(null)
        goToReceiptsList({ id: duplicate.id, merchant: duplicate.merchant })
      } else {
        await insertReceipt(input)
        await refresh()
        setPendingMerge(null)
        goToReceiptsList()
      }
    } catch (err) {
      setError(errorMessage(err))
      setPendingMerge(null)
    } finally {
      setMergeChoiceBusy(false)
    }
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
            <button onClick={reset} className="flex h-11 items-center rounded-full bg-card px-4 text-sm font-semibold text-ink">
              Start over
            </button>
          }
        />
        {parseNote && (
          <div className="mt-3 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
            {parseNote}
          </div>
        )}
        {error && (
          <div role="alert" className="mt-3 rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
            {error}
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
        {pendingMerge && (
          <MergeConfirmDialog
            duplicate={pendingMerge.duplicate}
            busy={mergeChoiceBusy}
            onMerge={() => handleMergeChoice('merge')}
            onKeepSeparate={() => handleMergeChoice('separate')}
            onDismiss={() => { if (!mergeChoiceBusy) setPendingMerge(null) }}
          />
        )}
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
        <div className="mt-4 rounded-[28px] bg-card p-[22px] motion-safe:animate-rise">
          <div className="text-sm text-muted">
            {ready ? 'Ready to try again' : 'The reader needs a breather'}
          </div>
          <div className="mt-2 font-display text-[52px] leading-none font-semibold tracking-tighter text-ink tabular-nums">
            {ready ? 'Go' : formatDuration(msLeft)}
          </div>
          <p className="mt-3 text-[15px] text-muted">
            {cooldown.input.kind === 'photo'
              ? 'Your photo is already uploaded. The parser’s provider is at its rate limit — retry when the timer runs out, or type the details in yourself now.'
              : 'The parser’s provider is at its rate limit — retry when the timer runs out, or type the details in yourself now.'}
          </p>
          <div className="mt-4 flex gap-2.5">
            <button
              onClick={() => runParse(cooldown.input)}
              disabled={!ready}
              className="min-h-12 flex-1 rounded-full bg-accent text-sm font-semibold text-on-accent transition-opacity disabled:opacity-50"
            >
              {ready ? 'Try again' : 'Waiting…'}
            </button>
            <button onClick={fillInByHand} className="min-h-12 flex-1 rounded-full bg-card-2 text-sm font-semibold text-ink">
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
        <div role="alert" className="mt-3 rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
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
          {/* The one accent block on this screen: the thing you came here to do. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`mt-3.5 flex min-h-[220px] w-full flex-col justify-between rounded-[28px] bg-accent p-[22px] text-left text-on-accent transition-transform active:scale-[0.98] motion-safe:animate-rise ${
              dragging ? 'ring-4 ring-ink' : ''
            }`}
            style={{ animationDelay: '60ms' }}
          >
            <span className="motion-safe:animate-bob">
              <Icon name="camera" size={40} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block font-display text-[28px] leading-tight font-semibold tracking-tight">
                {dragging ? 'Drop it here' : imagePreviewUrl ? 'Try a different photo' : 'Snap a receipt'}
              </span>
              <span className="mt-1 block text-sm opacity-80">
                Camera, photo library or files. On a computer, drag a photo or PDF here.
              </span>
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
            className="field mt-3.5 rounded-3xl! p-4!"
          />
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-card">
              <div
                className="h-full bg-accent transition-[width] duration-300 min-h-11"
                style={{ width: `${(rawText.length / MAX_RAW_TEXT_CHARS) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted tabular-nums">
              {rawText.length.toLocaleString()}/{MAX_RAW_TEXT_CHARS.toLocaleString()}
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleParseText}
              disabled={!rawText.trim()}
              className="flex min-h-14 flex-1 items-center justify-between rounded-full bg-accent pr-5 pl-6 text-base font-semibold text-on-accent transition-opacity disabled:opacity-50"
            >
              Read it for me
              <Icon name="send" size={20} />
            </button>
            <button
              onClick={() => setFormValues(emptyFormValues(rawText.trim()))}
              className="min-h-14 rounded-full bg-card px-5 text-sm font-semibold text-ink"
            >
              Type it myself
            </button>
          </div>
        </div>
      )}

      <div className="mt-3.5">
        <ParserStatusCard view={parserView} now={now} />
      </div>
    </div>
  )
}
