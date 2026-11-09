// Chat model providers, in the order they're tried.
//
// Primary is Groq (CHAT_LLM_API_KEY / CHAT_MODEL). Fallbacks are any
// OpenAI-compatible provider, numbered from 1, each configured by:
//   CHAT_LLM_API_KEY_FB<n>          required
//   CHAT_LLM_API_URL_FB<n>          required, the base URL (…/v1)
//   CHAT_LLM_MODEL_FB<n>            required, must support tool calling
//   CHAT_LLM_TEMPERATURE_FB<n>      optional; unset = provider default (some
//                                   reasoning models reject anything else)
//   CHAT_LLM_MAX_TOKENS_FB<n>       optional, default 1000
// A fallback is a separate account's quota, so it's tried when Groq fails a
// call (most often its per-minute token limit), not by rotating Groq keys:
// Groq's limits are per organization, so its keys all share one budget.

import { ChatGroq } from '@langchain/groq'
import { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

const CHAT_MODEL = Deno.env.get('CHAT_MODEL') ?? 'llama-3.3-70b-versatile'
// Groq counts max_tokens against the model's OUTPUT-tokens-per-minute limit
// BEFORE generating (free tier qwen: 1000/min). 1024 made every call fail with
// 429; and a 3-round question makes 3 calls. Answers are short by design
// (system prompt), so 300 is ample. Raise via CHAT_MAX_TOKENS on a paid tier.
const CHAT_MAX_TOKENS = Number(Deno.env.get('CHAT_MAX_TOKENS') ?? 300)
// Per model call. A question makes up to ~5 calls; without a cap a stalled
// upstream outlives the client's connection and Safari reports "Load failed".
const CHAT_CALL_TIMEOUT_MS = 20_000
const MAX_FALLBACKS = 9

export interface Provider {
  name: string
  model: string
  /** Temperature 0 normally; `warm` only to retry a malformed tool call (graph.ts). */
  chat(warm: boolean): BaseChatModel
}

function groqProvider(apiKey: string): Provider {
  const cache = new Map<boolean, ChatGroq>()
  return {
    name: 'groq',
    model: CHAT_MODEL,
    chat(warm) {
      let m = cache.get(warm)
      if (!m) {
        m = new ChatGroq({
          apiKey,
          model: CHAT_MODEL,
          temperature: warm ? 0.6 : 0,
          maxTokens: CHAT_MAX_TOKENS,
          timeout: CHAT_CALL_TIMEOUT_MS,
          maxRetries: 0, // failures go to the next provider (graph.ts), not a hidden in-request retry
          // Qwen models on Groq "think" first by default, and those hidden reasoning
          // tokens count as OUTPUT tokens against the same per-minute limit.
          // parse-receipt turns it off for the same reason. Other model families
          // don't take this parameter, so only send it to qwen.
          ...(CHAT_MODEL.startsWith('qwen/') ? { reasoningEffort: 'none' as const } : {})
        })
        cache.set(warm, m)
      }
      return m
    }
  }
}

function fallbackProvider(n: number): Provider | null {
  const apiKey = Deno.env.get(`CHAT_LLM_API_KEY_FB${n}`)
  if (!apiKey) return null
  const baseURL = Deno.env.get(`CHAT_LLM_API_URL_FB${n}`)
  const model = Deno.env.get(`CHAT_LLM_MODEL_FB${n}`)
  if (!baseURL || !model) {
    console.warn(`ask-spending: CHAT_LLM_API_KEY_FB${n} is set but CHAT_LLM_API_URL_FB${n}/CHAT_LLM_MODEL_FB${n} are not; fallback ${n} skipped`)
    return null
  }
  const temperatureRaw = Deno.env.get(`CHAT_LLM_TEMPERATURE_FB${n}`)
  const temperature = temperatureRaw ? Number(temperatureRaw) : undefined
  const maxTokens = Number(Deno.env.get(`CHAT_LLM_MAX_TOKENS_FB${n}`) ?? 1000)
  // Same instance either way: with no temperature configured there's nothing
  // to warm, and a configured one is the operator's choice.
  let m: ChatOpenAI | null = null
  return {
    name: `fb${n}`,
    model,
    chat() {
      m ??= new ChatOpenAI({
        apiKey,
        model,
        configuration: { baseURL },
        ...(temperature !== undefined && Number.isFinite(temperature) ? { temperature } : {}),
        maxTokens,
        timeout: CHAT_CALL_TIMEOUT_MS,
        maxRetries: 0
      })
      return m
    }
  }
}

/** Primary first. Empty when CHAT_LLM_API_KEY is unset (chat not configured). */
export function loadProviders(): Provider[] {
  const primaryKey = Deno.env.get('CHAT_LLM_API_KEY')
  if (!primaryKey) return []
  const providers = [groqProvider(primaryKey)]
  for (let n = 1; n <= MAX_FALLBACKS; n++) {
    const p = fallbackProvider(n)
    if (p) providers.push(p)
  }
  return providers
}

export const MODEL_SETTINGS = { model: CHAT_MODEL, maxTokens: CHAT_MAX_TOKENS }
