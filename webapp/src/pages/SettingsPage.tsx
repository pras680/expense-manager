import { useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { COMMON_CURRENCIES } from '../lib/categories'

export function SettingsPage() {
  const { defaultCurrency, setDefaultCurrency, loading } = useSettings()
  const { session, signOut } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleChange(currency: string) {
    setSaving(true)
    setSaved(false)
    try {
      await setDefaultCurrency(currency)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Settings</h1>

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
          Shared across the whole household — this is also what the SMS auto-import cron job
          converts receipts into.
        </p>
        {saved && <p className="mt-2 text-xs text-teal-700 dark:text-teal-400">Saved.</p>}
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
