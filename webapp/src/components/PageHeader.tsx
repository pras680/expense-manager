import { useNavigate } from 'react-router-dom'
import { canGoBack } from '../lib/navigation'

interface PageHeaderProps {
  title: string
  /**
   * Where to go when there is no in-app history to pop — a deep link, a PWA
   * cold start, or a page reached by reload. Without this, `navigate(-1)` from
   * a first entry walks the user out of the app entirely.
   */
  backTo: string
  /** Optional trailing control (refresh, delete, etc.). */
  action?: React.ReactNode
}

export function PageHeader({ title, backTo, action }: PageHeaderProps) {
  const navigate = useNavigate()

  function goBack() {
    // Popping gives the true previous screen; the fallback only applies when
    // there is no in-app history (deep link, reload, PWA cold start).
    if (canGoBack()) {
      navigate(-1)
    } else {
      navigate(backTo, { replace: true })
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={goBack}
        aria-label="Go back"
        // -ml-2 pulls the 44px touch target back so the glyph still lines up
        // with the page's 16px gutter.
        className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-700 active:bg-neutral-100 dark:text-neutral-300 dark:active:bg-neutral-800"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 5l-7 7 7 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-neutral-900 dark:text-neutral-50">
        {title}
      </h1>
      {action}
    </div>
  )
}
