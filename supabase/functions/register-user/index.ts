import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Self-service registration: creates an account AND the household that account
// owns, in one server-side step.
//
// Why an Edge Function rather than the browser calling /auth/v1/signup directly:
// a bare signup produces an account with no household, no membership row and no
// user_settings — which the RLS policies and the receipts ownership trigger all
// depend on (set_receipt_owner reads active_household_id). Such a user can sign
// in but every insert lands with a null household_id and nothing is visible.
// Provisioning has to happen atomically with account creation, and creating the
// household rows requires service_role, which can never ship to a browser.
//
// This endpoint is deployed with verify_jwt=false (callers are by definition not
// signed in yet), so it is publicly reachable and gated on a shared invite code
// held in SIGNUP_INVITE_CODE. Without that gate, anyone finding the URL could
// mint unlimited accounts against the project's storage and LLM quota.
//
// IMPORTANT companion step: Supabase's own /auth/v1/signup must be disabled in
// the dashboard (Authentication -> Sign In / Providers -> "Allow new users to
// sign up" off). Otherwise this invite gate is decorative — the built-in
// endpoint stays open and bypasses it entirely.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SIGNUP_INVITE_CODE = Deno.env.get('SIGNUP_INVITE_CODE')

const MIN_PASSWORD_LENGTH = 8

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

// Never short-circuits on the first differing byte, so response timing can't be
// used to recover the invite code incrementally.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  let diff = aBytes.length ^ bBytes.length
  const max = Math.max(aBytes.length, bBytes.length)
  for (let i = 0; i < max; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }
  return diff === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('register-user: environment is incomplete.')
    return json({ error: 'register-user is not configured' }, 500)
  }
  // Fail closed: an unset invite code must not mean "no gate".
  if (!SIGNUP_INVITE_CODE) {
    console.error('register-user: SIGNUP_INVITE_CODE is not set; refusing all registrations.')
    return json({ error: 'Registration is not available' }, 503)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const inviteCode = String(payload.invite_code ?? '')
  if (!timingSafeEqual(inviteCode, SIGNUP_INVITE_CODE)) {
    return json({ error: 'That invite code is not valid' }, 403)
  }

  const email = String(payload.email ?? '').trim().toLowerCase()
  const password = String(payload.password ?? '')
  const displayName = String(payload.display_name ?? '').trim() || email.split('@')[0]
  const householdName = String(payload.household_name ?? '').trim() || `${displayName}'s household`

  if (!email.includes('@') || email.length > 200) {
    return json({ error: 'A valid email is required' }, 400)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400)
  }

  // Reject an existing account up front rather than letting the admin API fail
  // midway, which would leave no household but a live login.
  const lookup = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: adminHeaders() }
  )
  if (lookup.ok) {
    const found = await lookup.json()
    const match = (found?.users ?? []).find(
      (u: { email?: string }) => (u.email ?? '').toLowerCase() === email
    )
    if (match?.id) {
      return json({ error: 'An account with that email already exists. Try signing in instead.' }, 409)
    }
  }

  // 1. Account. email_confirm skips the verification mail entirely — the invite
  // code is what establishes the caller is allowed here, and no mail is sent, so
  // requiring confirmation would leave the account permanently unusable.
  const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true })
  })
  if (!create.ok) {
    const detail = await create.text()
    console.error(`register-user: admin create user failed: ${create.status} ${detail}`)
    return json({ error: 'Could not create that account' }, 502)
  }
  const created = await create.json()
  const userId: string | null = created?.id ?? null
  if (!userId) return json({ error: 'Account created but no id returned' }, 502)

  // 2. Their own household, owned by them. Every later step depends on this id,
  // so unwind the account if it fails rather than stranding a login with no home.
  const householdResp = await fetch(`${SUPABASE_URL}/rest/v1/households`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ name: householdName, created_by: userId })
  })
  if (!householdResp.ok) {
    console.error(`register-user: household insert failed: ${householdResp.status}`)
    await deleteUser(userId)
    return json({ error: 'Could not set up your household' }, 502)
  }
  const householdRows = await householdResp.json()
  const householdId: string | null = Array.isArray(householdRows)
    ? householdRows[0]?.id ?? null
    : householdRows?.id ?? null
  if (!householdId) {
    await deleteUser(userId)
    return json({ error: 'Household created but no id returned' }, 502)
  }

  // 3. Owner membership — this is what lets them add/remove members later.
  const member = await fetch(`${SUPABASE_URL}/rest/v1/household_members`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ household_id: householdId, user_id: userId, role: 'owner' })
  })
  if (!member.ok) {
    console.error(`register-user: household_members insert failed: ${member.status}`)
    await deleteUser(userId)
    return json({ error: 'Could not set up your household membership' }, 502)
  }

  // 4. Settings, including active_household_id — set_receipt_owner reads this to
  // stamp ownership on every receipt they create.
  const settings = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      display_name: displayName,
      default_currency: 'SGD',
      active_household_id: householdId
    })
  })
  if (!settings.ok) {
    console.error(`register-user: user_settings insert failed: ${settings.status}`)
    await deleteUser(userId)
    return json({ error: 'Could not save your settings' }, 502)
  }

  // No token is returned: the client signs in normally with the credentials it
  // just chose, so there is exactly one code path that mints sessions.
  return json({ ok: true, user_id: userId, email, display_name: displayName, household_id: householdId })
})

// Best-effort unwind so a half-provisioned signup doesn't block the email
// forever with an account that can sign in but has no household.
async function deleteUser(userId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders()
    })
  } catch (err) {
    console.error(`register-user: cleanup delete failed for ${userId}: ${err}`)
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extra } })
}
