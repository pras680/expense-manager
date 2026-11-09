// ask-spending — "Ask about your spending" chat agent.
//
// Built in stages as a LangGraph learning exercise; see docs/learn-langgraph/.
// STAGE 3: the agent is a LangGraph graph (graph.ts). It loops model → tools
// → model until the model answers, capped by RECURSION_LIMIT. Tools are the
// same as Stage 2 (tools.ts).
//
// Secrets:
// - CHAT_LLM_API_KEY  a Groq key SEPARATE from parse-receipt's LLM_API_KEY.
// - CHAT_MODEL        optional; must support tool calling.
// - LANGSMITH_*        optional; tracing (see tracing.ts).
// Injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY.

import { ChatGroq } from '@langchain/groq'
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { GraphRecursionError } from '@langchain/langgraph'
import { makeTools, type RpcCaller } from './tools.ts'
import { buildGraph, isToolUseFailed } from './graph.ts'
import { flushTraces, hashUser, tracingConfig, tracingEnabled } from './tracing.ts'

const CHAT_LLM_API_KEY = Deno.env.get('CHAT_LLM_API_KEY')
const CHAT_MODEL = Deno.env.get('CHAT_MODEL') ?? 'llama-3.3-70b-versatile'
// Groq counts max_tokens against the model's OUTPUT-tokens-per-minute limit
// BEFORE generating (free tier qwen: 1000/min). 1024 made every call fail with
// 429; and a 3-round question makes 3 calls. Answers are short by design
// (system prompt), so 300 is ample. Raise via CHAT_MAX_TOKENS on a paid tier.
const CHAT_MAX_TOKENS = Number(Deno.env.get('CHAT_MAX_TOKENS') ?? 300)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const MAX_MESSAGE_CHARS = 1_000
// Prior turns the client sends so follow-ups ("and last month?") resolve.
// Only the visible text of each turn is replayed, never tool results, so
// history costs input tokens roughly equal to what the user can see on screen.
const MAX_HISTORY_TURNS = 10
const MAX_HISTORY_TURN_CHARS = 2_000
const TIME_ZONE = 'Asia/Singapore'
// Each node run is one "step". agent + tools = 2 steps per lookup round, so 10
// allows about 4 rounds of lookups plus the final answer. Caps Groq spend if
// the model keeps asking for data.
const RECURSION_LIMIT = 10

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

// Per model call. A question makes up to ~5 calls; without a cap a stalled
// upstream outlives the client's connection and Safari reports "Load failed".
const CHAT_CALL_TIMEOUT_MS = 20_000

// Built lazily: ChatGroq's constructor THROWS without a key (see lesson 01).
// Two instances: temperature 0 normally, a little higher only for retrying a
// malformed tool call (graph.ts), where 0 would likely repeat the same output.
const models = new Map<number, ChatGroq>()
function getModel(temperature = 0): ChatGroq {
  let m = models.get(temperature)
  if (!m) {
    m = new ChatGroq({
      apiKey: CHAT_LLM_API_KEY,
      model: CHAT_MODEL,
      temperature,
      maxTokens: CHAT_MAX_TOKENS,
      timeout: CHAT_CALL_TIMEOUT_MS,
      maxRetries: 0, // a 429 retried in-request just hangs; the client shows a Retry button instead
      // Qwen models on Groq "think" first by default, and those hidden reasoning
      // tokens count as OUTPUT tokens against the same per-minute limit.
      // parse-receipt turns it off for the same reason. Other model families
      // don't take this parameter, so only send it to qwen.
      ...(CHAT_MODEL.startsWith('qwen/') ? { reasoningEffort: 'none' as const } : {})
    })
    models.set(temperature, m)
  }
  return m
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  // verify_jwt has checked the signature upstream; we require a real user.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (jwtRole(bearer) !== 'authenticated') return jsonResponse({ error: 'Unauthorized' }, 401)
  if (!CHAT_LLM_API_KEY) return jsonResponse({ error: 'Chat is not configured' }, 503)

  let message: string
  let history: BaseMessage[]
  try {
    const payload = await req.json()
    message = String(payload?.message ?? '').trim()
    history = parseHistory(payload?.history)
  } catch {
    return jsonResponse({ error: 'Body must be JSON: {"message": "...", "history"?: [...]}' }, 400)
  }
  if (!message) return jsonResponse({ error: 'message is required' }, 400)
  if (message.length > MAX_MESSAGE_CHARS) return jsonResponse({ error: 'message is too long' }, 413)

  // Tools are built PER REQUEST so they close over this caller's JWT: every
  // query runs as this user, and RLS decides what they can see.
  const apikey = req.headers.get('apikey') ?? SUPABASE_ANON_KEY
  const callRpc: RpcCaller = async (fn, args) => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    })
    if (!resp.ok) {
      console.error(`rpc ${fn} failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
      throw new Error(`${fn} failed with status ${resp.status}`)
    }
    return resp.json()
  }
  const tools = makeTools(callRpc)

  // Built per request because the tools close over THIS caller's JWT.
  // Compiling a two-node graph is cheap (no I/O). See lesson 03 for the
  // build-once alternative using config.configurable.
  const graph = buildGraph({ model: getModel(0), retryModel: getModel(0.6), tools, systemPrompt })

  // Our own id for this run, so the response can carry it (later: thumbs
  // up/down from the Ask page is attached to it as LangSmith feedback).
  const runId = crypto.randomUUID()

  try {
    // invoke() runs the graph to END and returns the final STATE — the whole
    // conversation, including every tool request and result along the way.
    // runName/tags/metadata label the trace in LangSmith; every node, model
    // call and tool call nests under it automatically.
    const final = await graph.invoke(
      { messages: [...history, new HumanMessage(message)] },
      {
        recursionLimit: RECURSION_LIMIT,
        runId,
        runName: 'ask-spending',
        tags: ['ask-spending', 'stage-3'],
        metadata: { model: CHAT_MODEL, max_tokens: CHAT_MAX_TOKENS, user_hash: await hashUser(jwtSub(bearer)) },
        ...tracingConfig()
      }
    )
    return jsonResponse({
      reply: lastText(final.messages),
      ...summarise(final.messages),
      run_id: tracingEnabled ? runId : null
    })
  } catch (err) {
    // The model kept asking for data past the step limit. Not a server
    // fault: answer politely instead of failing the request.
    if (err instanceof GraphRecursionError) {
      console.warn(`ask-spending hit recursionLimit ${RECURSION_LIMIT}`)
      return jsonResponse({
        reply: "That needed more lookups than I'm allowed for one question. Try asking about a narrower period or one thing at a time.",
        tool_calls: [],
        steps_exhausted: true,
        run_id: tracingEnabled ? runId : null
      })
    }
    console.error(`ask-spending failed: ${err instanceof Error ? err.message : err}`)
    const { status, code, error } = classifyError(err)
    return jsonResponse({ error, code }, status)
  } finally {
    // Failed runs are traced too (that's when you most need them).
    await flushTraces()
  }
})

// What the graph did, read back out of the final state: every tool the model
// asked for (in order), which ones failed, and total tokens across all model
// calls. Returned for learning/debugging; LangSmith (Stage 6) replaces this.
function summarise(messages: BaseMessage[]) {
  const trace: { round: number; tool: string; args: unknown; error?: string }[] = []
  const byId = new Map<string, (typeof trace)[number]>()
  let round = 0, inputTokens = 0, outputTokens = 0
  for (const m of messages) {
    if (m instanceof AIMessage) {
      inputTokens += m.usage_metadata?.input_tokens ?? 0
      outputTokens += m.usage_metadata?.output_tokens ?? 0
      if (m.tool_calls?.length) {
        round++
        for (const c of m.tool_calls) {
          const entry = { round, tool: c.name, args: c.args }
          trace.push(entry)
          if (c.id) byId.set(c.id, entry)
        }
      }
    } else if (m instanceof ToolMessage && m.status === 'error') {
      const entry = byId.get(m.tool_call_id)
      if (entry) entry.error = String(m.content).slice(0, 200)
    }
  }
  return { tool_calls: trace, rounds: round, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }
}

// `code` lets the app pick wording and offer Retry; `error` is a readable fallback.
function classifyError(err: unknown): { status: number; code: string; error: string } {
  const e = err as { status?: number; name?: string; message?: string }
  const msg = typeof e?.message === 'string' ? e.message : ''
  if (e?.status === 429) {
    return { status: 429, code: 'rate_limited', error: "I'm getting too many questions right now. Try again in a minute." }
  }
  if (e?.status === 413 || /request too large/i.test(msg)) {
    return { status: 413, code: 'too_large', error: 'That needed more data than I can read at once. Try a shorter period or a more specific question.' }
  }
  if (isToolUseFailed(err)) {
    return { status: 502, code: 'tool_call_failed', error: 'I tripped over my own lookup. Try asking again, or rephrase it.' }
  }
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'TimeoutError' || /timed? ?out/i.test(msg)) {
    return { status: 504, code: 'timeout', error: 'That took too long to look up. Try again, or ask something narrower.' }
  }
  return { status: 502, code: 'failed', error: 'Something went wrong answering that. Try again.' }
}

// Client-supplied, so treated as untrusted: only user/assistant roles (a
// forged "system" or "tool" turn could steer the agent), text only, capped.
function parseHistory(raw: unknown): BaseMessage[] {
  if (!Array.isArray(raw)) return []
  const turns: BaseMessage[] = []
  for (const t of raw.slice(-MAX_HISTORY_TURNS)) {
    const content = typeof t?.content === 'string' ? t.content.trim().slice(0, MAX_HISTORY_TURN_CHARS) : ''
    if (!content) continue
    if (t.role === 'user') turns.push(new HumanMessage(content))
    else if (t.role === 'assistant') turns.push(new AIMessage(content))
  }
  return turns
}

function lastText(messages: BaseMessage[]): string {
  const last = messages.at(-1)
  if (!last) return ''
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
}

function systemPrompt(): string {
  // The model has no clock and no idea what "last month" means for this user,
  // so we hand it today's date in the household's timezone (not UTC — at
  // 07:00 SGT on the 1st, UTC is still on the previous month).
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now) // yyyy-mm-dd
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'long' }).format(now)
  return [
    `You answer questions about a household's spending, using the tools to look up real data.`,
    `Today is ${weekday} ${today} (${TIME_ZONE}). Amounts are in SGD.`,
    `"Last month" means the whole previous calendar month; "this month" means from the 1st to today;`,
    `"in the last N months" means from the same day N months ago up to today.`,
    `For questions about specific products bought (items on a receipt), use search_purchased_items.`,
    `Never guess or invent numbers: if a question needs data, call a tool. If the tools return nothing, say so.`,
    `Earlier answers in this conversation are context only. For a follow-up (a new period, category or merchant),`,
    `look the figures up again; never add up, subtract or reuse numbers from earlier answers.`,
    `Category names: Groceries, Food & Dining, Electronics, Clothing, Entertainment, Fuel, EV Charging, Utilities,`,
    `Travel, Commute, Health, Home, Subscriptions, Services, Local Transfer, Credit Card Bill Payment,`,
    `ATM Cash Withdrawal, Miscellaneous (households may add their own).`,
    `Answer briefly: the number first, then at most two sentences of context.`
  ].join('\n')
}

function jwtSub(token: string): string | null {
  return jwtClaim(token, 'sub')
}

function jwtRole(token: string): string | null {
  return jwtClaim(token, 'role')
}

function jwtClaim(token: string, name: string): string | null {
  const segments = token.split('.')
  if (segments.length !== 3) return null
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded))
    return typeof claims?.[name] === 'string' ? claims[name] : null
  } catch {
    return null
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}
