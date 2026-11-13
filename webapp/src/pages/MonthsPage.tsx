import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { monthKey, monthLabel } from '../lib/months'
import { formatMoney, plural } from '../lib/format'
import { monthTotals } from '../lib/insights'
import { useTrail } from '../lib/trail'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState } from '../components/ui'
import { Icon } from '../components/Icon'

// Every month on record, newest first. This is what sits behind the "Typical
// month" figure on Home: the months the average is drawn from, each one a
// link into Insights for that month.

export function MonthsPage() {
  const { receipts, loading } = useReceipts()
  const { defaultCurrency } = useSettings()
  const trail = useTrail([{ label: 'Insights', to: '/reports' }])
  const money = (amount: number) => formatMoney(amount, defaultCurrency)

  const months = useMemo(() => monthTotals(receipts), [receipts])
  const currentKey = useMemo(() => monthKey(new Date()), [])
  // Same definition as Home's "Typical month": completed months only, since a
  // part-finished month would drag the average down.
  const completed = months.filter((m) => m.key < currentKey)
  const average = completed.length > 0 ? completed.reduce((sum, m) => sum + m.total, 0) / completed.length : null
  const max = Math.max(1, ...months.map((m) => m.total))

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6">
      <PageHeader backTo="/reports" trail={trail} />

      <Card className="p-[22px]">
        <h1 className="text-sm text-muted">Typical month</h1>
        <div className="mt-2 font-display text-[44px] leading-none font-semibold tracking-tighter text-ink">
          {average != null ? money(average) : '—'}
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {average != null
            ? `The average of ${plural(completed.length, 'completed month')}. This month is left out until it ends.`
            : 'An average appears once there is one full month of receipts.'}
        </p>
      </Card>

      {months.length === 0 ? (
        <EmptyState>{loading ? 'Loading…' : 'No receipts yet.'}</EmptyState>
      ) : (
        <Card className="px-[18px] py-2">
          {months.map((m) => (
            <Link
              key={m.key}
              to={`/reports?m=${m.key}`}
              className="flex min-h-[64px] items-center gap-3 active:opacity-70"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">
                  {monthLabel(m.key)}
                  {m.key === currentKey && <span className="ml-2 text-[13px] font-normal text-muted">so far</span>}
                </span>
                <span className="mt-1.5 block h-1 rounded-full bg-card-2">
                  <span
                    className={`block h-full rounded-full ${m.key === currentKey ? 'bg-accent' : 'bg-muted'}`}
                    style={{ width: `${(m.total / max) * 100}%` }}
                  />
                </span>
                <span className="mt-1 block text-[13px] text-muted">{plural(m.count, 'receipt')}</span>
              </span>
              <span className="shrink-0 font-display text-base font-semibold text-ink">{money(m.total)}</span>
              <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  )
}
