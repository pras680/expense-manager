import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
      <Link to="/settings" className="text-sm text-teal-700 dark:text-teal-400">← Settings</Link>
      <h1 className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">SMS Import</h1>
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
            <p className="font-semibold">iPhone setup</p>
            <button
              onClick={() => downloadSmsShortcut(`${env.supabaseUrl}/functions/v1/receive-sms`, newToken)}
              className="mt-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white"
            >
              Download Shortcut
            </button>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Open the downloaded file → <strong>Add Shortcut</strong>. (First time only: if nothing happens, go to Settings → Shortcuts and enable "Allow Untrusted Shortcuts" — it only appears there right after a blocked attempt, and only for a few minutes — then try the download again.)</li>
              <li>Shortcuts app → Automation → new automation → <strong>Message</strong> → received from your bank.</li>
              <li>Add action <strong>Run Shortcut</strong> → choose <strong>SMS Import</strong> (the one you just added).</li>
              <li>Turn off "Ask Before Running".</li>
            </ol>
            <p className="mt-2 text-[11px] text-teal-800/80 dark:text-teal-300/80">
              Didn't work? Fall back to building it manually: <strong>Get Contents of URL</strong> →
              URL <code className="break-all">{env.supabaseUrl}/functions/v1/receive-sms</code> →
              Method <strong>POST</strong>, Request Body <strong>JSON</strong> with a <code>body</code> field set to
              the message text, headers <code>Content-Type: application/json</code> and{' '}
              <code>x-sms-ingest-secret</code> set to the token above.
            </p>
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
