import { formatAgo, formatDuration, type ParserView, type QuotaMeter } from '../lib/parserQuota'

// "Can I parse a receipt right now?" — the parser's LLM quota as last
// reported by the provider (see useParserStatus / multiuser-20).

const STATE_COPY: Record<ParserView['state'], { title: string; dot: string; halo: string }> = {
  ready: { title: 'Reader ready', dot: 'bg-emerald-500', halo: 'bg-emerald-400' },
  low: { title: 'Running low', dot: 'bg-amber-500', halo: 'bg-amber-400' },
  limited: { title: 'Cooling down', dot: 'bg-red-500', halo: 'bg-red-400' },
  unknown: { title: 'Reader status', dot: 'bg-muted', halo: '' }
}

function Meter({ label, unit, meter }: { label: string; unit: string; meter: QuotaMeter }) {
  const pct = Math.max(0, Math.min(100, (meter.remaining / meter.limit) * 100))
  const barColor = pct <= 10 ? 'bg-red-500' : pct <= 30 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="min-w-0 flex-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-display text-xl leading-none font-semibold text-ink tabular-nums">
          {meter.remaining.toLocaleString()}
        </span>
        <span className="truncate text-xs text-muted tabular-nums">
          / {meter.limit.toLocaleString()} {unit}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card-2">
        <div className={`h-full transition-[width] duration-700 ease-out ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-muted tabular-nums">
        {meter.resetInMs != null ? `full again in ${formatDuration(meter.resetInMs)}` : 'full'}
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
      className="rounded-3xl bg-card p-[18px] motion-safe:animate-rise"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {animatedDot && (
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${copy.halo}`} />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${copy.dot}`} />
          </span>
          <span className="text-sm font-semibold text-ink">{copy.title}</span>
        </div>
        {view.updatedAt && (
          <span className="text-[11px] text-muted">checked {formatAgo(view.updatedAt, now)}</span>
        )}
      </div>

      {view.state === 'limited' && view.secondsUntilReady != null && (
        <p className="mt-2 text-sm text-ink">
          The provider asked us to wait — ready again in{' '}
          <span className="font-semibold text-ink tabular-nums">
            {formatDuration(view.secondsUntilReady * 1000)}
          </span>
          . Photos still upload; you can fill the details in by hand.
        </p>
      )}
      {view.state === 'low' && (
        <p className="mt-2 text-sm text-ink">
          Close to the limit — a parse may be refused until it refills.
        </p>
      )}
      {view.state === 'unknown' && (
        <p className="mt-2 text-sm text-muted">
          No reading yet — the next receipt parsed will fill this in.
        </p>
      )}

      {(view.requests || view.tokens) && (
        <div className="mt-3 flex gap-5">
          {view.requests && <Meter label="Requests · per day" unit="left" meter={view.requests} />}
          {view.tokens && <Meter label="Tokens · per minute" unit="left" meter={view.tokens} />}
        </div>
      )}
    </section>
  )
}
