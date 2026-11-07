import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AuthRequiredError, askSpending, type AgentToolCall, type ChatTurn } from '../lib/supabaseClient'
import { randomId } from '../lib/id'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AgentToolCall[]
  /** Error bubbles are shown but never replayed to the agent as history. */
  isError?: boolean
}

interface ChatContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  messages: ChatMessage[]
  sending: boolean
  send: (text: string) => Promise<void>
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

  const send = useCallback(async (raw: string) => {
    const text = raw.trim().slice(0, MAX_MESSAGE_CHARS)
    if (!text || sending) return
    const history: ChatTurn[] = messages
      .filter((m) => !m.isError)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))
    const gen = generation.current
    setMessages((prev) => [...prev, { id: randomId(), role: 'user', content: text }])
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
      setMessages((prev) => [
        ...prev,
        {
          id: randomId(),
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Something went wrong.',
          isError: true
        }
      ])
    } finally {
      if (gen === generation.current) setSending(false)
    }
  }, [messages, sending])

  const reset = useCallback(() => {
    generation.current++
    setMessages([])
    setSending(false)
  }, [])

  const value = useMemo(
    () => ({ open, setOpen, messages, sending, send, reset }),
    [open, messages, sending, send, reset]
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
