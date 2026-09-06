import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { ReceiptCard } from '../components/ReceiptCard'
import { StatTile } from '../components/StatTile'
import { PageHeader } from '../components/PageHeader'
import { receiptMatches, reportingTotal, needsReview, isExpenseReceipt, hasMergedSources } from '../lib/receiptShape'
import { markReceiptsReviewed } from '../lib/supabaseClient'

type FilterKey = 'all' | 'last30' | 'noDate'
type OwnerFilter = 'everyone' | 'mine'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'noDate', label: 'No Date' }
]

export function ReceiptsListPage() {
  const { receipts, loading, error, refresh } = useReceipts()
  const { defaultCurrency } = useSettings()
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('everyone')
  // Auto-imported receipts nobody has confirmed yet. These are the reason the
  // banner exists: they were parsed by an LLM unattended, so amounts and dates
  // can be wrong and the user needs a nudge to look. Pre-set by the "N to
  // review" tag on the Home landing page (?review=1), so tapping it lands
  // here already filtered instead of requiring a second tap.
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(() => searchParams.get('review') === '1')
  const [clearing, setClearing] = useState(false)

  const unreviewed = useMemo(() => receipts.filter(needsReview), [receipts])
  // Receipts the duplicate guard folded a second source into (e.g. an email
  // scan enriching an SMS-created receipt) instead of creating a duplicate —
  // surfaced here so merge activity is visible even when the merge landed on
  // an already-reviewed receipt and never shows up in the banner above.
  const merged = useMemo(() => receipts.filter(hasMergedSources), [receipts])

  async function markAllReviewed() {
    if (!session?.userId || unreviewed.length === 0) return
    setClearing(true)
    try {
      await markReceiptsReviewed(unreviewed.map((r) => r.id), session.userId)
      setOnlyUnreviewed(false)
      await refresh()
    } finally {
      setClearing(false)
    }
  }

  const filtered = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    return receipts.filter((r) => {
      if (onlyUnreviewed && !needsReview(r)) return false
      if (ownerFilter === 'mine' && r.userId !== session?.userId) return false
      if (filter === 'last30') {
        if (!r.date) return false
        const t = new Date(r.date).getTime()
        if (Number.isNaN(t) || t < thirtyDaysAgo) return false
      } else if (filter === 'noDate') {
        if (r.date) return false
      }
      return receiptMatches(r, query)
    })
  }, [receipts, filter, query, ownerFilter, session?.userId, onlyUnreviewed])

  const totalSpend = useMemo(
    () => filtered.filter(isExpenseReceipt).reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [filtered]
  )

  function formatMoney(amount: number) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: defaultCurrency }).format(amount)
    } catch {
      return `${defaultCurrency} ${amount.toFixed(2)}`
    }
  }

  return (
    <div className="px-4 pt-4">
      <PageHeader
        title="Receipts"
        backTo="/"
        action={
          <button
            onClick={() => refresh()}
            className="shrink-0 px-1 text-sm font-medium text-accent-700 dark:text-accent-400"
            aria-label="Refresh"
          >
            Refresh
          </button>
        }
      />

      {unreviewed.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {unreviewed.length} new receipt{unreviewed.length === 1 ? '' : 's'} imported automatically
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300/80">
            Read from your SMS alerts and email. Check the amounts and dates are right.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setOnlyUnreviewed((v) => !v)}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {onlyUnreviewed ? 'Show all' : 'Review them'}
            </button>
            <button
              onClick={markAllReviewed}
              disabled={clearing}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-amber-900 disabled:opacity-60 dark:bg-neutral-900 dark:text-amber-200"
            >
              {clearing ? 'Marking…' : 'Mark all checked'}
            </button>
          </div>
        </div>
      )}

      {merged.length > 0 && (
        <div className="mt-3 rounded-xl border border-accent-300 bg-accent-50 p-3 dark:border-accent-700/60 dark:bg-accent-950/30">
          <p className="text-sm font-medium text-accent-900 dark:text-accent-200">
            🔗 {merged.length} receipt{merged.length === 1 ? '' : 's'} merged from multiple sources
          </p>
          <p className="mt-0.5 text-xs text-accent-800 dark:text-accent-300/80">
            A later SMS, email, or photo for the same charge was combined into the original receipt instead of creating a duplicate. Look for the "Merged" tag below.
          </p>
        </div>
      )}

      {/* This month's overview now lives on the Home landing page — these two
          reflect the current search/filter, which the landing page can't. */}
      <div className="mt-3 flex gap-2">
        <StatTile label="Shown" value={formatMoney(totalSpend)} />
        <StatTile label="Receipts" value={String(filtered.length)} />
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search merchant, item, amount, card…"
        className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
      />

      <div className="mt-3 flex gap-2">
        {([
          { key: 'everyone', label: 'Everyone' },
          { key: 'mine', label: 'Only mine' }
        ] as { key: OwnerFilter; label: string }[]).map((f) => (
          <button
            key={f.key}
            onClick={() => setOwnerFilter(f.key)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium ${
              ownerFilter === f.key
                ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
                : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === f.key
                ? 'bg-accent-700 text-white'
                : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 text-center text-sm text-neutral-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <p className="text-neutral-500 dark:text-neutral-400">
            {receipts.length === 0 ? "No receipts yet." : 'No receipts match your search.'}
          </p>
          {receipts.length === 0 && (
            <Link to="/add" className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-white">
              Add your first receipt
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 pb-6">
          {filtered.map((r) => (
            <ReceiptCard key={r.id} receipt={r} />
          ))}
        </div>
      )}
    </div>
  )
}
