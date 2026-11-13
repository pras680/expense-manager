import { monthLabel } from '../lib/months'

export interface MonthBar {
  key: string
  total: number
}

interface MonthBarsProps {
  months: MonthBar[]
  selected: string | null
  onSelect: (key: string) => void
  formatValue: (amount: number) => string
  /** Bar area height in px. */
  height?: number
}

/**
 * A row of month columns that doubles as the month picker: tapping a bar
 * selects that month. The selected bar is the only one in the accent colour,
 * so the chart reads as "this one, against the others".
 */
export function MonthBars({ months, selected, onSelect, formatValue, height = 104 }: MonthBarsProps) {
  const max = Math.max(1, ...months.map((m) => m.total))
  return (
    <div className="flex items-end gap-2">
      {months.map((m, i) => {
        const on = m.key === selected
        const [year, month] = m.key.split('-').map(Number)
        const short = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short' })
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onSelect(m.key)}
            aria-pressed={on}
            aria-label={`${monthLabel(m.key)}, ${formatValue(m.total)}`}
            className="flex min-w-0 flex-1 flex-col items-stretch justify-end gap-2"
          >
            <span className="flex items-end" style={{ height }}>
              <span
                className={`block w-full origin-bottom rounded-lg motion-safe:animate-grow ${on ? 'bg-accent' : 'bg-muted/30'}`}
                style={{ height: Math.max(6, Math.round((m.total / max) * height)), animationDelay: `${i * 40}ms` }}
              />
            </span>
            <span className={`text-center text-xs font-medium ${on ? 'text-ink' : 'text-muted'}`}>{short}</span>
          </button>
        )
      })}
    </div>
  )
}
