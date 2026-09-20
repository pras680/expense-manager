import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  getSmsInboxLog,
  clearSmsInboxLog,
  retrySmsInboxEntry,
  retryAllSmsInboxEntries,
  type SmsInboxLogEntry
} from '../lib/supabaseClient'

function formatWhen(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Short first line only — the full SMS body is often several sentences of
// bank boilerplate, and this is just enough to recognize which message it is.
function summarize(body: string) {
  const trimmed = body.trim()
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed
}

export function SmsScanLogPage() {
  const [entries, setEntries] = useState<SmsInboxLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries(await getSmsInboxLog())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleRetry(id: string) {
    setRetryingId(id)
    setError(null)
    try {
      await retrySmsInboxEntry(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRetryingId(null)
    }
  }

  async function handleRetryAll() {
    setRetryingAll(true)
    setError(null)
    try {
      await retryAllSmsInboxEntries()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRetryingAll(false)
    }
  }

  async function handleClear() {
    setClearing(true)
    try {
      await clearSmsInboxLog()
      setConfirmingClear(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader
        title="SMS processing log"
        backTo="/settings/sms"
        action={
          entries.length > 0 ? (
            <button
              onClick={() => setConfirmingClear(true)}
              className="shrink-0 px-1 text-sm font-medium text-red-600"
            >
              Clear
            </button>
          ) : undefined
        }
      />
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Messages the importer received but didn't turn into a receipt — with why.
        Successfully imported messages aren't listed here; only the ones worth a
        second look, like a reversal that couldn't find its original charge.
      </p>

      {entries.length > 1 && (
        <button
          onClick={handleRetryAll}
          disabled={retryingAll}
          className="mt-3 w-full rounded-lg bg-accent-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {retryingAll ? 'Retrying all…' : `Retry all (${entries.length})`}
        </button>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-neutral-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Nothing's been skipped or failed recently.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  {summarize(e.body) || '(empty message)'}
                </p>
                <button
                  onClick={() => handleRetry(e.id)}
                  disabled={retryingId === e.id}
                  className="shrink-0 text-xs font-medium text-accent-700 disabled:opacity-60 dark:text-accent-400"
                >
                  {retryingId === e.id ? 'Retrying…' : 'Retry'}
                </button>
              </div>
              {e.sender && (
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{e.sender}</p>
              )}
              <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-300">
                {e.reason || (e.status === 'skipped' ? "Doesn't look like a transaction" : 'Failed')}
              </p>
              <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                Received {formatWhen(e.receivedAt)}
                {/* MAX_RETRIES in process-sms-inbox/index.ts — keep in sync. */}
                {e.status === 'failed' && e.retryCount >= 3
                  ? ' · Won’t retry again'
                  : e.status === 'failed' && e.retryCount > 1 ? ` · Tried ${e.retryCount}×` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="Clear SMS log?"
          message="Removes this history. It fills back in as new messages are processed — nothing about your receipts is affected."
          confirmLabel="Clear"
          busy={clearing}
          onConfirm={handleClear}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </div>
  )
}
