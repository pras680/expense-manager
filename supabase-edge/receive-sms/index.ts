import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SMS_INGEST_SECRET = Deno.env.get('SMS_INGEST_SECRET')
const MAX_BODY_CHARS = 8_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sms-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' })
  }

  if (!SMS_INGEST_SECRET) {
    console.error('SMS ingest secret is not configured.')
    return jsonResponse({ error: 'SMS ingest is not configured' }, 500)
  }

  const providedSecret = req.headers.get('x-sms-ingest-secret') ?? ''
  if (!timingSafeEqual(providedSecret, SMS_INGEST_SECRET)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase Edge Function environment is incomplete.')
    return jsonResponse({ error: 'SMS ingest is not configured' }, 500)
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
  }

  try {
    const payload = await req.json()
    const body = smsBodyFromPayload(payload)
    const sender = safeOptionalString(payload.sender ?? payload.from)
    const source = safeOptionalString(payload.source) || 'ios-shortcut'
    const receivedAt = safeReceivedAt(payload.received_at ?? payload.receivedAt)
    const idempotencyKey = safeOptionalString(payload.idempotency_key ?? payload.idempotencyKey)
    const metadata = safeMetadata(payload.metadata)

    if (!body) {
      return jsonResponse({ error: 'body is required' }, 400)
    }

    if (body.length > MAX_BODY_CHARS) {
      return jsonResponse({ error: 'body is too large' }, 413)
    }

    const hashInput = idempotencyKey || `${source}\n${sender}\n${receivedAt}\n${body}`
    const bodyHash = await sha256Hex(hashInput)
    const row = {
      body,
      sender: sender || null,
      source,
      received_at: receivedAt,
      body_hash: bodyHash,
      status: 'pending',
      metadata
    }

    const insertUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/sms_inbox`
    const resp = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    })

    if (resp.status === 409) {
      return jsonResponse({ ok: true, duplicate: true })
    }

    const responseText = await resp.text()
    if (!resp.ok) {
      console.error(`sms_inbox insert failed with status ${resp.status}.`)
      return jsonResponse({ error: 'Could not save SMS' }, 502)
    }

    let insertedId: string | undefined
    try {
      const inserted = JSON.parse(responseText)
      insertedId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id
    } catch (_err) {
      insertedId = undefined
    }

    return jsonResponse({ ok: true, duplicate: false, id: insertedId ?? null })
  } catch (err) {
    const message = err instanceof Error ? err.name : 'UnknownError'
    console.error(`SMS ingest failed: ${message}.`)
    return jsonResponse({ error: 'SMS ingest failed' }, 500)
  }
})

function smsBodyFromPayload(payload: Record<string, unknown>) {
  return safeOptionalString(
    payload.body ??
    payload.message ??
    payload.text ??
    payload.sms_text ??
    payload.smsText
  )
}

function safeOptionalString(value: unknown) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeReceivedAt(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return new Date().toISOString()
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function safeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const output: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(source).slice(0, 20)) {
    const safeKey = key.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60)
    if (!safeKey) continue
    output[safeKey] = safeOptionalString(rawValue).slice(0, 200)
  }
  return output
}

// Compares in time proportional to the input length only, never short-circuiting
// on the first differing byte, so response timing can't be used to recover the
// secret one character at a time. Length is compared via the same accumulator so
// a wrong-length guess isn't distinguishable either.
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

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } })
}
