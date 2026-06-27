import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// Edge function that takes { raw_text } and calls Anthropic to extract structured receipt data.
// Environment variables required:
// - ANTHROPIC_API_KEY
// - ANTHROPIC_MODEL (optional)

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-latest'

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

  try {
    const payload = await req.json()
    const raw_text = String(payload.raw_text ?? '').trim()

    if (!raw_text) {
      return jsonResponse({ error: 'raw_text is required' }, 400)
    }

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'Missing ANTHROPIC_API_KEY' }, 500)
    }

    const systemPrompt = `Extract structured receipt data from OCR text. Respond with one valid JSON object only. Keys: merchant, date, total, currency, extracted_digits, card_last4, card_bank, category, line_items. date must be yyyy-mm-dd when possible. total must be numeric. currency must be a 3-letter ISO code, default SGD when unclear. extracted_digits and card_last4 must contain only the last 4 digits of the payment card used, such as digits near VISA, MasterCard, AMEX, CARD, CREDIT, DEBIT, ****, xxxx, or similar payment markers; use null if unknown. card_bank should be null unless the receipt explicitly names the issuing bank. Infer category from merchant name, receipt headers, and line item descriptions. category must be exactly one of: Groceries, Food & Dining, Electronics, Clothing, Entertainment, Fuel, EV Charging, Utilities, Travel, Health, Home, Subscriptions, Miscellaneous. Use Groceries for supermarkets, grocery stores, produce, household grocery items, and wholesale grocery runs. Use Food & Dining for restaurants, cafes, bakeries, delivery, and prepared food. Use Electronics for computers, phones, appliances, accessories, and tech stores. Use Clothing for apparel, shoes, laundry, and fashion stores. Use Entertainment for movies, games, events, books, music, and leisure. Use Fuel for gas/petrol stations and fuel purchases. Use EV Charging for electric vehicle charging sessions or networks. Use Utilities for power, water, internet, phone, and recurring household bills. Use Travel for hotels, rideshare, transit, parking, flights, and car rentals. Use Health for pharmacy, medical, dental, fitness, and personal care. Use Home for hardware, furniture, home improvement, and garden supplies. Use Subscriptions for recurring memberships or digital services. If multiple categories match, choose the category with the largest spend or strongest receipt evidence. Use Miscellaneous only when evidence is unclear. line_items is an array of {description, amount}. Use null for unknown scalar values and [] for unknown line_items.`

    const anthropicBody = {
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `OCR_TEXT:\n\n${raw_text}\n\nReturn JSON only.`
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
      const text = await resp.text()
      return jsonResponse({ error: 'Anthropic error', detail: text }, 500)
    }

    const anthropicJson = await resp.json()
    const assistantText = anthropicJson?.content
      ?.map((part: { type?: string; text?: string }) => part.type === 'text' ? part.text ?? '' : '')
      .join('\n')
      .trim()

    if (!assistantText) {
      return jsonResponse({ error: 'Empty Anthropic response', detail: anthropicJson }, 500)
    }

    try {
      const parsed = JSON.parse(extractJsonObject(assistantText))
      return jsonResponse(parsed)
    } catch (_err) {
      return jsonResponse({ error: 'Failed to parse assistant JSON', assistantText }, 500)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function extractJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found')
  }
  return text.slice(start, end + 1)
}
