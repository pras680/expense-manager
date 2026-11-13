import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { COMMON_CURRENCIES } from '../lib/categories'
import { THEMES } from '../lib/theme'
import { getGmailConnection, type GmailConnection } from '../lib/supabaseClient'
import { plural } from '../lib/format'
import { Card, GroupLabel, NavRow, Notice, btn } from '../components/ui'
import { Icon } from '../components/Icon'

// The You tab: who's signed in, how the app looks, and a short list of doors
// to everything else. Each long form (household, SMS, Gmail, categories) lives
// on its own page, so this one stays a single screen of rows.

export function SettingsPage() {
  const { defaultCurrency, setDefaultCurrency, displayName, loading, error, members, customCategories } = useSettings()
  const { session, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  // undefined = still checking, null = checked and not connected. The row
  // should never claim "Not connected" about a status it hasn't loaded yet.
  const [gmail, setGmail] = useState<GmailConnection | null | undefined>(undefined)
  const loadGmail = useCallback(async () => {
    try {
      setGmail(await getGmailConnection())
    } catch {
      // The Gmail page itself reports the error; here the row just stays quiet.
      setGmail(null)
    }
  }, [])
  useEffect(() => { loadGmail() }, [loadGmail])

  async function handleCurrency(currency: string) {
    setSaving(true)
    setSaveError(null)
    try {
      await setDefaultCurrency(currency)
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

  const name = displayName || session?.email || 'Signed in'
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-5 pb-6">
      <h1 className="font-display text-[30px] leading-none font-bold tracking-tight text-ink">You</h1>

      {error && <Notice tone="error">Couldn't load your settings: {error}</Notice>}

      <Card className="flex items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent font-display text-2xl font-bold text-on-accent"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold text-ink">{name}</p>
          {displayName && session?.email && <p className="truncate text-sm text-muted">{session.email}</p>}
        </div>
      </Card>

      <GroupLabel>Theme</GroupLabel>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2.5">
        {THEMES.map((t) => {
          const on = t.id === theme
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme(t.id)}
              className={`rounded-3xl bg-card p-2 text-left ${on ? 'ring-2 ring-accent' : 'active:bg-card-2'}`}
            >
              {/* A thumbnail of the theme in its own colours (fixed, from
                  THEMES — it must not follow the theme currently applied). */}
              <span
                aria-hidden="true"
                className="flex h-[72px] flex-col justify-between rounded-2xl p-2.5"
                style={{ background: t.bg }}
              >
                <span className="flex h-6 items-center rounded-lg px-2" style={{ background: t.card }}>
                  <span className="h-1.5 w-8 rounded-full" style={{ background: t.ink }} />
                </span>
                <span className="h-5 w-12 rounded-full" style={{ background: t.accent }} />
              </span>
              <span className="mt-2 flex items-center justify-between px-1.5 pb-1 text-sm font-medium text-ink">
                {t.name}
                {on && <Icon name="check" size={16} />}
              </span>
            </button>
          )
        })}
      </div>
      <p className="px-1 text-[13px] text-muted">Saved on this device.</p>

      <GroupLabel>Money</GroupLabel>
      <Card className="px-[18px]">
        <label className="flex min-h-[60px] items-center gap-3 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card-2 text-ink">
            <Icon name="currency" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium text-ink">Default currency</span>
            <span className="block text-[13px] text-muted">Yours alone. Imports are converted into it.</span>
          </span>
          <select
            value={defaultCurrency}
            disabled={loading || saving}
            onChange={(e) => handleCurrency(e.target.value)}
            className="h-11 shrink-0 rounded-full bg-card-2 px-3 text-sm font-semibold text-ink outline-none"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        {saveError && <p className="pb-3 text-[13px] text-red-600 dark:text-red-400">{saveError}</p>}
        <div className="border-t border-line" />
        <NavRow
          to="/settings/categories"
          icon="tag"
          label="Categories"
          value={customCategories.length > 0 ? `${customCategories.length} of your own` : undefined}
        />
      </Card>

      <GroupLabel>Imports</GroupLabel>
      <Card className="px-[18px]">
        <NavRow to="/settings/sms" icon="message" label="SMS alerts" hint="Bank alerts forwarded from your phone" />
        <div className="border-t border-line" />
        <NavRow
          to="/settings/gmail"
          icon="mail"
          label="Gmail"
          hint={gmail ? gmail.email : 'Emailed bills and payment alerts'}
          value={gmail === undefined ? undefined : gmail ? 'Connected' : 'Not connected'}
        />
      </Card>

      <GroupLabel>Household</GroupLabel>
      <Card className="px-[18px]">
        <NavRow
          to="/settings/household"
          icon="users"
          label="Members"
          hint="Who shares these receipts"
          value={members.length > 0 ? plural(members.length, 'person').replace('persons', 'people') : undefined}
        />
      </Card>

      <button type="button" onClick={handleSignOut} disabled={signingOut} className={`${btn.danger} mt-2`}>
        <Icon name="logout" size={18} />
        {signingOut ? 'Signing out…' : 'Sign Out'}
      </button>
    </div>
  )
}
