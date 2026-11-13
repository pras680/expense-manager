import { useNavigate } from 'react-router-dom'
import { goBack } from '../lib/navigation'
import type { Trail } from '../lib/trail'
import { Icon } from './Icon'

interface PageHeaderProps {
  /** Shown beside the back button. Omit on drill-down pages that pass `trail`. */
  title?: string
  /**
   * Where to go when there is no in-app history to pop — a deep link, a PWA
   * cold start, or a page reached by reload. Without this, `navigate(-1)` from
   * a first entry walks the user out of the app entirely.
   */
  backTo: string
  /** Optional trailing control (refresh, delete, etc.). */
  action?: React.ReactNode
  /** Breadcrumb chips for a drill-down page; each jumps back to that level. */
  trail?: Trail
}

export function PageHeader({ title, backTo, action, trail }: PageHeaderProps) {
  const navigate = useNavigate()
  const crumbs = trail?.crumbs ?? []

  function jump(index: number) {
    const crumb = crumbs[index]
    if (trail?.fromHistory) {
      // Each crumb is a history entry behind this page, in order, so popping
      // (rather than pushing) keeps the back stack as short as the trail.
      navigate(index - crumbs.length)
    } else {
      navigate(crumb.to, { replace: true })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => goBack(navigate, backTo)}
        aria-label="Go back"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink active:bg-card-2"
      >
        <Icon name="chevron-left" />
      </button>
      {title && (
        <h1 className="min-w-0 flex-1 truncate font-display text-xl font-bold tracking-tight text-ink">{title}</h1>
      )}
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {crumbs.map((c, i) => (
            <button
              key={`${i}-${c.label}`}
              type="button"
              onClick={() => jump(i)}
              className="h-11 shrink-0 rounded-full bg-card px-3.5 text-[13px] font-medium whitespace-nowrap text-muted active:bg-card-2"
            >
              {c.label}
            </button>
          ))}
        </nav>
      )}
      {!title && crumbs.length === 0 && <div className="flex-1" />}
      {action}
    </div>
  )
}
