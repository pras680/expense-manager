import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Edge function that takes { raw_text } and calls Groq's OpenAI-compatible
// chat completions API to extract structured receipt data.
// Environment variables required:
// - LLM_API_KEY   (a Groq API key)
// - LLM_MODEL (optional)
//
// qwen/qwen3.6-27b is the only Groq-hosted model on this account with both
// image input (needed for the webapp's camera-capture path) and json_mode —
// swap only to another model with both, or the image path breaks silently.

const LLM_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const LLM_API_KEY = Deno.env.get('LLM_API_KEY')
const LLM_MODEL = Deno.env.get('LLM_MODEL') ?? 'qwen/qwen3.6-27b'

// Optional second provider, tried only when the primary call fails outright
// (network error, non-2xx, or a 2xx response that isn't usable JSON) — this
// account has already been forced off three LLM providers by outages or
// silent model deprecations (see CLAUDE.md), so a single point of failure
// here has real production history of causing multi-day total outages
// across all three ingestion paths at once (SMS, Gmail, photo/manual).
// Unset by default: with no fallback configured, behavior is byte-for-byte
// identical to before this existed. Must also be OpenAI-compatible with
// both vision input and json_mode, same requirement as the primary.
const FALLBACK_LLM_API_URL = Deno.env.get('FALLBACK_LLM_API_URL')
const FALLBACK_LLM_API_KEY = Deno.env.get('FALLBACK_LLM_API_KEY')
const FALLBACK_LLM_MODEL = Deno.env.get('FALLBACK_LLM_MODEL')
const FALLBACK_CONFIGURED = Boolean(FALLBACK_LLM_API_URL && FALLBACK_LLM_API_KEY && FALLBACK_LLM_MODEL)

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')

// Supabase's edge runtime global — lets a promise finish after the response
// has been sent. Absent when running outside that runtime (e.g. plain Deno).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

// Supabase's verify_jwt gate accepts the public anon key, which ships inside the
// iOS binary and the web app's JS bundle — so by default this function is an
// open, unmetered proxy to a paid LLM. Setting REQUIRE_AUTH=true restricts it to
// real signed-in users (role=authenticated) and the service_role caller used by
// process-sms-inbox.
//
// Off by default so the iOS app (which calls this with the anon key unless
// signed in) keeps working until sign-in is set up there; flip it on with:
//   supabase secrets set REQUIRE_AUTH=true --project-ref <ref>
const REQUIRE_AUTH = (Deno.env.get('REQUIRE_AUTH') ?? '').toLowerCase() === 'true'
const MAX_RAW_TEXT_CHARS = 18_000
const MAX_IMAGE_BASE64_CHARS = 8_000_000 // ~6MB decoded; client compresses before upload
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  if (REQUIRE_AUTH && !isAuthorizedCaller(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
  }

  try {
    const payload = await req.json()
    const raw_text = String(payload.raw_text ?? '').trim()
    const image_base64 = typeof payload.image_base64 === 'string' ? payload.image_base64 : ''
    const image_mime_type = typeof payload.image_mime_type === 'string' ? payload.image_mime_type : ''
    const learning_hints = sanitizeLearningHints(payload.learning_hints)
    const household_categories = sanitizeHouseholdCategories(payload.household_categories)
    // Bank SMS alerts routinely omit the year entirely (e.g. "15 Aug 16:55").
    // Without a reference point the model has no way to know what "now" is and
    // has been observed guessing a stale year from its training data (a
    // S$25,000 transfer landed as 2023 instead of 2026) — silently corrupting
    // both the date and, downstream, which month/report a receipt appears
    // under. Callers that know a better anchor than "now" (process-sms-inbox,
    // scan-gmail — the message's own received timestamp) should pass it.
    const referenceDateRaw = typeof payload.reference_date === 'string' ? payload.reference_date : ''
    const referenceDate = new Date(referenceDateRaw)
    const referenceDateISO = Number.isNaN(referenceDate.getTime())
      ? new Date().toISOString()
      : referenceDate.toISOString()

    if (!raw_text && !image_base64) {
      return jsonResponse({ error: 'raw_text or image_base64 is required' }, 400)
    }

    if (raw_text.length > MAX_RAW_TEXT_CHARS) {
      return jsonResponse({ error: 'raw_text is too large' }, 413)
    }

    if (image_base64) {
      if (!ALLOWED_IMAGE_MIME_TYPES.has(image_mime_type)) {
        return jsonResponse({ error: 'image_mime_type must be image/jpeg, image/png, or image/webp' }, 400)
      }
      if (image_base64.length > MAX_IMAGE_BASE64_CHARS) {
        return jsonResponse({ error: 'image_base64 is too large' }, 413)
      }
    }

    if (!LLM_API_KEY) {
      console.error('Receipt parser is not configured.')
      return jsonResponse({ error: 'Receipt parser is not configured' }, 500)
    }

    // A household can add its own categories (Settings -> Categories,
    // household_categories table) — when present, they become legal outputs
    // alongside the fixed list below. There's no hand-written per-category
    // rule possible for a user-typed name, so classification into one relies
    // on the name itself plus whatever merchant-specific correction hints
    // (above/below) reinforce it — a known, accepted limitation, not a bug.
    const categoryEnum = household_categories.length > 0
      ? `Groceries, Food & Dining, Electronics, Clothing, Entertainment, Fuel, EV Charging, Utilities, Travel, Commute, Health, Home, Subscriptions, Services, Local Transfer, Credit Card Bill Payment, ATM Cash Withdrawal, Miscellaneous, ${household_categories.join(', ')}`
      : 'Groceries, Food & Dining, Electronics, Clothing, Entertainment, Fuel, EV Charging, Utilities, Travel, Commute, Health, Home, Subscriptions, Services, Local Transfer, Credit Card Bill Payment, ATM Cash Withdrawal, Miscellaneous'
    const householdCategoryText = household_categories.length > 0
      ? ` Also use one of these household-specific categories when it fits more precisely than the built-in ones, using the exact spelling given: ${household_categories.join(', ')}.`
      : ''

    const systemPrompt = `First judge whether this text actually describes one specific real purchase, bill, payment, refund, or money transfer with a determinable amount — not a newsletter, marketing or promotional email, a shipping/tracking update with no price, a calendar invite, an account or security notification, a social notification, or general correspondence that merely mentions money in passing. This judgment is content-based, not keyword-based: an email can contain words like "order" or "payment" while still not documenting an actual transaction (e.g. "track your order" with no amount, or a newsletter about payment options), and can document a real transaction without using any typical receipt wording at all. If it does not describe one specific real transaction, respond with merchant: null and total: null, and use null/[] for every other field — do not invent or guess a merchant or amount from unrelated content just because a number appears somewhere in the text. If it does, extract structured receipt data from it. Respond with one valid JSON object only. Keys: merchant, date, total, currency, extracted_digits, card_last4, card_bank, category, line_items, raw_text, derivation_note. Today's reference date is ${referenceDateISO.slice(0, 10)}. date must be yyyy-mm-dd when possible; use the exact year printed on the receipt — never infer or adjust a year that IS printed. When no year is printed at all (common in bank SMS alerts, e.g. "15 Aug 16:55"), use the year from the reference date above, UNLESS that would place the date more than a couple of days in the future relative to the reference date, in which case use the previous year instead — never guess an arbitrary year from general knowledge. When the date is numeric and ambiguous (e.g. 8/7/2026), assume day/month/year order (Singapore convention), i.e. 8/7/2026 means 8 July 2026, not August 7th — only use month/day order if the first number is greater than 12. total must be numeric. Make total NEGATIVE when this transaction is money being credited, refunded, or reversed back onto the card/account instead of spent — a refund, reversal, chargeback, or a cancelled/voided charge being undone. Make total POSITIVE for an ordinary purchase, payment, or transfer — this is the default; only go negative for the refund/reversal case above. currency must be a 3-letter ISO code, default SGD when unclear. extracted_digits and card_last4 must contain only the last 4 digits of the payment card used, such as digits near VISA, MasterCard, AMEX, CARD, CREDIT, DEBIT, ****, xxxx, or similar payment markers; use null if unknown. card_bank should be null unless the receipt explicitly names the issuing bank. Infer category from merchant name, receipt headers, and line item descriptions. category must be exactly one of: ${categoryEnum}. Use Groceries for supermarkets, grocery stores, produce, household grocery items, and wholesale grocery runs. Use Food & Dining for restaurants, cafes, bakeries, delivery, and prepared food. Use Electronics for computers, phones, appliances, accessories, and tech stores. Use Clothing for apparel, shoes, laundry, and fashion stores. Use Entertainment for movies, games, events, books, music, and leisure. Use Fuel for gas/petrol stations and fuel purchases. Use EV Charging for electric vehicle charging sessions or networks. Use Utilities for power, water, internet, phone, and recurring household bills. Use Travel for flights, hotels, car rentals, and trip/travel bookings. Use Commute for local getting-around: rideshare and taxis (Grab, Gojek, Uber, TADA, Ryde, CDG/ComfortDelGro/Zig), public transit (MRT, bus, SimplyGo, EZ-Link, TransitLink), and parking/ERP — including a ride to or from the airport. Use Health for pharmacy, medical, dental, fitness, and personal care. Use Home for hardware, furniture, home improvement, and garden supplies. Use Subscriptions for recurring memberships or digital services. Use Services for service providers such as repair, cleaning, tuition, salon, consultation, handyman, electrician, or maintenance — even when paid via PayNow/PayLah, if the message documents a specific service rendered (a job, a booking, an invoice). Use Local Transfer for PayNow/PayLah/FAST/bank-transfer/fund-transfer alerts that are just money moving to a bank account or person, with no documented goods or service behind it — this is the default for a bare transfer alert, including self-transfers between the user's own accounts and sending money to family or friends. Treat the payee/recipient name as merchant for these. Use Credit Card Bill Payment for bank confirmations that a credit card bill, card account, statement balance, minimum payment, outstanding balance, or amount due was paid. Use ATM Cash Withdrawal for ATM or cash withdrawal alerts.${householdCategoryText} If multiple categories match, choose the category with the largest spend or strongest receipt evidence. Use Miscellaneous only when evidence is unclear. line_items is an array of {description, amount}. raw_text must be a plain-text transcription of ALL text visible on the receipt, in reading order, newlines between lines — this is what makes a receipt findable later by searching for something printed on it, so transcribe it even when the structured fields above already capture the totals. When the input was already text rather than an image, set raw_text to null. derivation_note must be one short plain-language sentence (under 140 characters) explaining how you arrived at merchant/total/category — e.g. which line or field you read them from, or what you inferred them from and why — so a human glancing at it later understands your reasoning at a glance; set it to null whenever merchant and total are both null. Use null for unknown scalar values and [] for unknown line_items.`

    const correctionHintText = learning_hints.length > 0
      ? `\n\nUSER_CORRECTION_HINTS:\n${JSON.stringify(learning_hints)}\nIf OCR text contains a merchant_keyword, prefer the corrected values for merchant, category, currency, card_last4, and card_bank when applicable, and treat that hint's note (if any) as additional trusted context about this specific merchant when writing derivation_note and choosing category.`
      : ''

    // Image path: let the vision-capable model read the photo directly rather
    // than requiring a separate OCR step (this is what makes the webapp's
    // camera-capture flow work without any on-device OCR, unlike iOS's Vision
    // framework-based OCRService).
    const userContent = image_base64
      ? [
          { type: 'text', text: `Extract structured receipt data from this receipt photo.${correctionHintText}\n\nReturn JSON only.` },
          { type: 'image_url', image_url: { url: `data:${image_mime_type};base64,${image_base64}` } }
        ]
      : `OCR_TEXT:\n\n${raw_text}${correctionHintText}\n\nReturn JSON only.`

    const basePayload = {
      // 4000 is empirically the ceiling, not a conservative choice: raising
      // it to 8000 to give large multi-item receipts more headroom made
      // Groq reject the request outright with 413 (too large) rather than
      // truncate gracefully — this account's rate/context limit sits
      // somewhere between the two, and 4000 is the last confirmed-working
      // value. Do not raise this without confirming against a real call.
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    }

    let result = await callLLMProvider(LLM_API_URL, LLM_API_KEY, LLM_MODEL, basePayload, {
      includeReasoningEffort: true,
      // Groq has no quota endpoint; its rate-limit headers on this response
      // are the only source. Recorded for every caller so the webapp can
      // show what's left — see multiuser-20-llm-quota-status.sql. Only done
      // for the primary: the headers/row shape here are Groq-specific, and
      // a fallback provider's own limits aren't what that table tracks.
      recordGroqQuota: true
    })
    let triedFallback = false

    if (!result.ok && FALLBACK_CONFIGURED) {
      console.error(`Primary LLM call failed (${result.status}): ${result.detail.slice(0, 300)} — retrying with fallback provider.`)
      triedFallback = true
      // reasoning_effort is a qwen/Groq-specific knob, not a general
      // OpenAI-compatible field — omitted for the fallback since we don't
      // know whether that provider even recognizes it.
      result = await callLLMProvider(FALLBACK_LLM_API_URL!, FALLBACK_LLM_API_KEY!, FALLBACK_LLM_MODEL!, basePayload, {
        includeReasoningEffort: false
      })
    }

    if (!result.ok) {
      console.error(`LLM request failed${triedFallback ? ' (fallback also failed)' : ''}: ${result.detail}`)
      // The status alone is safe to return and is the difference between
      // "you are rate limited / out of quota" (429) and a real fault, which is
      // otherwise indistinguishable from outside the function's logs.
      if (result.status === 429) {
        return jsonResponse(
          { error: 'Receipt parser is rate limited or out of quota', upstream_status: 429, retry_after_seconds: result.retryAfterSeconds ?? null },
          429,
          result.retryAfterSeconds != null ? { 'Retry-After': String(result.retryAfterSeconds) } : {}
        )
      }
      // 413 is the input+requested-output combination exceeding the model's
      // context limit, rejected upfront rather than truncated — distinct from
      // finish_reason 'length' below, which is a response cut off mid-stream.
      // Both mean "too big", worth telling apart in logs if the cap (see
      // max_tokens above) ever needs revisiting.
      if (result.status === 413) {
        return jsonResponse({ error: 'Receipt text was too large for the parser', upstream_status: 413 }, 502)
      }
      if (result.status === 'empty') {
        return jsonResponse({ error: 'Receipt parser returned no result' }, 502)
      }
      if (result.status === 'invalid_json') {
        // finish_reason 'length' means the response was cut off mid-JSON by
        // max_tokens, not that the model produced garbage — a large
        // multi-item receipt (many line_items) is exactly the case that
        // runs closest to the budget. Worth distinguishing in the
        // client-visible error: one says "give it more room", the other
        // says "something is actually wrong".
        return jsonResponse({ error: 'Receipt parser returned invalid data', truncated: result.truncated }, 502)
      }
      return jsonResponse({ error: 'Receipt parser unavailable', upstream_status: result.status }, 502)
    }

    return jsonResponse(result.data)
  } catch (err) {
    const message = err instanceof Error ? err.name : 'UnknownError'
    console.error(`Receipt parser request failed: ${message}.`)
    return jsonResponse({ error: 'Receipt parser request failed' }, 500)
  }
})

// Accepts either a real signed-in user (JWT with role=authenticated) or the
// service_role caller used by process-sms-inbox. Rejects the anon/publishable
// key, which is public by design.
//
// Reading claims without re-verifying the signature is only safe because this
// function is deployed with verify_jwt=true, so Supabase's gateway has already
// validated the signature and expiry before we ever see the request. If that
// setting is ever turned off, this check must switch to verifying the JWT itself.
function isAuthorizedCaller(req: Request): boolean {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return false

  if (SUPABASE_SERVICE_ROLE_KEY && timingSafeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY)) {
    return true
  }

  const role = jwtRole(bearer)
  return role === 'authenticated' || role === 'service_role'
}

function jwtRole(token: string): string | null {
  const segments = token.split('.')
  if (segments.length !== 3) return null // opaque key (e.g. sb_publishable_...), not a JWT
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded))
    return typeof claims?.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}

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

function sanitizeHouseholdCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value.slice(0, 30)) {
    const name = String(item ?? '')
      .replace(/[\r\n{}[\]<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
    const key = name.toLowerCase()
    if (name.length < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

function sanitizeLearningHints(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.slice(0, 12).map((item) => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      merchant_keyword: safeHintString(source.merchant_keyword ?? source.merchantKeyword),
      corrected_merchant: safeHintString(source.corrected_merchant ?? source.correctedMerchant),
      corrected_category: safeHintString(source.corrected_category ?? source.correctedCategory),
      corrected_currency: safeHintString(source.corrected_currency ?? source.correctedCurrency),
      corrected_card_last4: safeHintString(source.corrected_card_last4 ?? source.correctedCardLast4),
      corrected_card_bank: safeHintString(source.corrected_card_bank ?? source.correctedCardBank),
      note: safeHintString(source.note)
    }
  }).filter((hint) => hint.merchant_keyword.length >= 3)
}

function safeHintString(value: unknown) {
  return String(value ?? '')
    .replace(/[\r\n{}[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

type LLMResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false
      status: number | 'empty' | 'invalid_json'
      detail: string
      truncated?: boolean
      retryAfterSeconds?: number | null
    }

// One call to one OpenAI-compatible chat-completions endpoint, normalizing
// every failure mode (transport error, non-2xx, empty content, unparseable
// JSON) into one result shape so the caller can try a second provider
// without duplicating any of this logic.
async function callLLMProvider(
  apiUrl: string,
  apiKey: string,
  model: string,
  basePayload: Record<string, unknown>,
  options: { includeReasoningEffort: boolean; recordGroqQuota?: boolean }
): Promise<LLMResult> {
  const chatBody = {
    ...basePayload,
    model,
    // qwen3.6 is a reasoning model by default, which burns hundreds of
    // tokens "thinking" in a separate field before ever writing the JSON
    // answer — unnecessary latency/cost for a fixed-shape extraction task,
    // so reasoning is turned off. response_format still forces JSON-only
    // content.
    ...(options.includeReasoningEffort ? { reasoning_effort: 'none' } : {})
  }

  let resp: Response
  try {
    resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(chatBody)
    })
  } catch (err) {
    return { ok: false, status: 0, detail: `transport error: ${err instanceof Error ? err.message : String(err)}` }
  }

  let retryAfterSeconds: number | null = null
  if (options.recordGroqQuota) {
    retryAfterSeconds = parseRetryAfter(resp.headers.get('retry-after'))
    recordQuotaStatus(resp, retryAfterSeconds)
  }

  if (!resp.ok) {
    // Upstream bodies can carry provider/account/model details and quota state
    // — log them server-side, but never echo them back to the caller.
    const errBody = await resp.text()
    return { ok: false, status: resp.status, detail: `HTTP ${resp.status}: ${errBody}`, retryAfterSeconds }
  }

  const chatJson = await resp.json()
  const assistantText = String(chatJson?.choices?.[0]?.message?.content ?? '').trim()
  const finishReason = chatJson?.choices?.[0]?.finish_reason ?? null

  if (!assistantText) {
    return { ok: false, status: 'empty', detail: 'LLM response did not include text content.' }
  }

  try {
    const parsed = JSON.parse(extractJsonObject(assistantText))
    return { ok: true, data: parsed }
  } catch (_err) {
    return {
      ok: false,
      status: 'invalid_json',
      detail: `invalid JSON (finish_reason=${finishReason}): ${assistantText}`,
      truncated: finishReason === 'length'
    }
  }
}

// Best-effort: a failure here must never affect the parse result, and it
// runs after the response is sent where the runtime allows, so it adds no
// latency. Only headers that are actually present are written — PostgREST's
// merge-duplicates upsert updates just the columns in the payload, so a
// response missing some headers doesn't blank out the last known values.
function recordQuotaStatus(resp: Response, retryAfterSeconds: number | null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return

  const now = Date.now()
  const row: Record<string, unknown> = {
    provider: 'groq',
    model: LLM_MODEL,
    last_status: resp.status,
    updated_at: new Date(now).toISOString()
  }
  const setInt = (column: string, header: string) => {
    const value = Number.parseInt(resp.headers.get(header) ?? '', 10)
    if (Number.isFinite(value)) row[column] = value
  }
  const setResetAt = (column: string, header: string) => {
    const ms = parseGroqDuration(resp.headers.get(header))
    if (ms != null) row[column] = new Date(now + ms).toISOString()
  }
  setInt('limit_requests', 'x-ratelimit-limit-requests')
  setInt('remaining_requests', 'x-ratelimit-remaining-requests')
  setResetAt('requests_reset_at', 'x-ratelimit-reset-requests')
  setInt('limit_tokens', 'x-ratelimit-limit-tokens')
  setInt('remaining_tokens', 'x-ratelimit-remaining-tokens')
  setResetAt('tokens_reset_at', 'x-ratelimit-reset-tokens')
  if (resp.status === 429) {
    // No retry-after on a 429 still means "limited" — assume a short wait
    // rather than showing the parser as ready.
    row.rate_limited_until = new Date(now + (retryAfterSeconds ?? 60) * 1000).toISOString()
  } else if (resp.ok) {
    row.rate_limited_until = null
  }

  const write = fetch(`${SUPABASE_URL}/rest/v1/llm_quota_status`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  })
    .then(async (r) => {
      if (!r.ok) console.error(`Recording LLM quota status failed: ${r.status} ${(await r.text()).slice(0, 200)}`)
    })
    .catch((err) => console.error(`Recording LLM quota status failed: ${err instanceof Error ? err.name : err}`))

  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(write)
}

// Groq reports resets as Go-style durations: "2m59.56s", "7.66s", "860ms",
// "1h2m3s". Returns milliseconds, or null if absent/unrecognised.
function parseGroqDuration(value: string | null): number | null {
  if (!value) return null
  let total = 0
  let matched = false
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true
    const n = Number.parseFloat(amount)
    total += unit === 'h' ? n * 3_600_000 : unit === 'm' ? n * 60_000 : unit === 's' ? n * 1000 : n
  }
  return matched ? Math.round(total) : null
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number.parseFloat(value)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } })
}

function extractJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found')
  }
  return text.slice(start, end + 1)
}
