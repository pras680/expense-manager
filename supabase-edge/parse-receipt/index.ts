import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Edge function that takes { raw_text } and calls Anthropic to extract structured receipt data.
// Environment variables required:
// - ANTHROPIC_API_KEY
// - ANTHROPIC_MODEL (optional)

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-latest'
const MAX_RAW_TEXT_CHARS = 18_000

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

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
  }

  try {
    const payload = await req.json()
    const raw_text = String(payload.raw_text ?? '').trim()
    const learning_hints = sanitizeLearningHints(payload.learning_hints)

    if (!raw_text) {
      return jsonResponse({ error: 'raw_text is required' }, 400)
    }

    if (raw_text.length > MAX_RAW_TEXT_CHARS) {
      return jsonResponse({ error: 'raw_text is too large' }, 413)
    }

    if (!ANTHROPIC_API_KEY) {
      console.error('Receipt parser is not configured.')
      return jsonResponse({ error: 'Receipt parser is not configured' }, 500)
    }

    const systemPrompt = `Extract structured receipt data from OCR text. Respond with one valid JSON object only. Keys: merchant, date, total, currency, extracted_digits, card_last4, card_bank, category, line_items. date must be yyyy-mm-dd when possible. total must be numeric. currency must be a 3-letter ISO code, default SGD when unclear. extracted_digits and card_last4 must contain only the last 4 digits of the payment card used, such as digits near VISA, MasterCard, AMEX, CARD, CREDIT, DEBIT, ****, xxxx, or similar payment markers; use null if unknown. card_bank should be null unless the receipt explicitly names the issuing bank. Infer category from merchant name, receipt headers, and line item descriptions. category must be exactly one of: Groceries, Food & Dining, Electronics, Clothing, Entertainment, Fuel, EV Charging, Utilities, Travel, Health, Home, Subscriptions, Services, Credit Card Bill Payment, Miscellaneous. Use Groceries for supermarkets, grocery stores, produce, household grocery items, and wholesale grocery runs. Use Food & Dining for restaurants, cafes, bakeries, delivery, and prepared food. Use Electronics for computers, phones, appliances, accessories, and tech stores. Use Clothing for apparel, shoes, laundry, and fashion stores. Use Entertainment for movies, games, events, books, music, and leisure. Use Fuel for gas/petrol stations and fuel purchases. Use EV Charging for electric vehicle charging sessions or networks. Use Utilities for power, water, internet, phone, and recurring household bills. Use Travel for hotels, rideshare, transit, parking, flights, and car rentals. Use Health for pharmacy, medical, dental, fitness, and personal care. Use Home for hardware, furniture, home improvement, and garden supplies. Use Subscriptions for recurring memberships or digital services. Use Services for person-to-person PayNow/PayLah/bank-transfer alerts or service providers such as repair, cleaning, tuition, salon, consultation, handyman, electrician, or maintenance. Use Credit Card Bill Payment for bank confirmations that a credit card bill, card account, statement balance, minimum payment, outstanding balance, or amount due was paid. For PayNow alerts, treat the payee/vendor as merchant; if the payee sounds like a business, infer its business type from the vendor name and surrounding email text; if the payee sounds like a person, use Services. If multiple categories match, choose the category with the largest spend or strongest receipt evidence. Use Miscellaneous only when evidence is unclear. line_items is an array of {description, amount}. Use null for unknown scalar values and [] for unknown line_items.`

    const correctionHintText = learning_hints.length > 0
      ? `\n\nUSER_CORRECTION_HINTS:\n${JSON.stringify(learning_hints)}\nIf OCR text contains a merchant_keyword, prefer the corrected values for merchant, category, currency, card_last4, and card_bank when applicable.`
      : ''

    const anthropicBody = {
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `OCR_TEXT:\n\n${raw_text}${correctionHintText}\n\nReturn JSON only.`
        }
      ]
    }

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    })

    if (!resp.ok) {
      console.error(`Anthropic request failed with status ${resp.status}.`)
      return jsonResponse({ error: 'Receipt parser unavailable' }, 502)
    }

    const anthropicJson = await resp.json()
    const assistantText = anthropicJson?.content
      ?.map((part: { type?: string; text?: string }) => part.type === 'text' ? part.text ?? '' : '')
      .join('\n')
      .trim()

    if (!assistantText) {
      console.error('Anthropic response did not include text content.')
      return jsonResponse({ error: 'Receipt parser returned no result' }, 502)
    }

    try {
      const parsed = JSON.parse(extractJsonObject(assistantText))
      return jsonResponse(parsed)
    } catch (_err) {
      console.error('Receipt parser returned invalid JSON.')
      return jsonResponse({ error: 'Receipt parser returned invalid data' }, 502)
    }
  } catch (err) {
    const message = err instanceof Error ? err.name : 'UnknownError'
    console.error(`Receipt parser request failed: ${message}.`)
    return jsonResponse({ error: 'Receipt parser request failed' }, 500)
  }
})

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
      corrected_card_bank: safeHintString(source.corrected_card_bank ?? source.correctedCardBank)
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
