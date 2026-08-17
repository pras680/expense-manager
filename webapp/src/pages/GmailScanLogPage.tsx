import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { getGmailScanLog, clearGmailScanLog, type GmailScanLogEntry } from '../lib/supabaseClient'

function formatWhen(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function GmailScanLogPage() {
  const [entries, setEntries] = useState<GmailScanLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries(await getGmailScanLog())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleClear() {
    setClearing(true)
    try {
      await clearGmailScanLog()
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
        title="Gmail scan log"
        backTo="/settings/gmail"
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
        Emails the scanner found and read, but decided weren't a receipt — with why.
        Ordinary non-receipt mail isn't listed here at all; only the borderline cases.
      </p>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-neutral-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Nothing's been rejected recently. If an email you expected to see as a
          receipt is missing entirely, the scanner's search may never have found
          it — try again after the next scan, or check its subject line for
          words like "receipt", "invoice", or "order confirmation".
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {e.subject || '(no subject)'}
              </p>
              {e.sender && (
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{e.sender}</p>
              )}
              <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-300">{e.reason}</p>
              <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                {formatWhen(e.emailDate) ? `Email: ${formatWhen(e.emailDate)} · ` : ''}
                Scanned {formatWhen(e.scannedAt)}
                {/* MAX_PARSE_ATTEMPTS in scan-gmail/index.ts — keep in sync. */}
                {e.retryCount >= 3
                  ? ' · Won’t retry again'
                  : e.retryCount > 1 ? ` · Tried ${e.retryCount}×` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="Clear scan log?"
          message="Removes this history. It fills back in as the scanner runs — nothing about your receipts is affected."
          confirmLabel="Clear"
          busy={clearing}
          onConfirm={handleClear}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </div>
  )
}
