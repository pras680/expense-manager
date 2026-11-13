import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

// Small layout pieces shared by every screen, so cards, section titles and
// list rows are the same shape everywhere instead of re-styled per page.

/** The standard rounded surface. `className` adds padding/spacing as needed. */
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-card ${className}`}>{children}</section>
}

/** A card's heading row, with an optional trailing link. */
export function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  )
}

/** Small caption above a group of cards or rows. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-1 text-[13px] font-medium text-muted">{children}</h2>
}

interface NavRowProps {
  to: string
  state?: unknown
  icon?: IconName
  label: string
  /** Secondary line under the label. */
  hint?: string
  /** Short status at the right edge, before the chevron. */
  value?: string
}

/** A settings-style row that leads to another page. */
export function NavRow({ to, state, icon, label, hint, value }: NavRowProps) {
  return (
    <Link to={to} state={state} className="flex min-h-[60px] items-center gap-3 py-2 active:opacity-70">
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card-2 text-ink">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink">{label}</span>
        {hint && <span className="block truncate text-[13px] text-muted">{hint}</span>}
      </span>
      {value && <span className="shrink-0 text-sm text-muted">{value}</span>}
      <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
    </Link>
  )
}

interface ChipProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

/** A filter chip. Active is the inverse of the page (ink on bg), not the accent,
    so a row of filters never competes with the screen's one accent element. */
export function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-11 shrink-0 rounded-full px-4 text-sm font-medium whitespace-nowrap ${
        active ? 'bg-ink text-bg' : 'bg-card text-ink active:bg-card-2'
      }`}
    >
      {children}
    </button>
  )
}

type NoticeTone = 'warn' | 'error' | 'ok' | 'info'

const NOTICE_TONE: Record<NoticeTone, string> = {
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200',
  info: 'bg-card-2 text-ink'
}

/** An inline message box. Colour is never the only signal: the text says what happened. */
export function Notice({ tone = 'info', children, role }: { tone?: NoticeTone; children: React.ReactNode; role?: 'alert' }) {
  return (
    <div role={role} className={`rounded-2xl px-4 py-3 text-sm ${NOTICE_TONE[tone]}`}>
      {children}
    </div>
  )
}

/** Shown while the receipts are still loading or a list has nothing in it. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-10 text-center text-[15px] text-muted">{children}</p>
}

/** Button styles, as class strings so they work on <button>, <Link> and <a> alike. */
export const btn = {
  primary: 'flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-on-accent transition-opacity disabled:opacity-50 active:opacity-80',
  secondary: 'flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-card px-5 text-base font-semibold text-ink disabled:opacity-50 active:bg-card-2',
  /** Secondary, for use on top of a card (where bg-card would disappear). */
  inset: 'flex min-h-11 items-center justify-center gap-2 rounded-full bg-card-2 px-4 text-sm font-semibold text-ink disabled:opacity-50 active:opacity-80',
  small: 'flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50 active:opacity-80',
  danger: 'flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-card px-5 text-base font-semibold text-red-600 dark:text-red-400 disabled:opacity-50 active:bg-card-2'
} as const
