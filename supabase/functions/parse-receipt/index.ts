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
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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

    const chatBody = {
      model: LLM_MODEL,
      // qwen3.6 is a reasoning model by default, which burns hundreds of
      // tokens "thinking" in a separate field before ever writing the JSON
      // answer — unnecessary latency/cost for a fixed-shape extraction task,
      // so reasoning is turned off. response_format still forces JSON-only
      // content.
      //
      // 4000 is empirically the ceiling, not a conservative choice: raising
      // it to 8000 to give large multi-item receipts more headroom made
      // Groq reject the request outright with 413 (too large) rather than
      // truncate gracefully — this account's rate/context limit sits
      // somewhere between the two, and 4000 is the last confirmed-working
      // value. Do not raise this without confirming against a real call.
      max_tokens: 4000,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    }

    const resp = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify(chatBody)
    })

    if (!resp.ok) {
      // Upstream bodies can carry provider/account/model details and quota state
      // — log them server-side, but never echo them back to the caller.
      const errBody = await resp.text()
      console.error(`LLM request failed with status ${resp.status}: ${errBody}`)
      // The status alone is safe to return and is the difference between
      // "you are rate limited / out of quota" (429) and a real fault, which is
      // otherwise indistinguishable from outside the function's logs.
      if (resp.status === 429) {
        return jsonResponse({ error: 'Receipt parser is rate limited or out of quota', upstream_status: 429 }, 429)
      }
      // 413 is the input+requested-output combination exceeding the model's
      // context limit, rejected upfront rather than truncated — distinct from
      // finish_reason 'length' below, which is a response cut off mid-stream.
      // Both mean "too big", worth telling apart in logs if the cap (see
      // max_tokens above) ever needs revisiting.
      if (resp.status === 413) {
        return jsonResponse({ error: 'Receipt text was too large for the parser', upstream_status: 413 }, 502)
      }
      return jsonResponse({ error: 'Receipt parser unavailable', upstream_status: resp.status }, 502)
    }

    const chatJson = await resp.json()
    const assistantText = String(chatJson?.choices?.[0]?.message?.content ?? '').trim()
    const lastFinishReason = chatJson?.choices?.[0]?.finish_reason ?? null

    if (!assistantText) {
      console.error('LLM response did not include text content.')
      return jsonResponse({ error: 'Receipt parser returned no result' }, 502)
    }

    try {
      const parsed = JSON.parse(extractJsonObject(assistantText))
      return jsonResponse(parsed)
    } catch (_err) {
      console.error(`Receipt parser returned invalid JSON (finish_reason=${lastFinishReason}): ${assistantText}`)
      // finish_reason 'length' means the response was cut off mid-JSON by
      // max_tokens, not that the model produced garbage — a large multi-item
      // receipt (many line_items) is exactly the case that runs closest to the
      // budget. Worth distinguishing in the client-visible error: one says
      // "give it more room", the other says "something is actually wrong".
      const truncated = lastFinishReason === 'length'
      return jsonResponse(
        { error: 'Receipt parser returned invalid data', truncated },
        502
      )
    }
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
