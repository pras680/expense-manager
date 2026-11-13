import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { isExpenseReceipt } from '../lib/receiptShape'
import { monthKey, monthLabel } from '../lib/months'
import { formatMoney, plural } from '../lib/format'
import { ALL_CATEGORIES, ALL_TIME, byCategory, inPeriod, monthTotals, recentMonthKeys, sumTotals } from '../lib/insights'
import { categoryStyle } from '../lib/categoryStyle'
import { extendTrail, useTrail } from '../lib/trail'
import { periodShortLabel } from '../lib/period'
import { MonthBars } from '../components/MonthBars'
import { CategoryIcon } from '../components/CategoryIcon'
import { Card, CardTitle, Chip, EmptyState, NavRow } from '../components/ui'
import { Icon } from '../components/Icon'

// Insights: the top of the drill-down. Pick a month on the chart, see how it
// split by category, and keep tapping: category -> merchant -> receipt.
//
// The selected month lives in the URL (?m=2026-11, or ?m=all) so coming back
// from a category page restores it, and so Home can link straight to a month.

const BAR_COUNT = 6

export function InsightsPage() {
  const { receipts, loading } = useReceipts()
  const { defaultCurrency } = useSettings()
  const [params, setParams] = useSearchParams()
  const trail = useTrail([])
  const currentMonth = useMemo(() => monthKey(new Date()), [])
  const selected = params.get('m') || currentMonth
  const isAllTime = selected === ALL_TIME

  const money = (amount: number) => formatMoney(amount, defaultCurrency)

  // Changing month is a sideways move, not a step deeper, so it replaces the
  // history entry: back from here should leave Insights, not replay months.
  function select(key: string) {
    setParams(key === currentMonth ? {} : { m: key }, { replace: true, state: trail.fromHistory ? { trail: trail.crumbs } : null })
  }

  const totals = useMemo(() => monthTotals(receipts), [receipts])

  // Normally the last six calendar months. A month picked from the full
  // list can be older than that, in which case the window ends on it instead.
  const bars = useMemo(() => {
    const recent = recentMonthKeys(BAR_COUNT)
    const keys = isAllTime || recent.includes(selected) || !/^\d{4}-\d{2}$/.test(selected)
      ? recent
      : recentMonthKeys(BAR_COUNT, new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, 1))
    const byKey = new Map(totals.map((t) => [t.key, t.total]))
    return keys.map((key) => ({ key, total: byKey.get(key) ?? 0 }))
  }, [totals, selected, isAllTime])

  const inSelected = useMemo(() => inPeriod(receipts, selected), [receipts, selected])
  const spend = useMemo(() => inSelected.filter(isExpenseReceipt), [inSelected])
  const moved = useMemo(() => byCategory(inSelected.filter((r) => !isExpenseReceipt(r))), [inSelected])
  const categories = useMemo(() => byCategory(spend), [spend])
  const total = useMemo(() => sumTotals(spend), [spend])

  const here = { label: periodShortLabel(selected), to: isAllTime || selected !== currentMonth ? `/reports?m=${selected}` : '/reports' }
  const down = extendTrail(trail, here)
  const monthQuery = `?month=${selected}`

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-5 pb-6">
      <h1 className="font-display text-[30px] leading-none font-bold tracking-tight text-ink">Insights</h1>

      <Card className="p-[22px]">
        <div className="text-sm text-muted">{isAllTime ? 'All time' : monthLabel(selected)}</div>
        <div className="mt-2 font-display text-[44px] leading-none font-semibold tracking-tighter text-ink">
          {money(total)}
        </div>
        <Link
          to={`/reports/category/${ALL_CATEGORIES}${monthQuery}`}
          state={down}
          className="mt-1 flex h-11 items-center gap-1 text-[13px] text-muted active:opacity-70"
        >
          {plural(spend.length, 'receipt')}
          <Icon name="chevron-right" size={14} />
        </Link>

        <div className="mt-2">
          <MonthBars months={bars} selected={isAllTime ? null : selected} onSelect={select} formatValue={money} />
        </div>

        <div className="mt-4 flex gap-2">
          <Chip active={isAllTime} onClick={() => select(isAllTime ? currentMonth : ALL_TIME)}>All time</Chip>
          <Link
            to="/reports/monthly"
            state={down}
            className="flex h-11 items-center gap-1 rounded-full bg-card-2 px-4 text-sm font-medium text-ink active:opacity-80"
          >
            Every month
            <Icon name="chevron-right" size={14} />
          </Link>
        </div>
      </Card>

      <Card className="px-[18px] pt-2 pb-2">
        <CardTitle>By category</CardTitle>
        {categories.length === 0 ? (
          <EmptyState>{loading ? 'Loading…' : isAllTime ? 'No receipts yet.' : 'No spending this month.'}</EmptyState>
        ) : (
          <>
            {/* The whole period as one bar, split by category. Decorative:
                the rows below carry the same numbers as text. */}
            <div aria-hidden="true" className="mt-1 mb-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
              {categories.map((c) => (
                <span
                  key={c.name}
                  className="h-full min-w-1 rounded-sm"
                  style={{ width: `${c.share}%`, background: categoryStyle(c.name).color }}
                />
              ))}
            </div>
            {categories.map((c) => (
              <Link
                key={c.name}
                to={`/reports/category/${encodeURIComponent(c.name)}${monthQuery}`}
                state={down}
                className="flex min-h-[64px] items-center gap-3 active:opacity-70"
              >
                <CategoryIcon category={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{c.name}</span>
                  <span className="block text-[13px] text-muted">
                    {plural(c.count, 'receipt')} · {Math.round(c.share)}%
                  </span>
                </span>
                <span className="shrink-0 font-display text-base font-semibold text-ink">{money(c.total)}</span>
                <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
              </Link>
            ))}
          </>
        )}
      </Card>

      {spend.length > 0 && (
        <Card className="px-[18px]">
          <NavRow
            to={`/reports/category/${ALL_CATEGORIES}${monthQuery}`}
            state={down}
            icon="cart"
            label="Top merchants"
            hint="Where the money went, by shop"
          />
        </Card>
      )}

      {moved.length > 0 && (
        // Dashed, not filled: these are records, deliberately outside every
        // total above (a transfer or a card payment isn't spending).
        <div className="rounded-3xl border border-dashed border-line px-[18px] py-2">
          <div className="pt-2 text-[13px] text-muted">Moved, not spent — left out of the totals</div>
          {moved.map((c) => (
            <Link
              key={c.name}
              to={`/reports/category/${encodeURIComponent(c.name)}${monthQuery}`}
              state={down}
              className="flex min-h-14 items-center gap-3 active:opacity-70"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{c.name}</span>
                <span className="block text-[13px] text-muted">{plural(c.count, 'receipt')}</span>
              </span>
              <span className="shrink-0 font-display text-base font-semibold text-ink">{money(c.total)}</span>
              <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
