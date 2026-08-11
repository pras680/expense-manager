import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Receipt } from '../types/receipt'
import { listReceipts, AuthRequiredError } from '../lib/supabaseClient'

interface ReceiptsContextValue {
  receipts: Receipt[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ReceiptsContext = createContext<ReceiptsContextValue | null>(null)

export function ReceiptsProvider({ children }: { children: ReactNode }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listReceipts()
      rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      setReceipts(rows)
    } catch (err) {
      // An expired session is already being handled by AuthProvider, which is
      // tearing this tree down and showing the sign-in screen. Surfacing it here
      // too would flash a scary error banner on the way out.
      if (err instanceof AuthRequiredError) {
        setReceipts([])
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <ReceiptsContext.Provider value={{ receipts, loading, error, refresh }}>
      {children}
    </ReceiptsContext.Provider>
  )
}

export function useReceipts() {
  const ctx = useContext(ReceiptsContext)
  if (!ctx) throw new Error('useReceipts must be used within a ReceiptsProvider')
  return ctx
}
