import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getAppSetting, setAppSetting } from '../lib/supabaseClient'
import { DEFAULT_CURRENCY } from '../lib/categories'

interface SettingsContextValue {
  defaultCurrency: string
  loading: boolean
  setDefaultCurrency: (currency: string) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [defaultCurrency, setDefaultCurrencyState] = useState(DEFAULT_CURRENCY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getAppSetting<string>('default_currency')
      .then((value) => {
        if (!cancelled && value) setDefaultCurrencyState(value)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setDefaultCurrency = useCallback(async (currency: string) => {
    await setAppSetting('default_currency', currency)
    setDefaultCurrencyState(currency)
  }, [])

  return (
    <SettingsContext.Provider value={{ defaultCurrency, loading, setDefaultCurrency }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
