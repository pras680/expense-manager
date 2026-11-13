import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { needsReview } from '../lib/receiptShape'
import { computeSpendingInsight, computeTopCategories } from '../lib/spendingInsights'
import { formatMoney, plural } from '../lib/format'
import { monthKey } from '../lib/months'
import type { TrailState } from '../lib/trail'
import { categoryStyle } from '../lib/categoryStyle'
import { Wordmark } from '../components/Wordmark'
import { AskBar } from '../components/AskBar'
import { StatTile } from '../components/StatTile'
import { ReceiptCard } from '../components/ReceiptCard'
import { CategoryDot } from '../components/CategoryIcon'
import { Card, CardTitle, Notice, btn } from '../components/ui'
import { Icon } from '../components/Icon'

// Home: this month at a glance. Four blocks and nothing else — the total and
// its pace, the Ask bar, two tiles, and where the money went — and every
// figure on it is a link to the detail behind it.

/** Every page reached from here shows "Home" as the first step of its trail. */
const FROM_HOME: TrailState = { trail: [{ label: 'Home', to: '/' }] }

export function LandingPage() {
  const { receipts, loading, error } = useReceipts()
  const { defaultCurrency } = useSettings()

  const insight = useMemo(() => computeSpendingInsight(receipts), [receipts])
  const topCategories = useMemo(() => computeTopCategories(receipts), [receipts])
  const reviewCount = useMemo(() => receipts.filter(needsReview).length, [receipts])
  // The provider already sorts newest first.
  const latest = useMemo(() => receipts.slice(0, 3), [receipts])

  if (loading) {
    return <div className="px-4 pt-10 text-center text-sm text-muted">Loading…</div>
  }

  const now = new Date()
  const thisMonth = monthKey(now)
  const monthName = now.toLocaleDateString(undefined, { month: 'long' })
  const money = (amount: number) => formatMoney(amount, defaultCurrency)

  // Meter: how far through a typical month's spend this month already is,
  // with a tick where an average month would be by today's date.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const todayPct = (now.getDate() / daysInMonth) * 100
  const fillPct = insight.fractionOfAverage != null
    ? Math.min(100, Math.max(0, insight.fractionOfAverage * 100))
    : 0
  const hasHistory = insight.monthsOfHistory > 0

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-5 pb-6">
      <Wordmark as="h1" />

      {error && <Notice tone="error">{error}</Notice>}

      <Link
        to="/reports"
        state={FROM_HOME}
        className="block rounded-[28px] bg-card p-[22px] active:bg-card-2"
      >
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{monthName} so far</span>
          <Icon name="chevron-right" size={18} />
        </div>
        <div className="mt-3 font-display text-[56px] leading-none font-semibold tracking-tighter text-ink">
          {money(insight.thisMonth)}
        </div>
        {hasHistory && (
          // The tick sits outside the clipped track and overhangs it, so it
          // stays visible whether it lands on the fill or the bare track.
          <div className="relative mt-5 py-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-card-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${fillPct}%` }} />
            </div>
            <div
              aria-hidden="true"
              className="absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${todayPct}%` }}
            />
          </div>
        )}
        <p className="mt-3 text-[15px] leading-snug text-ink">{insight.assessment}</p>
      </Link>

      <AskBar />

      <div className="flex gap-3.5">
        <StatTile
          label="To review"
          value={String(reviewCount)}
          hint={reviewCount > 0 ? 'from SMS and email' : 'all checked'}
          to="/receipts?filter=pending"
          state={FROM_HOME}
        />
        <StatTile
          label="Typical month"
          value={hasHistory ? money(insight.monthlyAverage) : '—'}
          hint={hasHistory ? `across ${plural(insight.monthsOfHistory, 'month')}` : 'needs a full month'}
          to="/reports/monthly"
          state={FROM_HOME}
        />
      </div>

      {topCategories.length > 0 && (
        <Card className="px-[18px] pt-2 pb-2">
          <CardTitle
            action={
              <Link to="/reports" state={FROM_HOME} className="flex h-11 items-center text-sm text-muted">
                See all
              </Link>
            }
          >
            Where it went
          </CardTitle>
          {topCategories.map((c) => (
            <Link
              key={c.category}
              to={`/reports/category/${encodeURIComponent(c.category)}?month=${thisMonth}`}
              state={FROM_HOME}
              className="flex min-h-14 items-center gap-3 active:opacity-70"
            >
              <CategoryDot category={c.category} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-ink">{c.category}</div>
                <div className="mt-1.5 h-1 rounded-full bg-card-2">
                  <div className="h-full rounded-full" style={{ width: `${c.barPct}%`, background: categoryStyle(c.category).color }} />
                </div>
              </div>
              <span className="w-9 shrink-0 text-right text-[13px] text-muted">{c.sharePct}%</span>
              <span className="shrink-0 font-display text-base font-semibold text-ink">{money(c.amount)}</span>
            </Link>
          ))}
        </Card>
      )}

      {latest.length > 0 ? (
        <Card className="px-[18px] pt-2 pb-2">
          <CardTitle
            action={
              <Link to="/receipts" state={FROM_HOME} className="flex h-11 items-center text-sm text-muted">
                All receipts
              </Link>
            }
          >
            Latest
          </CardTitle>
          {latest.map((r) => (
            <ReceiptCard key={r.id} receipt={r} flat linkState={FROM_HOME} />
          ))}
        </Card>
      ) : (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-[15px] text-muted">No receipts yet. Snap one, or forward a bank alert, and it shows up here.</p>
          <Link to="/add" className={btn.primary}>Add your first receipt</Link>
        </Card>
      )}
    </div>
  )
}
