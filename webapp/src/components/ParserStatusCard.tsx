import { formatAgo, formatDuration, type ParserView, type QuotaMeter } from '../lib/parserQuota'

// "Can I parse a receipt right now?" — the parser's LLM quota as last
// reported by the provider (see useParserStatus / multiuser-20).

const STATE_COPY: Record<ParserView['state'], { title: string; dot: string; halo: string }> = {
  ready: { title: 'Reader ready', dot: 'bg-emerald-500', halo: 'bg-emerald-400' },
  low: { title: 'Running low', dot: 'bg-amber-500', halo: 'bg-amber-400' },
  limited: { title: 'Cooling down', dot: 'bg-accent-700', halo: 'bg-accent-400' },
  unknown: { title: 'Reader status', dot: 'bg-neutral-400', halo: '' }
}

function Meter({ label, unit, meter }: { label: string; unit: string; meter: QuotaMeter }) {
  const pct = Math.max(0, Math.min(100, (meter.remaining / meter.limit) * 100))
  const barColor = pct <= 10 ? 'bg-accent-700' : pct <= 30 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-lg font-extrabold leading-none text-neutral-900 tabular-nums dark:text-neutral-50">
          {meter.remaining.toLocaleString()}
        </span>
        <span className="truncate text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
          / {meter.limit.toLocaleString()} {unit}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full transition-[width] duration-700 ease-out ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-neutral-500 tabular-nums dark:text-neutral-400">
        {meter.resetInMs != null ? `refills in ${formatDuration(meter.resetInMs)}` : 'full'}
      </div>
    </div>
  )
}

export function ParserStatusCard({ view, now }: { view: ParserView; now: number }) {
  const copy = STATE_COPY[view.state]
  const animatedDot = view.state === 'ready' || view.state === 'limited'

  return (
    <section
      aria-label="Receipt reader status"
      className="border border-neutral-200 bg-white p-4 motion-safe:animate-rise dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {animatedDot && (
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${copy.halo}`} />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${copy.dot}`} />
          </span>
          <span className="text-sm font-extrabold text-neutral-900 dark:text-neutral-50">{copy.title}</span>
        </div>
        {view.updatedAt && (
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">checked {formatAgo(view.updatedAt, now)}</span>
        )}
      </div>

      {view.state === 'limited' && view.secondsUntilReady != null && (
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          The provider asked us to wait — ready again in{' '}
          <span className="font-extrabold text-accent-700 tabular-nums dark:text-accent-400">
            {formatDuration(view.secondsUntilReady * 1000)}
          </span>
          . Photos still upload; you can fill the details in by hand.
        </p>
      )}
      {view.state === 'low' && (
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          Close to the limit — a parse may be refused until it refills.
        </p>
      )}
      {view.state === 'unknown' && (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          No reading yet — the next receipt parsed will fill this in.
        </p>
      )}

      {(view.requests || view.tokens) && (
        <div className="mt-3 flex gap-5">
          {view.requests && <Meter label="Requests today" unit="left" meter={view.requests} />}
          {view.tokens && <Meter label="Tokens this minute" unit="left" meter={view.tokens} />}
        </div>
      )}
    </section>
  )
}
