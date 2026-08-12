import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Household membership management, callable from the web app's Settings screen.
//
// This exists as an Edge Function rather than plain PostgREST calls because
// creating a login requires the Auth admin API, which needs the service_role
// key — and that key can never be shipped to a browser. The function therefore
// holds the privileged credential and gates every call on the caller proving,
// via their own JWT, that they are an OWNER of the household they are changing.
//
// Removing a member unlinks them from the household but deliberately does NOT
// delete their auth account or their receipts: `receipts.user_id` cascades on
// user deletion, so deleting the account would silently destroy their spending
// history. Unlinking is reversible; deletion is not.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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

// Safe because the function is deployed with verify_jwt=true: Supabase's gateway
// has already validated this token's signature and expiry.
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

async function ownedHouseholdId(userId: string): Promise<string | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/household_members?select=household_id&user_id=eq.${userId}&role=eq.owner&limit=1`,
    { headers: adminHeaders() }
  )
  if (!resp.ok) return null
  const rows = await resp.json()
  return rows?.[0]?.household_id ?? null
}

// 16 bytes of CSPRNG entropy, rendered in a shape that satisfies the usual
// "needs a letter, digit and symbol" policies without the user having to think.
function generatePassword(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const body = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 16)
  return `Bs-${body}9`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('manage-household: environment is incomplete.')
    return json({ error: 'manage-household is not configured' }, 500)
  }

  const caller = callerUserId(req)
  if (!caller) return json({ error: 'Unauthorized' }, 401)

  const householdId = await ownedHouseholdId(caller)
  if (!householdId) {
    return json({ error: 'Only a household owner can manage members' }, 403)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const action = String(payload.action ?? '')

  if (action === 'add') {
    const email = String(payload.email ?? '').trim().toLowerCase()
    const displayName = String(payload.display_name ?? '').trim() || email.split('@')[0]
    if (!email.includes('@') || email.length > 200) {
      return json({ error: 'A valid email is required' }, 400)
    }
    return await addMember(email, displayName, householdId)
  }

  if (action === 'remove') {
    const userId = String(payload.user_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'A valid user_id is required' }, 400)
    if (userId === caller) {
      // Otherwise the last owner can lock the whole household out of member
      // management, with no way back in from the app.
      return json({ error: "You can't remove yourself from the household" }, 400)
    }
    const del = await fetch(
      `${SUPABASE_URL}/rest/v1/household_members?household_id=eq.${householdId}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: { ...adminHeaders(), Prefer: 'return=representation' } }
    )
    if (!del.ok) return json({ error: 'Could not remove member' }, 502)
    const removed = await del.json()
    if (!Array.isArray(removed) || removed.length === 0) {
      return json({ error: 'That person is not in your household' }, 404)
    }
    return json({ ok: true, removed: userId })
  }

  return json({ error: "action must be 'add' or 'remove'" }, 400)
})

async function addMember(email: string, displayName: string, householdId: string): Promise<Response> {
  // Reuse an existing account if this email already has one — re-inviting
  // someone who was previously removed must not fail, and must not reset the
  // password they already use.
  let userId: string | null = null
  let generatedPassword: string | null = null

  const lookup = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: adminHeaders() }
  )
  if (lookup.ok) {
    const found = await lookup.json()
    const match = (found?.users ?? []).find(
      (u: { email?: string }) => (u.email ?? '').toLowerCase() === email
    )
    if (match?.id) userId = match.id
  }

  if (!userId) {
    generatedPassword = generatePassword()
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        email,
        password: generatedPassword,
        // No mail is sent, so requiring confirmation would leave the account
        // permanently unusable.
        email_confirm: true
      })
    })
    if (!create.ok) {
      const detail = await create.text()
      console.error(`admin create user failed: ${create.status} ${detail}`)
      return json({ error: 'Could not create that account' }, 502)
    }
    const created = await create.json()
    userId = created?.id ?? null
    if (!userId) return json({ error: 'Account created but no id returned' }, 502)
  }

  const member = await fetch(`${SUPABASE_URL}/rest/v1/household_members?on_conflict=household_id,user_id`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ household_id: householdId, user_id: userId, role: 'member' })
  })
  if (!member.ok) {
    console.error(`household_members insert failed: ${member.status}`)
    return json({ error: 'Account ready but could not join the household' }, 502)
  }

  // Give them settings so the app has a display name and currency immediately.
  await fetch(`${SUPABASE_URL}/rest/v1/user_settings?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      display_name: displayName,
      default_currency: 'SGD',
      active_household_id: householdId
    })
  })

  // The password is returned exactly once and never stored anywhere readable.
  return json({ ok: true, user_id: userId, email, display_name: displayName, password: generatedPassword })
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extra } })
}
