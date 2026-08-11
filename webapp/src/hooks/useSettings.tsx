import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getUserSettings, updateUserSettings, listHouseholdMembers, type HouseholdMember } from '../lib/supabaseClient'
import { DEFAULT_CURRENCY } from '../lib/categories'
import { useAuth } from './useAuth'

interface SettingsContextValue {
  defaultCurrency: string
  displayName: string | null
  householdId: string | null
  members: HouseholdMember[]
  loading: boolean
  error: string | null
  setDefaultCurrency: (currency: string) => Promise<void>
  /** Maps a receipt's user_id to a name for the owner badge. */
  nameFor: (userId: string | null) => string | null
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.userId ?? null

  const [defaultCurrency, setDefaultCurrencyState] = useState(DEFAULT_CURRENCY)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([getUserSettings(userId), listHouseholdMembers()])
      .then(([settings, householdMembers]) => {
        if (cancelled) return
        if (settings) {
          setDefaultCurrencyState(settings.defaultCurrency)
          setDisplayName(settings.displayName)
          setHouseholdId(settings.activeHouseholdId)
        }
        setMembers(householdMembers)
      })
      .catch((err) => {
        // Surfaced rather than swallowed: silently falling back to SGD would
        // mis-convert every amount on screen with no indication anything is wrong.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [userId])

  const setDefaultCurrency = useCallback(async (currency: string) => {
    if (!userId) return
    await updateUserSettings(userId, { defaultCurrency: currency })
    setDefaultCurrencyState(currency)
  }, [userId])

  const nameFor = useCallback((id: string | null) => {
    if (!id) return null
    if (id === userId) return 'You'
    const member = members.find((m) => m.userId === id)
    return member?.displayName ?? 'Household'
  }, [members, userId])

  return (
    <SettingsContext.Provider
      value={{ defaultCurrency, displayName, householdId, members, loading, error, setDefaultCurrency, nameFor }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
