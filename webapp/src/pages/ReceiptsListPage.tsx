import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useReceipts } from '../hooks/useReceipts'
import { useSettings } from '../hooks/useSettings'
import { ReceiptCard } from '../components/ReceiptCard'
import { StatTile } from '../components/StatTile'
import { receiptMatches, reportingTotal } from '../lib/receiptShape'

type FilterKey = 'all' | 'last30' | 'noDate'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'noDate', label: 'No Date' }
]

export function ReceiptsListPage() {
  const { receipts, loading, error, refresh } = useReceipts()
  const { defaultCurrency } = useSettings()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')

  const filtered = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    return receipts.filter((r) => {
      if (filter === 'last30') {
        if (!r.date) return false
        const t = new Date(r.date).getTime()
        if (Number.isNaN(t) || t < thirtyDaysAgo) return false
      } else if (filter === 'noDate') {
        if (r.date) return false
      }
      return receiptMatches(r, query)
    })
  }, [receipts, filter, query])

  const totalSpend = useMemo(
    () => filtered.reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0),
    [filtered]
  )
  const thisMonthSpend = useMemo(() => {
    const now = new Date()
    return receipts
      .filter((r) => {
        if (!r.date) return false
        const d = new Date(r.date)
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      })
      .reduce((sum, r) => sum + (reportingTotal(r) ?? 0), 0)
  }, [receipts])

  function formatMoney(amount: number) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: defaultCurrency }).format(amount)
    } catch {
      return `${defaultCurrency} ${amount.toFixed(2)}`
    }
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Receipts</h1>
        <button
          onClick={() => refresh()}
          className="text-sm text-teal-700 dark:text-teal-400"
          aria-label="Refresh"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <StatTile label="Total" value={formatMoney(totalSpend)} />
        <StatTile label="This Month" value={formatMoney(thisMonthSpend)} />
        <StatTile label="Count" value={String(filtered.length)} />
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search receipts…"
        className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
      />

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === f.key
                ? 'bg-teal-700 text-white'
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
            <Link to="/add" className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white">
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
