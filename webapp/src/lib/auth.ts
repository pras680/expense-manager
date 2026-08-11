import { env } from './env'

// Mirrors SupabaseService.swift's auth logic (signIn/refreshAuthSessionIfNeeded)
// almost exactly, same /auth/v1/token grant types — localStorage here plays
// the role iOS's Keychain-backed SupabaseCredentialStore plays there.

export interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number // ms since epoch
  userId: string
  email: string | null
}

const STORAGE_KEY = 'bill-skills-auth-session'
const EXPIRY_BUFFER_MS = 90_000 // matches iOS's isExpiredOrNearExpiry buffer

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user?: { id: string; email?: string | null }
}

function sessionFromResponse(resp: TokenResponse, fallbackRefreshToken?: string): Session {
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token ?? fallbackRefreshToken ?? '',
    expiresAt: Date.now() + resp.expires_in * 1000,
    userId: resp.user?.id ?? '',
    email: resp.user?.email ?? null
  }
}

async function requestToken(grantType: 'password' | 'refresh_token', body: Record<string, string>): Promise<TokenResponse> {
  const resp = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    let message = 'Sign in failed'
    try {
      const parsed = JSON.parse(errBody)
      message = parsed.error_description || parsed.msg || parsed.error || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return resp.json()
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const resp = await requestToken('password', { email: email.trim(), password })
  const session = sessionFromResponse(resp)
  saveSession(session)
  return session
}

export function isExpiredOrNearExpiry(session: Session): boolean {
  return Date.now() >= session.expiresAt - EXPIRY_BUFFER_MS
}

export async function refreshSessionIfNeeded(session: Session): Promise<Session> {
  if (!isExpiredOrNearExpiry(session)) return session
  const resp = await requestToken('refresh_token', { refresh_token: session.refreshToken })
  const refreshed = sessionFromResponse(resp, session.refreshToken)
  saveSession(refreshed)
  return refreshed
}

export function getStoredSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}
