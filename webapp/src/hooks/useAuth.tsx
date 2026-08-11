import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  type Session,
  signInWithPassword,
  getStoredSession,
  refreshSessionIfNeeded,
  clearSession
} from '../lib/auth'
import { setAuthToken } from '../lib/supabaseClient'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = getStoredSession()
    if (!stored) {
      setAuthToken(null)
      setLoading(false)
      return
    }
    refreshSessionIfNeeded(stored)
      .then((fresh) => {
        setSession(fresh)
        setAuthToken(fresh.accessToken)
      })
      .catch(() => {
        clearSession()
        setAuthToken(null)
      })
      .finally(() => setLoading(false))
  }, [])

  // Proactively refresh well before expiry, since an installed PWA can stay
  // open for hours — same idea as iOS checking isExpiredOrNearExpiry before
  // every request, just on a timer instead of per-call here.
  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      refreshSessionIfNeeded(session)
        .then((fresh) => {
          setSession(fresh)
          setAuthToken(fresh.accessToken)
        })
        .catch(() => {
          clearSession()
          setAuthToken(null)
          setSession(null)
        })
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [session])

  const signIn = useCallback(async (email: string, password: string) => {
    const fresh = await signInWithPassword(email, password)
    setSession(fresh)
    setAuthToken(fresh.accessToken)
  }, [])

  const signOut = useCallback(() => {
    clearSession()
    setAuthToken(null)
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
