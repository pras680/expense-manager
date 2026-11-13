import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useChat, type ChatMessage } from '../hooks/useChat'
import type { AgentToolCall } from '../lib/supabaseClient'
import { Icon } from './Icon'

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

// The floating launcher shows on the two tabs where a spending question comes
// up naturally: Insights (and its drill-down) and the Receipts list. Home has
// its own Ask bar instead, and everywhere else — forms, a single receipt, the
// You pages — it would only sit on top of the thing being read or typed.
function launcherHidden(pathname: string): boolean {
  return !(pathname === '/receipts' || pathname.startsWith('/reports'))
}

export function TalkToMe() {
  const { open, setOpen } = useChat()
  const { pathname } = useLocation()

  return (
    <>
      {!open && !launcherHidden(pathname) && (
        // Centred over the same phone-width column as the page, so on a wide
        // screen it sits beside the content instead of in the window's corner.
        <div
          className="pointer-events-none fixed inset-x-0 z-30 px-4"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-xl justify-end">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-accent pr-5 pl-4 font-display text-base font-semibold text-on-accent shadow-lg shadow-black/30 active:scale-95 motion-safe:animate-rise motion-safe:transition-transform"
              aria-label="Talk to me — ask about your spending"
            >
              <Icon name="sparkles" size={22} />
              Ask
            </button>
          </div>
        </div>
      )}
      {open && <ChatPanel />}
    </>
  )
}

function ChatPanel() {
  const { messages, sending, send, retry, reset, setOpen } = useChat()
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
    send(text)
  }

  return (
    <div
      role="dialog"
      aria-label="Talk to me"
      className="fixed inset-0 z-50 flex flex-col bg-bg sm:inset-auto sm:right-4 sm:bottom-24 sm:h-[min(640px,calc(100dvh-7rem))] sm:w-[400px] sm:overflow-hidden sm:rounded-[28px] sm:border sm:border-line sm:shadow-2xl motion-safe:animate-rise"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <header className="flex items-center gap-2 border-b border-line bg-card px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
          <Icon name="sparkles" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-tight font-semibold text-ink">Talk to me</h2>
          <p className="text-xs text-muted">Ask about your household's spending</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="h-11 rounded-full bg-card-2 px-3.5 text-[13px] font-semibold text-ink"
          >
            New chat
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-card-2"
        >
          <Icon name="x" size={20} />
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState onPick={submit} />
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <Bubble key={m.id} message={m} onRetry={sending ? undefined : () => retry(m.id)} />
            ))}
            {sending && <TypingIndicator />}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line bg-card px-3 pt-3"
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
          className="max-h-32 min-h-12 flex-1 resize-none rounded-3xl border border-line bg-bg px-4 py-3 text-base leading-snug text-ink outline-none focus:border-accent [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40"
        >
          <Icon name="send" size={20} />
        </button>
      </form>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col justify-end gap-4">
      <div>
        <p className="font-display text-[34px] leading-none font-bold tracking-tight text-ink">
          Ask me about<br />your money.
        </p>
        <p className="mt-3 text-[15px] text-muted">
          I look up your household's receipts to answer — totals, trends, merchants, even items you bought.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="min-h-12 rounded-2xl bg-card px-4 py-3 text-left text-[15px] font-medium text-ink active:bg-card-2"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  if (message.role === 'user') {
    return (
      <div className="ml-10 self-end rounded-3xl rounded-br-lg bg-accent px-4 py-2.5 text-[15px] whitespace-pre-wrap text-on-accent">
        {message.content}
      </div>
    )
  }
  return (
    <div className="mr-6 self-start">
      <div
        className={`rounded-3xl rounded-bl-lg px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
          message.isError
            ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200'
            : 'bg-card text-ink'
        }`}
      >
        {renderInline(message.content)}
      </div>
      {message.retryQuestion && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-[13px] font-semibold text-ink active:bg-card-2"
        >
          <Icon name="refresh" size={14} />
          Retry
        </button>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && <LookupTrail calls={message.toolCalls} />}
    </div>
  )
}

/** Shows which lookups the agent ran, so a number can be traced back to its source. */
function LookupTrail({ calls }: { calls: AgentToolCall[] }) {
  return (
    <details className="mt-1 px-2 text-xs text-muted">
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
    <div className="flex items-center gap-1 self-start rounded-3xl rounded-bl-lg bg-card px-4 py-4" aria-label="Looking that up">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-muted motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}
