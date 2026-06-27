import { serve } from 'std/server'

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

    const systemPrompt = `Extract structured receipt data from OCR text. Respond with one valid JSON object only. Keys: merchant, date, total, currency, extracted_digits, category, line_items. date must be yyyy-mm-dd when possible. total must be numeric. currency must be a 3-letter code, default USD when unclear. extracted_digits is any detected payment card last digits. category must be one of Groceries, EV Charging, Restaurant, Entertainment, Subscriptions, Utilities, Miscellaneous. line_items is an array of {description, amount}. Use null for unknown scalar values and [] for unknown line_items.`

    const anthropicBody = {
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
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
