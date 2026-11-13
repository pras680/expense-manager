import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { formatMoney, plural } from '../lib/format'
import {
  ALL_CATEGORIES, ALL_TIME, RECEIPT_SORTS, inPeriod, monthTotals, readSort, receiptCategory, recentMonthKeys,
  sameMerchant, sortReceipts, sumTotals
} from '../lib/insights'
import { isMonthKey, periodLabel, periodShortLabel, readPeriod } from '../lib/period'
import { extendTrail, useTrail } from '../lib/trail'
import { PageHeader } from '../components/PageHeader'
import { MonthBars } from '../components/MonthBars'
import { ReceiptCard } from '../components/ReceiptCard'
import { Card, Chip, EmptyState, SortSelect } from '../components/ui'

// Third level of the drill-down: one merchant's receipts in a period. With
// ?category= it's that merchant within one category (how it was reached from
// a category page); without, everything bought there.

export function MerchantPage() {
  const { merchant: rawMerchant } = useParams<{ merchant: string }>()
  const merchant = decodeURIComponent(rawMerchant ?? '')
  const [params, setParams] = useSearchParams()
  const period = readPeriod(params.get('month'))
  const category = params.get('category')
  const sort = readSort(params.get('sort'), RECEIPT_SORTS)
  const { receipts } = useReceipts()
  const { defaultCurrency } = useSettings()

  const parentHref = `/reports/category/${encodeURIComponent(category ?? ALL_CATEGORIES)}?month=${period}`
  const trail = useTrail([
    { label: periodShortLabel(period), to: isMonthKey(period) ? `/reports?m=${period}` : `/reports?m=${ALL_TIME}` },
    { label: category ?? 'Top merchants', to: parentHref }
  ])
  const money = (amount: number) => formatMoney(amount, defaultCurrency)

  const atMerchant = useMemo(
    () => receipts.filter((r) => sameMerchant(r, merchant) && (!category || receiptCategory(r) === category)),
    [receipts, merchant, category]
  )
  const rows = useMemo(() => sortReceipts(inPeriod(atMerchant, period), sort), [atMerchant, period, sort])
  const total = useMemo(() => sumTotals(rows), [rows])

  const bars = useMemo(() => {
    const byKey = new Map<string, number>()
    for (const key of new Set(monthTotals(atMerchant).map((t) => t.key))) {
      byKey.set(key, sumTotals(inPeriod(atMerchant, key)))
    }
    const anchor = isMonthKey(period) && !recentMonthKeys(6).includes(period)
      ? new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1)
      : new Date()
    return recentMonthKeys(6, anchor).map((key) => ({ key, total: byKey.get(key) ?? 0 }))
  }, [atMerchant, period])

  // Sideways moves (period, sort): replace the history entry and keep the
  // trail that was handed to this page.
  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) next.set(key, value)
    setParams(next, { replace: true, state: trail.fromHistory ? { trail: trail.crumbs } : null })
  }
  const selectPeriod = (next: string) => update({ month: next })

  const down = extendTrail(trail, {
    label: merchant,
    to: `/reports/merchant/${encodeURIComponent(merchant)}?month=${period}${category ? `&category=${encodeURIComponent(category)}` : ''}`
  })

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6">
      <PageHeader backTo={parentHref} trail={trail} />

      <Card className="p-[22px]">
        <h1 className="truncate font-display text-xl font-semibold tracking-tight text-ink">{merchant}</h1>
        <div className="mt-4 font-display text-[44px] leading-none font-semibold tracking-tighter text-ink">{money(total)}</div>
        <p className="mt-2 text-[13px] text-muted">
          {periodLabel(period)} · {plural(rows.length, 'receipt')}
          {rows.length > 1 ? ` · ${money(total / rows.length)} a visit` : ''}
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

      {rows.length === 0 ? (
        <EmptyState>No receipts from {merchant} in this period.</EmptyState>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="px-1 font-display text-lg font-semibold tracking-tight text-ink">Receipts</h2>
            <SortSelect value={sort} onChange={(value) => update({ sort: value })} options={RECEIPT_SORTS} />
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map((r) => <ReceiptCard key={r.id} receipt={r} linkState={down} />)}
          </div>
        </>
      )}
    </div>
  )
}
