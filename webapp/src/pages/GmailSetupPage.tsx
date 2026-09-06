import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import {
  getGmailConnection,
  startGmailConnect,
  completeGmailConnect,
  disconnectGmail,
  scanGmailNow,
  type GmailConnection
} from '../lib/supabaseClient'
import { ConfirmDialog } from '../components/ConfirmDialog'

function formatWhen(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'never'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function GmailSetupPage() {
  const [params, setParams] = useSearchParams()
  const [connection, setConnection] = useState<GmailConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setConnection(await getGmailConnection())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Google sends the browser back here with ?code=… (or ?error=…). Exchange it
  // immediately, then strip it from the URL — an authorization code is
  // single-use, so leaving it in history invites a confusing "already used"
  // failure on refresh.
  useEffect(() => {
    const code = params.get('code')
    const googleError = params.get('error')

    if (googleError) {
      setError(googleError === 'access_denied'
        ? 'You declined access, so Gmail was not connected.'
        : `Google returned an error: ${googleError}`)
      setParams({}, { replace: true })
      return
    }
    if (!code) return

    setBusy(true)
    setParams({}, { replace: true })
    completeGmailConnect(code)
      .then(() => refresh())
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }, [params, setParams, refresh])

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      window.location.href = await startGmailConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function handleScanNow() {
    setScanning(true)
    setError(null)
    setScanMessage(null)
    try {
      await scanGmailNow()
      setScanMessage('Scan complete — check the list for anything new.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      await disconnectGmail()
      setDisconnecting(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader title="Gmail import" backTo="/settings" />
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Connect your inbox and receipts from emailed bills and payment alerts are added
        automatically, twice a day. Read-only — nothing is ever sent or deleted. Use
        "Scan now" below for anything you want picked up sooner.
      </p>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-neutral-500">Loading…</p>
      ) : connection ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            Connected as {connection.email}
          </p>
          <dl className="mt-2 space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <div className="flex justify-between">
              <dt>Connected</dt><dd>{formatWhen(connection.connectedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Last scan</dt><dd>{formatWhen(connection.lastScanAt)}</dd>
            </div>
          </dl>

          {connection.lastError && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {connection.lastError}
            </div>
          )}

          {scanMessage && (
            <div className="mt-3 rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-800 dark:bg-accent-950 dark:text-accent-300">
              {scanMessage}
            </div>
          )}

          <button
            onClick={handleScanNow}
            disabled={scanning || busy}
            className="mt-3 w-full rounded-lg bg-accent-700 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>

          <div className="mt-2 flex gap-2">
            <button
              onClick={handleConnect}
              disabled={busy}
              className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 disabled:opacity-60 dark:bg-neutral-800 dark:text-neutral-100"
            >
              Reconnect
            </button>
            <button
              onClick={() => setDisconnecting(true)}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>

          <Link
            to="/settings/gmail/log"
            className="mt-3 block text-sm text-accent-700 dark:text-accent-400"
          >
            View scan log →
          </Link>
        </div>
      ) : (
        <div className="mt-4">
          <button
            onClick={handleConnect}
            disabled={busy}
            className="w-full rounded-lg bg-accent-700 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Connecting…' : 'Connect Gmail'}
          </button>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Each household member connects their own inbox, and receipts are filed under
            whoever's mailbox they came from.
          </p>
        </div>
      )}

      {disconnecting && (
        <ConfirmDialog
          title="Disconnect Gmail?"
          message="New emails stop being imported and the stored access is revoked at Google. Receipts already imported are kept."
          confirmLabel="Disconnect"
          busy={busy}
          onConfirm={handleDisconnect}
          onCancel={() => setDisconnecting(false)}
        />
      )}
    </div>
  )
}
