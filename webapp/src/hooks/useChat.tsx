import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AskSpendingError, AuthRequiredError, askSpending, type AgentToolCall, type ChatTurn } from '../lib/supabaseClient'
import { randomId } from '../lib/id'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AgentToolCall[]
  /** Error bubbles are shown but never replayed to the agent as history. */
  isError?: boolean
  /** On a retryable error: the question that failed, to ask again. */
  retryQuestion?: string
}

interface ChatContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  messages: ChatMessage[]
  sending: boolean
  send: (text: string) => void
  /** Removes a failed exchange and asks its question again. */
  retry: (errorId: string) => void
  reset: () => void
}

// Matches the edge function's MAX_HISTORY_TURNS; sending more is just discarded.
const HISTORY_TURNS = 10
const MAX_MESSAGE_CHARS = 1_000

const ChatContext = createContext<ChatContextValue | null>(null)

// In memory only, deliberately: answers are household spending figures, and
// sessionStorage would keep them on a shared device after sign-out. The
// router above this is keyed by user id, so switching users starts fresh.
export function ChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  // Lets a reset() mid-request drop the late reply instead of appending it
  // to the new, empty conversation.
  const generation = useRef(0)

  // `base` is the conversation the question is asked on top of: normally the
  // current one, or the one with a failed exchange removed when retrying.
  const ask = useCallback(async (text: string, base: ChatMessage[]) => {
    const history: ChatTurn[] = base
      .filter((m) => !m.isError)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))
    const gen = generation.current
    setMessages([...base, { id: randomId(), role: 'user', content: text }])
    setSending(true)
    try {
      const result = await askSpending(text, history)
      if (gen !== generation.current) return
      setMessages((prev) => [
        ...prev,
        {
          id: randomId(),
          role: 'assistant',
          content: result.reply || "I couldn't come up with an answer to that.",
          toolCalls: result.toolCalls
        }
      ])
    } catch (err) {
      if (gen !== generation.current) return
      // AuthRequiredError already routes the app back to sign-in.
      if (err instanceof AuthRequiredError) return
      const retryable = !(err instanceof AskSpendingError) || err.retryable
      setMessages((prev) => [
        ...prev,
        {
          id: randomId(),
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Something went wrong.',
          isError: true,
          retryQuestion: retryable ? text : undefined
        }
      ])
    } finally {
      if (gen === generation.current) setSending(false)
    }
  }, [])

  const send = useCallback((raw: string) => {
    const text = raw.trim().slice(0, MAX_MESSAGE_CHARS)
    if (!text || sending) return
    void ask(text, messages)
  }, [ask, messages, sending])

  const retry = useCallback((errorId: string) => {
    if (sending) return
    const i = messages.findIndex((m) => m.id === errorId)
    const question = messages[i]?.retryQuestion
    if (i < 1 || !question) return
    // Drop the failed question and its error bubble; ask() re-adds the question.
    void ask(question, [...messages.slice(0, i - 1), ...messages.slice(i + 1)])
  }, [ask, messages, sending])

  const reset = useCallback(() => {
    generation.current++
    setMessages([])
    setSending(false)
  }, [])

  const value = useMemo(
    () => ({ open, setOpen, messages, sending, send, retry, reset }),
    [open, messages, sending, send, retry, reset]
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
