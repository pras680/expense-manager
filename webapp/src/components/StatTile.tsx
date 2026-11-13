import { Link } from 'react-router-dom'

interface StatTileProps {
  label: string
  value: string
  /** One line of context under the figure. */
  hint?: string
  /** Where tapping the figure drills to. Every stat in the app leads somewhere. */
  to?: string
  state?: unknown
}

export function StatTile({ label, value, hint, to, state }: StatTileProps) {
  const body = (
    <>
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 truncate font-display text-[30px] leading-none font-semibold tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-2 text-[13px] text-muted">{hint}</div>}
    </>
  )
  const cls = 'block min-w-0 flex-1 rounded-3xl bg-card p-[18px]'
  return to ? (
    <Link to={to} state={state} className={`${cls} active:bg-card-2`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
