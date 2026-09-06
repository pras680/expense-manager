import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { COMMON_CURRENCIES } from '../lib/categories'
import {
  addHouseholdMember,
  removeHouseholdMember,
  getGmailConnection,
  scanGmailNow,
  type AddedMember,
  type GmailConnection
} from '../lib/supabaseClient'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { HouseholdMember } from '../lib/supabaseClient'

function formatWhen(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'never'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** One consistent card chrome for every section, so the page reads as one
    system rather than five separately-styled blocks bolted together. */
function SectionCard({
  icon,
  title,
  children
}: {
  icon: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        <span className="text-base leading-none" aria-hidden="true">{icon}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Small initial badge used for both "you" at the top and each household
    member below — the same identity glyph in both places, not a one-off. */
function InitialBadge({ label }: { label: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800 dark:bg-accent-900/50 dark:text-accent-300"
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

export function SettingsPage() {
  const { defaultCurrency, setDefaultCurrency, loading, error, members, refreshMembers } = useSettings()
  const { session, signOut } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [added, setAdded] = useState<AddedMember | null>(null)
  const [removing, setRemoving] = useState<HouseholdMember | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // Loading null (not undefined) distinguishes "haven't checked yet" from
  // "checked, and there's no connection" — the whole point of this section
  // is to stop the page claiming ignorance about a status it actually knows.
  const [gmailConnection, setGmailConnection] = useState<GmailConnection | null>(null)
  const [gmailLoading, setGmailLoading] = useState(true)
  const [gmailScanning, setGmailScanning] = useState(false)
  const [gmailScanMessage, setGmailScanMessage] = useState<string | null>(null)
  const [gmailError, setGmailError] = useState<string | null>(null)

  const refreshGmail = useCallback(async () => {
    setGmailLoading(true)
    try {
      setGmailConnection(await getGmailConnection())
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : String(err))
    } finally {
      setGmailLoading(false)
    }
  }, [])

  useEffect(() => { refreshGmail() }, [refreshGmail])

  async function handleGmailScanNow() {
    setGmailScanning(true)
    setGmailError(null)
    setGmailScanMessage(null)
    try {
      await scanGmailNow()
      setGmailScanMessage('Scan complete — check the list for anything new.')
      await refreshGmail()
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : String(err))
    } finally {
      setGmailScanning(false)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    setAddBusy(true)
    setAddError(null)
    setAdded(null)
    try {
      const result = await addHouseholdMember(newEmail.trim(), newName.trim())
      setAdded(result)
      setNewEmail('')
      setNewName('')
      await refreshMembers()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddBusy(false)
    }
  }

  async function handleRemoveMember() {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await removeHouseholdMember(removing.userId)
      setRemoving(null)
      await refreshMembers()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveBusy(false)
    }
  }

  async function handleChange(currency: string) {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await setDefaultCurrency(currency)
      setSaved(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Settings</h1>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Couldn't load your settings: {error}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {/* Identity + sign out lead the page — the one action every visit to
            Settings might plausibly be for, not something to hunt for at the
            bottom of a long scroll past currency and household forms. */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-3">
            <InitialBadge label={session?.email ?? '?'} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {session?.email ?? 'Signed in'}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Signed in to this household</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-4 w-full rounded-lg border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        </section>

        <SectionCard icon="💱" title="Default currency">
          <select
            value={defaultCurrency}
            disabled={loading || saving}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Yours alone — everyone in the household can pick their own. Receipts imported from
            your SMS alerts are converted into this currency.
          </p>
          {saved && <p className="mt-2 text-xs font-medium text-accent-700 dark:text-accent-400">Saved.</p>}
          {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
        </SectionCard>

        <SectionCard icon="💬" title="SMS import">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Forward bank alerts from your phone so they become receipts automatically.
          </p>
          <Link
            to="/settings/sms"
            className="mt-3 inline-block rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
          >
            Manage SMS tokens →
          </Link>
        </SectionCard>

        <SectionCard icon="🏷️" title="Categories">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Add categories specific to your household, on top of the built-in ones.
          </p>
          <Link
            to="/settings/categories"
            className="mt-3 inline-block rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
          >
            Manage categories →
          </Link>
        </SectionCard>

        <SectionCard icon="📧" title="Gmail import">
          {gmailLoading ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Loading…</p>
          ) : gmailConnection ? (
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                Connected as {gmailConnection.email}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                Last scan: {formatWhen(gmailConnection.lastScanAt)}
              </p>

              {gmailConnection.lastError && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {gmailConnection.lastError}
                </div>
              )}
              {gmailScanMessage && (
                <div className="mt-2 rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-800 dark:bg-accent-950 dark:text-accent-300">
                  {gmailScanMessage}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleGmailScanNow}
                  disabled={gmailScanning}
                  className="rounded-lg bg-accent-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {gmailScanning ? 'Scanning…' : 'Scan now'}
                </button>
                <Link
                  to="/settings/gmail"
                  className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  Manage
                </Link>
                <Link
                  to="/settings/gmail/log"
                  className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  Scan log
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Not connected. Import receipts from emailed bills and payment alerts automatically.
              </p>
              <Link
                to="/settings/gmail"
                className="mt-3 inline-block rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
              >
                Connect Gmail →
              </Link>
            </>
          )}

          {gmailError && <p className="mt-2 text-xs text-red-600">{gmailError}</p>}
        </SectionCard>

        <SectionCard icon="👪" title="Household">
          {members.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {loading ? 'Loading…' : 'No household members found.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950/40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <InitialBadge label={m.displayName ?? '?'} />
                    <span className="truncate text-neutral-800 dark:text-neutral-100">
                      {m.displayName ?? 'Member'}
                      {m.userId === session?.userId && (
                        <span className="ml-1 text-xs text-neutral-400">(you)</span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-xs capitalize text-neutral-500 dark:text-neutral-400">{m.role}</span>
                    {m.userId !== session?.userId && (
                      <button onClick={() => setRemoving(m)} className="text-xs font-medium text-red-600">
                        Remove
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Household receipts are shared: everyone can see and edit them. Receipts marked
            Private stay visible only to whoever added them.
          </p>

          {/* Shown once. The server never stores a readable copy, so if this is
              lost the password has to be reset from the Supabase dashboard. */}
          {added && (
            <div className="mt-3 rounded-xl border border-accent-300 bg-accent-50 p-3 dark:border-accent-800 dark:bg-accent-950/40">
              <p className="text-sm font-semibold text-accent-900 dark:text-accent-200">
                {added.displayName} can now sign in
              </p>
              {added.password ? (
                <>
                  <p className="mt-1 text-xs text-accent-900 dark:text-accent-300">
                    Send them these details — the password can't be shown again.
                  </p>
                  <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs dark:bg-neutral-900">
                    {added.email}<br />{added.password}
                  </code>
                </>
              ) : (
                <p className="mt-1 text-xs text-accent-900 dark:text-accent-300">
                  They already had an account, so their existing password still works.
                </p>
              )}
              <button
                onClick={() => setAdded(null)}
                className="mt-2 rounded-lg bg-accent-700 px-3 py-1.5 text-sm font-medium text-white"
              >
                Done
              </button>
            </div>
          )}

          <form onSubmit={handleAddMember} className="mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Add someone</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="their@email.com"
              required
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (optional)"
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="submit"
              disabled={addBusy}
              className="rounded-lg bg-accent-700 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {addBusy ? 'Adding…' : 'Add to household'}
            </button>
            {addError && <p className="text-xs text-red-600">{addError}</p>}
          </form>
        </SectionCard>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.displayName ?? 'this member'}?`}
          message="They lose access to household receipts. Their own receipts and their account are kept, so you can add them back later."
          confirmLabel="Remove"
          busy={removeBusy}
          onConfirm={handleRemoveMember}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
