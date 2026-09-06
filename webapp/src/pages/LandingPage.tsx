import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { needsReview } from '../lib/receiptShape'
import { computeSpendingInsight, computeTopCategories } from '../lib/spendingInsights'
import { ACCENT, CATEGORY_BAR_CLASSES } from '../lib/theme'

// Poster hero treatment adapted from the "Modernist" design system exploration
// (Claude Design project ccbe8d7a, option 2a) — sharp corners, Archivo, and
// this accent ramp are that system's tokens, now the app's shared theme (see
// ../lib/theme.ts and index.css) rather than scoped to just this page.

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

export function LandingPage() {
  const { receipts, loading, error } = useReceipts()
  const { defaultCurrency } = useSettings()

  if (loading) {
    return <div className="px-4 pt-8 text-center text-sm text-neutral-500 dark:text-neutral-400">Loading…</div>
  }

  const insight = computeSpendingInsight(receipts)
  const topCategories = computeTopCategories(receipts)
  const reviewCount = receipts.filter(needsReview).length
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' })
  const monthsTracked = insight.monthsOfHistory + (insight.thisMonth > 0 ? 1 : 0)

  return (
    <div className="pb-6">
      {error && (
        <div className="mx-4 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Full-bleed on purpose — the one place on this page that breaks out of
          the app's usual px-4 gutter, for the "poster" effect the design calls for. */}
      <div className="px-5 py-4 text-white" style={{ background: ACCENT }}>
        <div className="flex items-start justify-between gap-2">
          <span className="border border-white/80 px-2.5 py-1 text-[11px] font-medium tracking-wide">
            {monthLabel} so far
          </span>
          {reviewCount > 0 && (
            <Link
              to="/receipts?review=1"
              className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 text-[11px] font-bold tracking-wide"
              style={{ color: ACCENT }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              {reviewCount} to review
            </Link>
          )}
        </div>
        {/* Sized down from the original 52px poster treatment — the page has
            to fit a stat row and the "View all receipts" CTA above the fold
            on a phone-height viewport too, and the total doesn't need to be
            the single biggest thing on screen to still read as the hero. */}
        <div className="mt-2 text-[34px] font-extrabold leading-none tracking-tight">
          {formatMoney(insight.thisMonth, defaultCurrency)}
        </div>
      </div>

      <div className="px-4">
        <p className="mt-4 text-base font-semibold leading-snug text-neutral-900 dark:text-neutral-50">
          {insight.assessment}
        </p>

        <div className="mt-4 grid grid-cols-3 divide-x divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          <div className="flex flex-col items-center gap-0.5 px-1 py-2.5 text-center">
            <span className="text-[10px] font-bold uppercase leading-tight tracking-wide text-neutral-500 dark:text-neutral-400">
              Monthly average
            </span>
            <span className="text-base font-extrabold text-neutral-900 dark:text-neutral-50">
              {formatMoney(insight.monthlyAverage, defaultCurrency)}
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 px-1 py-2.5 text-center">
            <span className="text-[10px] font-bold uppercase leading-tight tracking-wide text-neutral-500 dark:text-neutral-400">
              Receipts logged
            </span>
            <span className="text-base font-extrabold text-neutral-900 dark:text-neutral-50">{receipts.length}</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 px-1 py-2.5 text-center">
            <span className="text-[10px] font-bold uppercase leading-tight tracking-wide text-neutral-500 dark:text-neutral-400">
              Months tracked
            </span>
            <span className="text-base font-extrabold text-neutral-900 dark:text-neutral-50">{monthsTracked}</span>
          </div>
        </div>

        <Link
          to="/receipts"
          className="mt-4 flex h-14 w-full items-center justify-between px-4 text-base font-extrabold text-white"
          style={{ background: ACCENT }}
        >
          View all receipts
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>

        {topCategories.length > 0 && (
          <div className="mt-5">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: ACCENT }}>
              Where it went
            </span>
            <div className="mt-3 flex flex-col gap-3">
              {topCategories.map((c, i) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 ${CATEGORY_BAR_CLASSES[i] ?? CATEGORY_BAR_CLASSES[3]}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      <span className="truncate">{c.category}</span>
                      <span className="shrink-0">{formatMoney(c.amount, defaultCurrency)}</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-neutral-200 dark:bg-neutral-800">
                      <div className={`h-full ${CATEGORY_BAR_CLASSES[i] ?? CATEGORY_BAR_CLASSES[3]}`} style={{ width: `${c.barPct}%` }} />
                    </div>
                  </div>
                  <span className="w-9 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                    {c.sharePct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
