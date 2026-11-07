import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useChat, type ChatMessage } from '../hooks/useChat'
import type { AgentToolCall } from '../lib/supabaseClient'
import { ACCENT } from '../lib/theme'

const SUGGESTIONS = [
  'How much did I spend last month?',
  'Where does most of my money go this month?',
  'Top 5 merchants in the last 3 months',
  'When did I last buy groceries?'
]

const TOOL_LABELS: Record<string, string> = {
  spending_by_category: 'Spending by category',
  spending_by_month: 'Monthly totals',
  top_merchants: 'Top merchants',
  find_receipts: 'Receipts',
  search_purchased_items: 'Purchased items'
}

// Form screens keep their primary action at the bottom, right where the
// launcher would sit.
function launcherHidden(pathname: string): boolean {
  return pathname === '/add' || /^\/receipts\/[^/]+\/edit$/.test(pathname)
}

export function TalkToMe() {
  const { open, setOpen } = useChat()
  const { pathname } = useLocation()

  return (
    <>
      {!open && !launcherHidden(pathname) && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 z-30 flex items-center gap-2 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-black/20 active:scale-95 motion-safe:animate-rise motion-safe:transition-transform"
          style={{ background: ACCENT, bottom: 'calc(5rem + env(safe-area-inset-bottom) + 0.75rem)' }}
          aria-label="Talk to me — ask about your spending"
        >
          <ChatIcon />
          Talk to me
        </button>
      )}
      {open && <ChatPanel />}
    </>
  )
}

function ChatPanel() {
  const { messages, sending, send, reset, setOpen } = useChat()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const onClose = () => setOpen(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    // Full-screen on phones: stop the page behind from scrolling under the sheet.
    const phone = window.matchMedia('(max-width: 639px)').matches
    const prevOverflow = document.body.style.overflow
    if (phone) document.body.style.overflow = 'hidden'
    // Only auto-focus with a real pointer; on touch it would throw the
    // keyboard up over the suggestions before the user has read them.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [setOpen])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const submit = (text: string) => {
    if (!text.trim() || sending) return
    setDraft('')
    void send(text)
  }

  return (
    <div
      role="dialog"
      aria-label="Talk to me"
      className="fixed inset-0 z-50 flex flex-col bg-neutral-50 sm:inset-auto sm:right-4 sm:bottom-20 sm:h-[min(640px,calc(100dvh-6rem))] sm:w-[400px] sm:border sm:border-neutral-200 sm:shadow-2xl motion-safe:animate-rise dark:bg-neutral-950 dark:sm:border-neutral-800"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center text-white" style={{ background: ACCENT }}>
          <ChatIcon />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold leading-tight text-neutral-900 dark:text-neutral-50">Talk to me</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Ask about your household's spending</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="h-11 px-2 text-xs font-semibold text-neutral-600 active:text-neutral-900 dark:text-neutral-300"
          >
            New chat
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex h-11 w-11 items-center justify-center text-neutral-600 active:bg-neutral-100 dark:text-neutral-300 dark:active:bg-neutral-800"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState onPick={submit} />
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => <Bubble key={m.id} message={m} />)}
            {sending && <TypingIndicator />}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-neutral-200 bg-white px-3 pt-3 dark:border-neutral-800 dark:bg-neutral-900"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        onSubmit={(e) => { e.preventDefault(); submit(draft) }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit(draft)
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Ask about your spending…"
          aria-label="Your question"
          // 16px font stops iOS Safari zooming the page on focus.
          className="max-h-32 min-h-11 flex-1 resize-none border border-neutral-300 bg-neutral-50 px-3 py-2.5 text-base leading-snug text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-300 [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-white disabled:opacity-40"
          style={{ background: ACCENT }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col justify-end gap-4">
      <div>
        <p className="text-2xl font-extrabold leading-tight text-neutral-900 dark:text-neutral-50">
          Ask me about<br />your money.
        </p>
        <div className="mt-2 h-1 w-12" style={{ background: ACCENT }} />
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          I look up your household's receipts to answer — totals, trends, merchants, even items you bought.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="border border-neutral-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-neutral-800 active:border-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="ml-10 self-end bg-neutral-900 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white dark:bg-neutral-100 dark:text-neutral-900">
        {message.content}
      </div>
    )
  }
  return (
    <div className="mr-6 self-start">
      <div
        className={`border-l-4 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          message.isError
            ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
            : 'bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50'
        }`}
        style={message.isError ? undefined : { borderColor: ACCENT }}
      >
        {renderInline(message.content)}
      </div>
      {message.toolCalls && message.toolCalls.length > 0 && <LookupTrail calls={message.toolCalls} />}
    </div>
  )
}

/** Shows which lookups the agent ran, so a number can be traced back to its source. */
function LookupTrail({ calls }: { calls: AgentToolCall[] }) {
  return (
    <details className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
      <summary className="cursor-pointer select-none py-1">
        Looked up {calls.length} {calls.length === 1 ? 'thing' : 'things'}
      </summary>
      <ul className="mt-1 flex flex-col gap-1">
        {calls.map((c, i) => (
          <li key={i} className={c.error ? 'text-red-600 dark:text-red-400' : undefined}>
            {TOOL_LABELS[c.tool] ?? c.tool}
            {describeArgs(c.args)}
            {c.error && ' — failed'}
          </li>
        ))}
      </ul>
    </details>
  )
}

function describeArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  const str = (k: string) => (typeof args?.[k] === 'string' ? (args[k] as string) : null)
  const from = str('from'), to = str('to')
  if (from || to) parts.push(`${from ?? '…'} → ${to ?? 'today'}`)
  for (const k of ['category', 'search', 'item']) {
    const v = str(k)
    if (v) parts.push(`“${v}”`)
  }
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

// Models reply in light markdown; render **bold** only, as React nodes rather
// than HTML so reply text can never inject markup.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>
      : part
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 self-start border-l-4 bg-white px-3.5 py-3.5 dark:bg-neutral-900" style={{ borderColor: ACCENT }} aria-label="Looking that up">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 bg-neutral-400 motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  )
}
