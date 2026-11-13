import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { isExpenseReceipt } from '../lib/receiptShape'
import { isExpenseCategory } from '../lib/categories'
import { dayLabel, formatMoney, plural } from '../lib/format'
import {
  ALL_CATEGORIES, ALL_TIME, DAY_SORTS, MERCHANT_SORTS, byDay, byMerchant, inPeriod, monthTotals, readSort,
  receiptCategory, recentMonthKeys, sortSlices, sumTotals
} from '../lib/insights'
import { isMonthKey, periodLabel, periodShortLabel, readPeriod } from '../lib/period'
import { extendTrail, useTrail } from '../lib/trail'
import { PageHeader } from '../components/PageHeader'
import { MonthBars } from '../components/MonthBars'
import { CategoryIcon } from '../components/CategoryIcon'
import { ReceiptCard } from '../components/ReceiptCard'
import { Card, CardTitle, Chip, EmptyState, SortSelect } from '../components/ui'
import { Icon } from '../components/Icon'

// Second level of the Insights drill-down: one category in one period, split
// by merchant or laid out day by day. The path segment "All" means every
// spending category at once — the "Top merchants" view.
//
// Period, view and sort all live in the URL (?month=&view=&sort=), so opening
// a receipt and coming back restores exactly the list that was left.

type View = 'merchants' | 'date'

export function CategoryPage() {
  const { category: rawCategory } = useParams<{ category: string }>()
  const category = decodeURIComponent(rawCategory ?? '')
  const isAll = category === ALL_CATEGORIES
  const [params, setParams] = useSearchParams()
  const period = readPeriod(params.get('month'))
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()
  const view: View = params.get('view') === 'date' ? 'date' : 'merchants'
  // Each view has its own sort options; a value left over from the other
  // view just falls back to this one's default.
  const merchantSort = readSort(params.get('sort'), MERCHANT_SORTS)
  const daySort = readSort(params.get('sort'), DAY_SORTS)

  const insightsHref = isMonthKey(period) ? `/reports?m=${period}` : `/reports?m=${ALL_TIME}`
  const trail = useTrail([{ label: periodShortLabel(period), to: insightsHref }])
  const money = (amount: number) => formatMoney(amount, defaultCurrency)

  // Every receipt in this category, across all time: the month chart needs
  // the other months too, not just the selected one.
  const inCategory = useMemo(
    () => receipts.filter((r) => (isAll ? isExpenseReceipt(r) : receiptCategory(r) === category)),
    [receipts, category, isAll]
  )
  const rows = useMemo(() => inPeriod(inCategory, period), [inCategory, period])
  const total = useMemo(() => sumTotals(rows), [rows])
  const merchants = useMemo(() => sortSlices(byMerchant(rows), merchantSort), [rows, merchantSort])
  const days = useMemo(() => byDay(rows, daySort), [rows, daySort])

  // Share of the period's spend — only meaningful for a spending category.
  const share = useMemo(() => {
    if (isAll || !isExpenseCategory(category)) return null
    const periodSpend = sumTotals(inPeriod(receipts, period).filter(isExpenseReceipt))
    return periodSpend > 0 ? Math.round((total / periodSpend) * 100) : null
  }, [receipts, period, total, category, isAll])

  const bars = useMemo(() => {
    // monthTotals only sums spending categories; a transfer category's chart
    // needs its own receipts summed regardless.
    const byKey = new Map<string, number>()
    for (const key of new Set(monthTotals(inCategory).map((t) => t.key))) {
      byKey.set(key, sumTotals(inPeriod(inCategory, key)))
    }
    const anchor = isMonthKey(period) && !recentMonthKeys(6).includes(period)
      ? new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1)
      : new Date()
    return recentMonthKeys(6, anchor).map((key) => ({ key, total: byKey.get(key) ?? 0 }))
  }, [inCategory, period])

  // Sideways moves (period, view, sort): replace the history entry and keep
  // the trail that was handed to this page, so back still leaves in one step.
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true, state: trail.fromHistory ? { trail: trail.crumbs } : null })
  }
  const selectPeriod = (next: string) => update({ month: next })
  // Switching view drops the sort: the two views don't share sort options.
  const selectView = (next: View) => update({ view: next === 'merchants' ? null : next, sort: null })

  const here = {
    label: isAll ? 'Top merchants' : category,
    // Includes the current view and sort, so a deep-linked receipt's crumb
    // leads back to the same list.
    to: `/reports/category/${encodeURIComponent(category)}?${new URLSearchParams({ ...Object.fromEntries(params), month: period })}`
  }
  const down = extendTrail(trail, here)
  const spendNote = !isAll && !isExpenseCategory(category) ? ' · not counted as spend' : ''

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6">
      <PageHeader backTo={insightsHref} trail={trail} />

      <Card className="p-[22px]">
        <div className="flex items-center gap-3">
          {!isAll && <CategoryIcon category={category} size={36} />}
          <h1 className="min-w-0 truncate font-display text-xl font-semibold tracking-tight text-ink">
            {isAll ? 'All spending' : category}
          </h1>
        </div>
        <div className="mt-4 font-display text-[44px] leading-none font-semibold tracking-tighter text-ink">{money(total)}</div>
        <p className="mt-2 text-[13px] text-muted">
          {periodLabel(period)} · {plural(rows.length, 'receipt')}
          {share != null ? ` · ${share}% of spend` : ''}
          {spendNote}
        </p>

        <div className="mt-4">
          <MonthBars
            months={bars}
            selected={isMonthKey(period) ? period : null}
            onSelect={selectPeriod}
            formatValue={money}
            height={72}
          />
        </div>
        <div className="mt-4 flex">
          <Chip active={period === ALL_TIME} onClick={() => selectPeriod(period === ALL_TIME ? bars[bars.length - 1].key : ALL_TIME)}>
            All time
          </Chip>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <Chip active={view === 'merchants'} onClick={() => selectView('merchants')}>By merchant</Chip>
        <Chip active={view === 'date'} onClick={() => selectView('date')}>By date</Chip>
        {view === 'merchants' ? (
          <SortSelect value={merchantSort} onChange={(sort) => update({ sort })} options={MERCHANT_SORTS} />
        ) : (
          <SortSelect value={daySort} onChange={(sort) => update({ sort })} options={DAY_SORTS} />
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState>Nothing here in {period === ALL_TIME ? 'your receipts yet' : periodLabel(period)}.</EmptyState>
      ) : view === 'merchants' ? (
        <Card className="px-[18px] pt-2 pb-2">
          <CardTitle>{isAll ? 'Top merchants' : 'Merchants'}</CardTitle>
          {merchants.map((m) => (
            <Link
              key={m.name}
              to={`/reports/merchant/${encodeURIComponent(m.name)}?month=${period}${isAll ? '' : `&category=${encodeURIComponent(category)}`}`}
              state={down}
              className="flex min-h-[64px] items-center gap-3 active:opacity-70"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{m.name}</span>
                <span className="mt-1.5 block h-1 rounded-full bg-card-2">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${m.share}%` }} />
                </span>
                <span className="mt-1 block text-[13px] text-muted">{plural(m.count, 'receipt')}</span>
              </span>
              <span className="shrink-0 font-display text-base font-semibold text-ink">{money(m.total)}</span>
              <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
            </Link>
          ))}
        </Card>
      ) : (
        days.map((day) => (
          <section key={day.key ?? 'no-date'} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between px-1 pt-1 text-[13px] text-muted">
              <h2 className="font-medium">{day.key ? dayLabel(day.key) : 'No date'}</h2>
              <span>{formatMoney(day.total, defaultCurrency, { cents: true })}</span>
            </div>
            {day.rows.map((r) => <ReceiptCard key={r.id} receipt={r} showDate={false} linkState={down} />)}
          </section>
        ))
      )}
    </div>
  )
}
