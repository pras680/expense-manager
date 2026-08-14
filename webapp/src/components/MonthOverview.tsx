import type { SpendingInsight, SpendingPace } from '../lib/spendingInsights'

// The meter's fill carries severity; the track is a lighter step of the same
// ramp so the state reads across the whole bar. Colour never carries the
// meaning alone — the assessment sentence below always states it in words.
const PACE_STYLE: Record<SpendingPace, { fill: string; track: string; dot: string; text: string }> = {
  'no-history': {
    fill: 'bg-neutral-400',
    track: 'bg-neutral-200 dark:bg-neutral-700',
    dot: 'bg-neutral-400',
    text: 'text-neutral-600 dark:text-neutral-400'
  },
  under: {
    fill: 'bg-teal-600',
    track: 'bg-teal-100 dark:bg-teal-950',
    dot: 'bg-teal-600',
    text: 'text-teal-800 dark:text-teal-300'
  },
  'on-track': {
    fill: 'bg-teal-600',
    track: 'bg-teal-100 dark:bg-teal-950',
    dot: 'bg-teal-600',
    text: 'text-teal-800 dark:text-teal-300'
  },
  over: {
    fill: 'bg-amber-500',
    track: 'bg-amber-100 dark:bg-amber-950',
    dot: 'bg-amber-500',
    text: 'text-amber-800 dark:text-amber-300'
  },
  'well-over': {
    fill: 'bg-red-600',
    track: 'bg-red-100 dark:bg-red-950',
    dot: 'bg-red-600',
    text: 'text-red-800 dark:text-red-300'
  }
}

interface MonthOverviewProps {
  insight: SpendingInsight
  currency: string
}

export function MonthOverview({ insight, currency }: MonthOverviewProps) {
  // Whole units throughout this card: cents are noise on a 44px hero figure and
  // on figures that are averages/projections rather than exact amounts.
  const money = (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
      }).format(amount)
    } catch {
      return `${currency} ${Math.round(amount)}`
    }
  }

  const style = PACE_STYLE[insight.pace]
  const hasHistory = insight.monthsOfHistory > 0

  // Cap the bar at 100% so an overspent month can't render past the track;
  // the number and the sentence carry the overage.
  const fillPct = insight.fractionOfAverage != null
    ? Math.min(100, Math.max(0, insight.fractionOfAverage * 100))
    : 0
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const todayPct = (now.getDate() / daysInMonth) * 100
  const monthLabel = now.toLocaleDateString(undefined, { month: 'long' })

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {monthLabel} so far
        </h2>
        {hasHistory && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            avg {money(insight.monthlyAverage)}/mo
          </span>
        )}
      </div>

      {/* Hero figure — the one number this view leads with. Proportional
          figures (not tabular) so the digits don't look loose at display size. */}
      <div className="mt-1 text-[2.75rem] font-semibold leading-none tracking-tight text-neutral-900 dark:text-neutral-50">
        {money(insight.thisMonth)}
      </div>

      {hasHistory && (
        <div className="mt-5">
          {/* The marker sits OUTSIDE the clipped track and overhangs it, so the
              target stays legible whether it falls on the fill or the bare
              track — it can't rely on contrast against a fill whose colour
              changes with severity. */}
          <div className="relative py-1">
            <div className={`h-2 w-full overflow-hidden rounded-full ${style.track}`}>
              <div
                className={`h-full rounded-full ${style.fill}`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <div
              className="absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full bg-neutral-900/70 dark:bg-white/80"
              style={{ left: `${todayPct}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>{Math.round(fillPct)}% of a typical month</span>
            <span>pace marker: {money(insight.expectedByNow)}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <p className={`text-sm ${style.text}`}>{insight.assessment}</p>
      </div>
    </section>
  )
}
