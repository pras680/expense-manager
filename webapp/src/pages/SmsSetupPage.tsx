import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { env } from '../lib/env'
import {
  listSmsTokens,
  createSmsToken,
  revokeSmsToken,
  type SmsIngestToken
} from '../lib/supabaseClient'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { downloadSmsShortcut } from '../lib/smsShortcut'

function formatDate(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function SmsSetupPage() {
  const [tokens, setTokens] = useState<SmsIngestToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<SmsIngestToken | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setTokens(await listSmsTokens())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      setNewToken(await createSmsToken(label.trim() || null))
      setLabel('')
      setCopied(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke() {
    if (!revoking) return
    setBusy(true)
    try {
      await revokeSmsToken(revoking.id)
      setRevoking(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copyToken() {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const active = tokens.filter((t) => !t.revokedAt)
  const revoked = tokens.filter((t) => t.revokedAt)

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader title="SMS Import" backTo="/settings" />
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Your own token tells the server that a forwarded bank alert is <em>yours</em>, so the
        receipt lands under your name and uses your currency.
      </p>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Shown exactly once — the server only ever stores a hash of this. */}
      {newToken && (
        <div className="mt-4 rounded-xl border border-teal-300 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/40">
          <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
            Copy this now — it can't be shown again
          </p>
          <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
            {newToken}
          </code>
          <div className="mt-2 flex gap-2">
            <button
              onClick={copyToken}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setNewToken(null)}
              className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              Done
            </button>
          </div>

          <div className="mt-4 border-t border-teal-200 pt-3 text-xs text-teal-900 dark:border-teal-800 dark:text-teal-200">
            {/* Manual setup leads: recent iOS builds have started rejecting an
                unsigned .shortcut file outright ("Unsigned Shortcuts is Not
                Supported"), with no "Allow Untrusted Shortcuts" toggle offered
                at all — the download button below isn't reliable enough to be
                the primary instructions any more. Building it natively inside
                Shortcuts always works, since nothing is being imported. */}
            <p className="font-semibold">iPhone setup</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Shortcuts app → <strong>+</strong> for a new shortcut → add action <strong>Get Contents of URL</strong>.</li>
              <li>
                URL: <code className="break-all">{env.supabaseUrl}/functions/v1/receive-sms</code>
              </li>
              <li>
                <strong>Show More</strong> → Method <strong>POST</strong> → Headers: add{' '}
                <code>Content-Type</code> = <code>application/json</code>, and{' '}
                <code>x-sms-ingest-secret</code> = the token above.
              </li>
              <li>
                Request Body: <strong>JSON</strong>, one field named <code>body</code> — set its
                value to the <strong>Shortcut Input</strong> variable, not typed text (tap the
                value field and pick it from the variable list).
              </li>
              <li>Name it (e.g. "SMS Import") and save.</li>
              <li>Automation tab → <strong>+</strong> → <strong>Message</strong> → received from your bank → <strong>Run Shortcut</strong> → pick the one you just made.</li>
              <li>Turn off "Ask Before Running".</li>
            </ol>

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-medium text-teal-800/80 dark:text-teal-300/80">
                Prefer not to build it by hand? Try the downloadable version (works on some
                devices, not others)
              </summary>
              <button
                onClick={() => downloadSmsShortcut(`${env.supabaseUrl}/functions/v1/receive-sms`, newToken)}
                className="mt-2 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
              >
                Download Shortcut
              </button>
              <p className="mt-2 text-[11px] text-teal-800/80 dark:text-teal-300/80">
                Open the downloaded file → <strong>Add Shortcut</strong>. If iOS blocks it, check
                Settings → Shortcuts for "Allow Untrusted Shortcuts" (only appears for a few
                minutes right after a blocked attempt). If it says "Unsigned Shortcuts is Not
                Supported" instead, with no toggle offered, your iOS version has closed this
                path entirely — use the manual steps above instead.
              </p>
            </details>
          </div>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. My iPhone)"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={handleCreate}
          disabled={busy}
          className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? '…' : 'Generate'}
        </button>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Your tokens</h2>
      {loading ? (
        <p className="mt-2 text-sm text-neutral-500">Loading…</p>
      ) : active.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          No active tokens. Generate one to start importing SMS automatically.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {active.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  {t.label || 'Unlabelled'}
                </div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  added {formatDate(t.createdAt)} · last used {formatDate(t.lastUsedAt)}
                </div>
              </div>
              <button onClick={() => setRevoking(t)} className="shrink-0 text-sm font-medium text-red-600">
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {revoked.length > 0 && (
        <p className="mt-3 text-xs text-neutral-400">{revoked.length} revoked token(s) hidden.</p>
      )}

      {revoking && (
        <ConfirmDialog
          title="Revoke this token?"
          message={`Any Shortcut using "${revoking.label || 'this token'}" will stop importing SMS immediately. Existing receipts are unaffected.`}
          confirmLabel="Revoke"
          busy={busy}
          onConfirm={handleRevoke}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  )
}
