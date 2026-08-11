import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { COMMON_CURRENCIES } from '../lib/categories'

export function SettingsPage() {
  const { defaultCurrency, setDefaultCurrency, loading, error, members } = useSettings()
  const { session, signOut } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Settings</h1>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Couldn't load your settings: {error}
        </div>
      )}

      <div className="mt-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Default currency</span>
          <select
            value={defaultCurrency}
            disabled={loading || saving}
            onChange={(e) => handleChange(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Yours alone — everyone in the household can pick their own. Receipts imported from
          your SMS alerts are converted into this currency.
        </p>
        {saved && <p className="mt-2 text-xs text-teal-700 dark:text-teal-400">Saved.</p>}
        {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">SMS import</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Forward bank alerts from your phone so they become receipts automatically.
        </p>
        <Link
          to="/settings/sms"
          className="mt-2 inline-block rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
        >
          Manage SMS tokens →
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Household</h2>
        {members.length === 0 ? (
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {loading ? 'Loading…' : 'No household members found.'}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="text-neutral-800 dark:text-neutral-100">
                  {m.displayName ?? 'Member'}
                  {m.userId === session?.userId && (
                    <span className="ml-1 text-xs text-neutral-400">(you)</span>
                  )}
                </span>
                <span className="text-xs capitalize text-neutral-500 dark:text-neutral-400">{m.role}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Household receipts are shared: everyone can see and edit them. Receipts marked
          Private stay visible only to whoever added them.
        </p>
      </div>

      <div className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        {session?.email && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Signed in as {session.email}</p>
        )}
        <button
          onClick={signOut}
          className="mt-2 rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
