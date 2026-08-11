import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  type Session,
  signInWithPassword,
  getStoredSession,
  refreshSessionIfNeeded,
  clearSession,
  signOutEverywhere
} from '../lib/auth'
import { configureAuth } from '../lib/supabaseClient'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  /** Set when a session ended unexpectedly, so the sign-in screen can explain why. */
  expiredMessage: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)

  // The token provider is called on every outbound request, so it must read the
  // latest session without re-registering (and thus without being a dependency
  // of any effect). A ref keeps it stable while staying current.
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const endSession = useCallback((message: string | null) => {
    clearSession()
    sessionRef.current = null
    setSession(null)
    if (message) setExpiredMessage(message)
  }, [])

  // Registered once. supabaseClient calls this before each request and refreshes
  // if the token is near expiry, which closes the window where a request could
  // otherwise go out with a token that died since the last 5-minute tick.
  useEffect(() => {
    configureAuth(
      async () => {
        const current = sessionRef.current
        if (!current) return null
        try {
          const fresh = await refreshSessionIfNeeded(current)
          if (fresh !== current) {
            sessionRef.current = fresh
            setSession(fresh)
          }
          return fresh.accessToken
        } catch {
          endSession('Your session expired. Please sign in again.')
          return null
        }
      },
      () => endSession('Your session expired. Please sign in again.')
    )
    return () => configureAuth(null, null)
  }, [endSession])

  // Restore a stored session on boot.
  useEffect(() => {
    const stored = getStoredSession()
    if (!stored) {
      setLoading(false)
      return
    }
    refreshSessionIfNeeded(stored)
      .then((fresh) => {
        sessionRef.current = fresh
        setSession(fresh)
      })
      .catch(() => {
        // Silent here on purpose: an expired token from a previous visit is
        // ordinary, not an error worth alarming the user about.
        clearSession()
        sessionRef.current = null
      })
      .finally(() => setLoading(false))
  }, [])

  // Belt-and-braces refresh for a PWA left open for hours. The per-request
  // provider above is the real guarantee; this just keeps the token warm.
  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      const current = sessionRef.current
      if (!current) return
      refreshSessionIfNeeded(current)
        .then((fresh) => {
          if (fresh !== current) {
            sessionRef.current = fresh
            setSession(fresh)
          }
        })
        .catch(() => endSession('Your session expired. Please sign in again.'))
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [session, endSession])

  const signIn = useCallback(async (email: string, password: string) => {
    const fresh = await signInWithPassword(email, password)
    setExpiredMessage(null)
    sessionRef.current = fresh
    setSession(fresh)
  }, [])

  const signOut = useCallback(async () => {
    const current = sessionRef.current
    sessionRef.current = null
    setSession(null)
    setExpiredMessage(null)
    await signOutEverywhere(current)
  }, [])

  return (
    <AuthContext.Provider value={{ session, loading, expiredMessage, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
