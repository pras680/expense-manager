import { useChat } from '../hooks/useChat'
import { Icon } from './Icon'

/**
 * Home's entry point to the spending chat: a full-width bar in the accent
 * colour, the one loud element on the screen. Opens the same conversation as
 * the floating launcher TalkToMe shows on other tabs (which hides itself on
 * Home so there's never two of them).
 */
export function AskBar() {
  const { setOpen } = useChat()
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Talk to me — ask about your spending"
      className="flex min-h-16 w-full items-center gap-3 rounded-full bg-accent py-2 pr-2 pl-5 text-left text-on-accent transition-transform active:scale-[0.98]"
    >
      <Icon name="sparkles" size={24} />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg leading-tight font-semibold">Ask about your spending</span>
        <span className="block truncate text-[13px] opacity-80">“Where does most of my money go?”</span>
      </span>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-on-accent text-accent">
        <Icon name="send" size={20} />
      </span>
    </button>
  )
}
