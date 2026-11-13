import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { ReceiptCard } from '../components/ReceiptCard'
import { Chip, EmptyState, Notice, btn } from '../components/ui'
import { Icon } from '../components/Icon'
import { receiptMatches, reportingTotal, needsReview, isExpenseReceipt, hasMergedSources } from '../lib/receiptShape'
import { dayKey, dayLabel, formatMoney, plural } from '../lib/format'
import type { Receipt } from '../types/receipt'
import type { TrailState } from '../lib/trail'
import { markReceiptsReviewed } from '../lib/supabaseClient'

// The Receipts tab: every receipt, newest first, grouped by day. One search
// box and one row of filter chips; the chips combine (To review + Mine shows
// your own unchecked imports).

type FilterKey = 'review' | 'mine' | 'last30' | 'noDate' | 'merged'

const NO_DATE = 'no-date'
const FROM_RECEIPTS: TrailState = { trail: [{ label: 'Receipts', to: '/receipts' }] }

export function ReceiptsListPage() {
  const { receipts, loading, error, refresh } = useReceipts()
  const { defaultCurrency } = useSettings()
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  // "To review" is pre-set by Home's tile (?filter=pending), so tapping it
  // lands here already filtered instead of needing a second tap.
  const [filters, setFilters] = useState<Set<FilterKey>>(
    () => new Set(searchParams.get('filter') === 'pending' ? ['review'] : [])
  )
  const [clearing, setClearing] = useState(false)
  // Set by AddReceiptPage when a save folded into an existing receipt rather
  // than creating a new one — otherwise that merge is invisible.
  const location = useLocation()
  const mergedInto = (location.state as { mergedInto?: { id: string; merchant: string | null } } | null)?.mergedInto ?? null
  const [mergeNoticeDismissed, setMergeNoticeDismissed] = useState(false)

  // Auto-imported receipts nobody has confirmed yet: parsed by an LLM
  // unattended, so amounts and dates can be wrong.
  const unreviewed = useMemo(() => receipts.filter(needsReview), [receipts])
  // Receipts the duplicate guard folded a second source into, instead of
  // creating a duplicate.
  const mergedCount = useMemo(() => receipts.filter(hasMergedSources).length, [receipts])
  const hasUndated = useMemo(() => receipts.some((r) => dayKey(r.date) === null), [receipts])

  function toggle(key: FilterKey) {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // A receipt can't be both recent and undated; picking one drops the other.
      if (key === 'last30') next.delete('noDate')
      if (key === 'noDate') next.delete('last30')
      return next
    })
  }

  async function markAllReviewed() {
    if (!session?.userId || unreviewed.length === 0) return
    setClearing(true)
    try {
      await markReceiptsReviewed(unreviewed.map((r) => r.id), session.userId)
      setFilters((prev) => {
        const next = new Set(prev)
        next.delete('review')
        return next
      })
      await refresh()
    } finally {
      setClearing(false)
    }
  }

  const filtered = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    return receipts.filter((r) => {
      if (filters.has('review') && !needsReview(r)) return false
      if (filters.has('merged') && !hasMergedSources(r)) return false
      if (filters.has('mine') && r.userId !== session?.userId) return false
      if (filters.has('last30')) {
        if (!r.date) return false
        const t = new Date(r.date).getTime()
        if (Number.isNaN(t) || t < thirtyDaysAgo) return false
      }
      if (filters.has('noDate') && r.date) return false
      return receiptMatches(r, query)
    })
  }, [receipts, filters, query, session?.userId])

  // Already newest-first from the provider, so consecutive receipts with the
  // same day form the groups; undated ones collect in one group at the end.
  const groups = useMemo(() => {
    const list: { key: string; rows: Receipt[]; spend: number }[] = []
    const undated: Receipt[] = []
    for (const r of filtered) {
      const key = dayKey(r.date)
      if (!key) {
        undated.push(r)
        continue
      }
      let group = list[list.length - 1]
      if (!group || group.key !== key) {
        group = { key, rows: [], spend: 0 }
        list.push(group)
      }
      group.rows.push(r)
      if (isExpenseReceipt(r)) group.spend += reportingTotal(r) ?? 0
    }
    if (undated.length > 0) {
      list.push({
        key: NO_DATE,
        rows: undated,
        spend: undated.filter(isExpenseReceipt).reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
      })
    }
    return list
  }, [filtered])

  const totalSpend = useMemo(
    () => filtered.filter(isExpenseReceipt).reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [filtered]
  )
  const narrowed = filters.size > 0 || query.trim() !== ''

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-5 pb-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[30px] leading-none font-bold tracking-tight text-ink">Receipts</h1>
        <button
          type="button"
          onClick={() => refresh()}
          aria-label="Refresh"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink active:bg-card-2"
        >
          <Icon name="refresh" size={18} />
        </button>
      </div>

      <label className="flex min-h-[52px] items-center gap-2.5 rounded-full bg-card px-4 focus-within:ring-2 focus-within:ring-accent">
        <Icon name="search" size={18} className="shrink-0 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant, item, amount, card…"
          aria-label="Search receipts"
          className="h-[52px] min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Filters">
        <Chip active={filters.size === 0} onClick={() => setFilters(new Set())}>All</Chip>
        {unreviewed.length > 0 && (
          <Chip active={filters.has('review')} onClick={() => toggle('review')}>To review · {unreviewed.length}</Chip>
        )}
        <Chip active={filters.has('mine')} onClick={() => toggle('mine')}>Mine</Chip>
        <Chip active={filters.has('last30')} onClick={() => toggle('last30')}>Last 30 days</Chip>
        {mergedCount > 0 && (
          <Chip active={filters.has('merged')} onClick={() => toggle('merged')}>Merged · {mergedCount}</Chip>
        )}
        {hasUndated && <Chip active={filters.has('noDate')} onClick={() => toggle('noDate')}>No date</Chip>}
      </div>

      {mergedInto && !mergeNoticeDismissed && (
        <Notice tone="ok">
          <p className="font-medium">
            Saved into your existing {mergedInto.merchant ? `“${mergedInto.merchant}” ` : ''}receipt
          </p>
          <p className="mt-0.5 text-[13px] opacity-90">
            It matched a receipt already imported from SMS or email for the same charge, so the details were combined instead of creating a duplicate.
          </p>
          <div className="mt-3 flex gap-2">
            <Link to={`/receipts/${mergedInto.id}`} state={FROM_RECEIPTS} className={btn.inset}>View it</Link>
            <button type="button" onClick={() => setMergeNoticeDismissed(true)} className={btn.inset}>Dismiss</button>
          </div>
        </Notice>
      )}

      {filters.has('review') && unreviewed.length > 0 && (
        <div className="rounded-3xl bg-card p-[18px]">
          <p className="text-[15px] font-medium text-ink">
            {plural(unreviewed.length, 'receipt')} imported automatically
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Read from your SMS alerts and email with nobody watching. Check the amounts and dates, or swipe a row left to approve it.
          </p>
          <button type="button" onClick={markAllReviewed} disabled={clearing} className={`${btn.inset} mt-3`}>
            <Icon name="check" size={16} />
            {clearing ? 'Marking…' : 'Mark all checked'}
          </button>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {loading ? (
        <EmptyState>Loading…</EmptyState>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState>{receipts.length === 0 ? 'No receipts yet.' : 'No receipts match.'}</EmptyState>
          {receipts.length === 0 && <Link to="/add" className={btn.primary}>Add your first receipt</Link>}
        </div>
      ) : (
        <>
          {narrowed && (
            <p className="px-1 text-[13px] text-muted">
              {plural(filtered.length, 'receipt')} · {formatMoney(totalSpend, defaultCurrency, { cents: true })} spent
            </p>
          )}
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between px-1 pt-1 text-[13px] text-muted">
                <h2 className="font-medium">{group.key === NO_DATE ? 'No date' : dayLabel(group.key)}</h2>
                <span>{formatMoney(group.spend, defaultCurrency, { cents: true })}</span>
              </div>
              {group.rows.map((r) => (
                <ReceiptCard
                  key={r.id}
                  receipt={r}
                  showDate={false}
                  linkState={FROM_RECEIPTS}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  )
}
