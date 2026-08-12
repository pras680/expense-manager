import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Completes the Gmail OAuth flow for a signed-in user.
//
// The browser runs the consent redirect and receives a short-lived, single-use
// authorization `code`. It hands that code here; this function exchanges it for
// a refresh token using the client secret, which must never reach a browser.
//
// The refresh token then goes into Supabase Vault, not into a table — it can
// read the user's entire mailbox, and Postgres RLS is row-level, so a token
// column on any client-readable table would be readable by that client.
//
// Actions:
//   start      -> returns the Google consent URL to redirect to
//   callback   -> exchanges ?code= for tokens and records the connection
//   disconnect -> revokes with Google and clears local state

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID')
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET')

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

// Only these may be used as the OAuth redirect. Google enforces its own
// allow-list too, but echoing an arbitrary caller-supplied URI here would make
// this function a redirect oracle.
const ALLOWED_REDIRECTS = new Set([
  'http://localhost:5173/settings/gmail/callback',
  'http://localhost:5174/settings/gmail/callback',
  'http://localhost:5175/settings/gmail/callback',
  ...(Deno.env.get('GMAIL_REDIRECT_URIS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

function adminHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
    'Content-Type': 'application/json'
  }
}

// Safe because this function is deployed with verify_jwt=true — the gateway has
// already validated signature and expiry.
function callerUserId(req: Request): string | null {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const segments = token.split('.')
  if (segments.length !== 3) return null
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded))
    return claims?.role === 'authenticated' && typeof claims?.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error('gmail-connect: environment is incomplete.')
    return json({ error: 'Gmail is not configured on the server' }, 500)
  }

  const userId = callerUserId(req)
  if (!userId) return json({ error: 'Unauthorized' }, 401)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const action = String(payload.action ?? '')
  const redirectUri = String(payload.redirect_uri ?? '')

  if (action === 'start') {
    if (!ALLOWED_REDIRECTS.has(redirectUri)) {
      return json({ error: 'redirect_uri is not allow-listed on the server' }, 400)
    }
    const url = new URL(AUTH_ENDPOINT)
    url.searchParams.set('client_id', GMAIL_CLIENT_ID)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GMAIL_SCOPE)
    // Both are required to be issued a refresh token: offline asks for one at
    // all, and consent forces re-issue even if the user already granted access
    // (Google only returns a refresh token on first consent otherwise).
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('include_granted_scopes', 'true')
    return json({ url: url.toString() })
  }

  if (action === 'callback') {
    const code = String(payload.code ?? '')
    if (!code) return json({ error: 'code is required' }, 400)
    if (!ALLOWED_REDIRECTS.has(redirectUri)) {
      return json({ error: 'redirect_uri is not allow-listed on the server' }, 400)
    }
    return await completeConnection(userId, code, redirectUri)
  }

  if (action === 'disconnect') {
    return await disconnect(userId)
  }

  return json({ error: "action must be 'start', 'callback' or 'disconnect'" }, 400)
})

async function completeConnection(userId: string, code: string, redirectUri: string): Promise<Response> {
  const body = new URLSearchParams({
    code,
    client_id: GMAIL_CLIENT_ID!,
    client_secret: GMAIL_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })

  const tokenResp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!tokenResp.ok) {
    const detail = await tokenResp.text()
    console.error(`Gmail token exchange failed: ${tokenResp.status} ${detail}`)
    return json({ error: 'Google rejected the authorization. Please try connecting again.' }, 502)
  }

  const tokens = await tokenResp.json()
  const refreshToken: string | undefined = tokens.refresh_token
  const accessToken: string | undefined = tokens.access_token

  if (!refreshToken) {
    // Happens when the user has connected before and Google decides not to
    // re-issue. prompt=consent should prevent it, but if it does happen the
    // connection would appear to succeed and then never work unattended.
    return json({
      error: 'Google did not return a refresh token. Remove this app at ' +
             'myaccount.google.com/permissions and connect again.'
    }, 502)
  }

  // Identify the mailbox so the UI can show which account is connected.
  let email = 'unknown'
  if (accessToken) {
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (profile.ok) {
      const p = await profile.json()
      email = p.emailAddress ?? 'unknown'
    }
  }

  const stored = await storeRefreshToken(userId, refreshToken)
  if (!stored) return json({ error: 'Could not securely store the Gmail token' }, 502)

  const upsert = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      email,
      connected_at: new Date().toISOString(),
      revoked_at: null,
      last_error: null
    })
  })
  if (!upsert.ok) {
    console.error(`gmail_connections upsert failed: ${upsert.status}`)
    return json({ error: 'Connected to Google but could not save the connection' }, 502)
  }

  return json({ ok: true, email })
}

// Vault is reachable only through SQL, so this goes via an RPC that the
// migration defines. Storing under a per-user name keeps one member's token
// from being confused with another's.
async function storeRefreshToken(userId: string, refreshToken: string): Promise<boolean> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_gmail_refresh_token`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ p_user_id: userId, p_token: refreshToken })
  })
  if (!resp.ok) {
    console.error(`set_gmail_refresh_token failed: ${resp.status} ${await resp.text()}`)
    return false
  }
  return true
}

async function disconnect(userId: string): Promise<Response> {
  // Best-effort revoke at Google so access actually stops, not just locally.
  const tokenResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_gmail_refresh_token`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ p_user_id: userId })
  })
  if (tokenResp.ok) {
    const token = await tokenResp.json()
    if (typeof token === 'string' && token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST'
      }).catch(() => {})
    }
  }

  await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_gmail_refresh_token`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ p_user_id: userId })
  })

  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: { ...adminHeaders(), Prefer: 'return=minimal' }
  })

  return json({ ok: true })
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extra } })
}
