// The agent as a LangGraph graph. STAGE 3.
//
//   START → agent ──(tool_calls?)──→ tools ─┐
//             ▲  └──(no tool calls)──→ END  │
//             └─────────────────────────────┘
//
// Replaces Stage 2's hand-written "one round of tools" in index.ts. The graph
// keeps looping agent → tools → agent until the model answers without asking
// for more data, or the step limit (recursionLimit, set by the caller) is hit.

import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { makeTools } from './tools.ts'
import type { Provider } from './providers.ts'

type Tools = ReturnType<typeof makeTools>

// Groq parses the model's tool-call text server-side and rejects the whole
// request (400 tool_use_failed) when it's malformed, e.g. "< parameter=item>".
// It's a sampling glitch, so retry, but not identically: at temperature 0 the
// same input tends to reproduce the same bad output.
const TOOL_CALL_RETRIES = 2
const RETRY_NOTE =
  'Your previous tool call was malformed and rejected. Call the tool again, ' +
  'passing every required argument exactly as the schema names it.'

export function isToolUseFailed(err: unknown): boolean {
  const e = err as { error?: { error?: { code?: string }; code?: string }; message?: string }
  return e?.error?.error?.code === 'tool_use_failed' || e?.error?.code === 'tool_use_failed' ||
    (typeof e?.message === 'string' && e.message.includes('tool_use_failed'))
}

// With history, the model can "answer" a follow-up by reworking figures from
// its earlier replies instead of looking anything up, and invent the rest
// (seen live: a weekend total smaller than one of its own categories). A
// reply carrying numbers with no lookup since the user's latest message gets
// one more try with a tool call required.
const MUST_LOOK_UP_NOTE =
  'You must look the figures up for this question with a tool. Earlier answers ' +
  'in the conversation are context only; never reuse or recompute their numbers.'

function lookedUpThisTurn(messages: BaseMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof ToolMessage) return true
    if (messages[i] instanceof HumanMessage) return false
  }
  return false
}

function hasNumber(reply: { content: unknown }): boolean {
  return typeof reply.content === 'string' && /\d/.test(reply.content)
}

// Two fallback-model failure modes seen live (Kimi and Gemini via Vercel's
// gateway): a reply with neither text nor a tool call, which reached the user
// as a blank answer; and re-requesting a lookup it already has, looping until
// the step limit. Both get one re-ask with tools switched off, so the model
// has to answer from the results it already holds.
const ANSWER_NOW_NOTE =
  'You already have the lookup results you need above. Answer the question now, in words, from those results.'

function replyText(reply: { content: unknown }): string {
  if (typeof reply.content === 'string') return reply.content
  if (Array.isArray(reply.content)) {
    return reply.content.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join('')
  }
  return ''
}

function isEmptyReply(reply: { content: unknown; tool_calls?: unknown[] }): boolean {
  return !reply.tool_calls?.length && replyText(reply).trim() === ''
}

function lookupKey(call: { name: string; args: Record<string, unknown> }): string {
  const args = Object.keys(call.args ?? {}).sort().map((k) => [k, call.args[k]])
  return `${call.name}:${JSON.stringify(args)}`
}

/** True when every lookup the reply asks for was already run, with the same arguments, for this question. */
function repeatsLookups(reply: { tool_calls?: { name: string; args: Record<string, unknown> }[] }, messages: BaseMessage[]): boolean {
  if (!reply.tool_calls?.length) return false
  const done = new Set<string>()
  for (let i = messages.length - 1; i >= 0 && !(messages[i] instanceof HumanMessage); i--) {
    const m = messages[i] as { tool_calls?: { name: string; args: Record<string, unknown> }[] }
    for (const c of m.tool_calls ?? []) done.add(lookupKey(c))
  }
  return reply.tool_calls.every((c) => done.has(lookupKey(c)))
}

// When every provider fails and Groq said how long to wait (its per-minute
// window, typically ~10s), wait once and try it again rather than fail. Capped
// per question so a long wait can't outlast the client's patience.
const MAX_SINGLE_WAIT_S = 15
const MAX_TOTAL_WAIT_S = 20

export function isRateLimited(err: unknown): boolean {
  return (err as { status?: number })?.status === 429
}

/** Seconds the provider asked us to wait, from retry-after or Groq's "try again in 1m2.5s". */
export function retryAfterSeconds(err: unknown): number | null {
  const e = err as { headers?: unknown; message?: string }
  const h = e?.headers as { get?: (k: string) => string | null } & Record<string, string> | undefined
  const header = typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after']
  const fromHeader = header ? Number(header) : NaN
  if (Number.isFinite(fromHeader)) return fromHeader
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(e?.message ?? '')
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null
}

function describe(err: unknown): string {
  const e = err as { status?: number; message?: string }
  return `${e?.status ?? ''} ${(e?.message ?? String(err)).slice(0, 160)}`.trim()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A provider that just rate-limited us goes to the back of the queue until its
// wait passes, rather than being re-asked (and refused) first on every model
// call. Module-level, so it also spans requests on a warm worker. 30s when
// the provider didn't say how long.
const coolingUntil = new Map<string, number>()
const DEFAULT_COOLDOWN_S = 30

type Bound = ReturnType<NonNullable<BaseChatModel['bindTools']>>
/** auto: model decides; required: must call a lookup; none: must answer in words. */
type ToolMode = 'auto' | 'required' | 'none'

export function buildGraph(opts: { providers: Provider[]; tools: Tools; systemPrompt: () => string }) {
  // Bound per request: the tools close over this caller's JWT.
  const bound = opts.providers.map((p) => {
    const bind = (warm: boolean, mode: ToolMode) =>
      p.chat(warm).bindTools!(opts.tools, mode === 'auto' ? undefined : { tool_choice: mode })
    return {
      provider: p,
      auto: bind(false, 'auto'), required: bind(false, 'required'), none: bind(false, 'none'),
      warm: bind(true, 'auto')
    }
  })
  /** Which providers actually answered calls in this request, for the response and logs. */
  const answeredBy = new Set<string>()
  let waitedS = 0

  // STATE: MessagesAnnotation = { messages: BaseMessage[] } with an APPEND
  // reducer. A node returns only what it adds; LangGraph merges it in.

  // AGENT NODE: the thinking step. Reads the conversation, calls the model,
  // returns the reply as an update. It never decides where to go next.
  // The system prompt is added on every call but never stored in state, so
  // the date stays fresh and the history holds no duplicates.
  // `config` is passed through so tracing and cancellation reach the model.
  async function agent(state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) {
    const system = opts.systemPrompt()
    const answerNow = () => callModel('none', `${system}\n${ANSWER_NOW_NOTE}`, state.messages, config)
    let reply = await callModel('auto', system, state.messages, config)
    if (!reply.tool_calls?.length && hasNumber(reply) && !lookedUpThisTurn(state.messages)) {
      console.warn('ask-spending: answered with figures but no lookup; forcing a tool call')
      reply = await callModel('required', `${system}\n${MUST_LOOK_UP_NOTE}`, state.messages, config)
    }
    if (repeatsLookups(reply, state.messages)) {
      console.warn(`ask-spending: model repeated a lookup it already has (${reply.tool_calls!.map((c) => c.name).join(', ')}); asking it to answer`)
      reply = await answerNow()
    } else if (isEmptyReply(reply) && lookedUpThisTurn(state.messages)) {
      const meta = reply.response_metadata as { finish_reason?: string } | undefined
      console.warn(`ask-spending: empty reply (finish_reason=${meta?.finish_reason ?? 'unknown'}); asking again with tools off`)
      reply = await answerNow()
    }
    return { messages: [reply] }
  }

  // Providers in order; the first to answer wins. If all fail, one bounded
  // wait-and-retry on the primary when it was only rate limited; otherwise the
  // primary's error is thrown, since that's the one worth explaining.
  async function callModel(
    mode: ToolMode, system: string, messages: BaseMessage[], config: LangGraphRunnableConfig
  ): ReturnType<Bound['invoke']> {
    const now = Date.now()
    const isCooling = (b: (typeof bound)[number]) => (coolingUntil.get(b.provider.name) ?? 0) > now
    const order = [...bound.filter((b) => !isCooling(b)), ...bound.filter(isCooling)]
    let primaryErr: unknown = null
    for (const b of order) {
      try {
        return await callProvider(b, mode, system, messages, config)
      } catch (err) {
        if (b === bound[0]) primaryErr = err
        if (isRateLimited(err)) {
          coolingUntil.set(b.provider.name, Date.now() + (retryAfterSeconds(err) ?? DEFAULT_COOLDOWN_S) * 1000)
        }
        console.warn(`ask-spending: ${b.provider.name} (${b.provider.model}) failed: ${describe(err)}`)
      }
    }
    const wait = retryAfterSeconds(primaryErr)
    if (isRateLimited(primaryErr) && wait !== null && wait <= MAX_SINGLE_WAIT_S && waitedS + wait <= MAX_TOTAL_WAIT_S) {
      waitedS += wait
      console.warn(`ask-spending: every provider failed; waiting ${wait}s for ${bound[0].provider.name}'s rate limit`)
      await sleep(Math.ceil(wait * 1000) + 250)
      return await callProvider(bound[0], mode, system, messages, config)
    }
    throw primaryErr
  }

  // The note joins the one leading system message: some chat templates
  // (Qwen's included) reject a system message anywhere but first.
  async function callProvider(
    b: (typeof bound)[number], mode: ToolMode, system: string, messages: BaseMessage[], config: LangGraphRunnableConfig
  ): ReturnType<Bound['invoke']> {
    for (let attempt = 0; ; attempt++) {
      try {
        const reply = attempt === 0
          ? await b[mode].invoke([new SystemMessage(system), ...messages], config)
          : await b.warm.invoke([new SystemMessage(`${system}\n${RETRY_NOTE}`), ...messages], config)
        answeredBy.add(b.provider.name)
        coolingUntil.delete(b.provider.name)
        return reply
      } catch (err) {
        if (!isToolUseFailed(err) || attempt >= TOOL_CALL_RETRIES) throw err
        console.warn(`ask-spending: ${b.provider.name} malformed tool call, retry ${attempt + 1}/${TOOL_CALL_RETRIES}`)
      }
    }
  }

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agent)
    // TOOLS NODE: prebuilt. Runs every tool call in the last AIMessage (in
    // parallel), appends one ToolMessage each with the matching tool_call_id.
    // A tool that throws — bad args, failed RPC — becomes an error
    // ToolMessage the model can read and recover from, not a crash.
    .addNode('tools', new ToolNode(opts.tools))
    .addEdge(START, 'agent')
    // The decision: toolsCondition returns 'tools' if the last message has
    // tool_calls, else END. The array lists the possible targets.
    .addConditionalEdges('agent', toolsCondition, ['tools', END])
    // The loop: after tools run, always hand back to the model.
    .addEdge('tools', 'agent')
    .compile()
  return { graph, answeredBy }
}
