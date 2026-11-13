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

// How long a user-initiated sign-in/registration waits before giving up.
// Without this a stalled connection leaves the button on "Signing in…" forever.
const USER_ACTION_TIMEOUT_MS = 20_000

/**
 * fetch for requests the user is actively waiting on: bounded by a timeout,
 * and network failures/timeouts become a readable message instead of the
 * browser's raw "Failed to fetch" / "Load failed".
 *
 * Deliberately NOT used for background token refresh — any refresh failure
 * ends the session there, so a timeout would turn a slow network into a
 * forced sign-out.
 */
async function userActionFetch(url: string, init: RequestInit, timeoutMessage: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(USER_ACTION_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(timeoutMessage)
    }
    throw new Error("Couldn't reach the server. Check your connection and try again.")
  }
}

async function requestToken(
  grantType: 'password' | 'refresh_token',
  body: Record<string, string>,
  opts: { userAction?: boolean } = {}
): Promise<TokenResponse> {
  const url = `${env.supabaseUrl}/auth/v1/token?grant_type=${grantType}`
  const init: RequestInit = {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }
  const resp = opts.userAction
    ? await userActionFetch(url, init, 'Signing in is taking too long. Check your connection and try again.')
    : await fetch(url, init)
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

/**
 * Creates the account and its household via the register-user function, then
 * signs in with the same credentials.
 *
 * Registration deliberately does not mint its own session — the function returns
 * no token, so sessions come from exactly one place (signInWithPassword) and the
 * post-registration state is identical to any ordinary sign-in.
 */
export async function registerAndSignIn(input: {
  email: string
  password: string
  displayName: string
  householdName: string
  inviteCode: string
}): Promise<Session> {
  const resp = await userActionFetch(`${env.supabaseUrl}/functions/v1/register-user`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      display_name: input.displayName,
      household_name: input.householdName,
      invite_code: input.inviteCode
    })
  }, 'Registration is taking too long. It may still have gone through — try signing in before registering again.')
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(data?.error ?? `Registration failed (HTTP ${resp.status})`)
  }
  return signInWithPassword(input.email, input.password)
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const resp = await requestToken('password', { email: email.trim(), password }, { userAction: true })
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

/**
 * Revokes the refresh token server-side, then clears local state.
 *
 * Dropping the localStorage entry alone leaves the refresh token valid until it
 * expires naturally — so a copy taken from a shared browser would still mint new
 * access tokens long after the user thought they had signed out.
 */
export async function signOutEverywhere(session: Session | null): Promise<void> {
  if (session?.accessToken) {
    try {
      await fetch(`${env.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: env.supabaseAnonKey,
          Authorization: `Bearer ${session.accessToken}`
        }
      })
    } catch {
      // Best effort — a network failure must not trap the user in a signed-in UI.
    }
  }
  clearSession()
}
