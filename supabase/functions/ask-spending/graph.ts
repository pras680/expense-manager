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
import type { ChatGroq } from '@langchain/groq'
import type { makeTools } from './tools.ts'

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

export function buildGraph(opts: { model: ChatGroq; retryModel: ChatGroq; tools: Tools; systemPrompt: () => string }) {
  const modelWithTools = opts.model.bindTools(opts.tools)
  const retryWithTools = opts.retryModel.bindTools(opts.tools)
  const mustUseTool = opts.model.bindTools(opts.tools, { tool_choice: 'required' })

  // STATE: MessagesAnnotation = { messages: BaseMessage[] } with an APPEND
  // reducer. A node returns only what it adds; LangGraph merges it in.

  // AGENT NODE: the thinking step. Reads the conversation, calls the model,
  // returns the reply as an update. It never decides where to go next.
  // The system prompt is added on every call but never stored in state, so
  // the date stays fresh and the history holds no duplicates.
  // `config` is passed through so tracing and cancellation reach the model.
  async function agent(state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) {
    const system = opts.systemPrompt()
    let reply = await invokeWithRetries(modelWithTools, system, state.messages, config)
    if (!reply.tool_calls?.length && hasNumber(reply) && !lookedUpThisTurn(state.messages)) {
      console.warn('ask-spending: answered with figures but no lookup; forcing a tool call')
      reply = await invokeWithRetries(mustUseTool, `${system}\n${MUST_LOOK_UP_NOTE}`, state.messages, config)
    }
    return { messages: [reply] }
  }

  // The note joins the one leading system message: some chat templates
  // (Qwen's included) reject a system message anywhere but first.
  async function invokeWithRetries(
    bound: typeof modelWithTools, system: string, messages: BaseMessage[], config: LangGraphRunnableConfig
  ): ReturnType<typeof modelWithTools.invoke> {
    for (let attempt = 0; ; attempt++) {
      try {
        return attempt === 0
          ? await bound.invoke([new SystemMessage(system), ...messages], config)
          : await retryWithTools.invoke([new SystemMessage(`${system}\n${RETRY_NOTE}`), ...messages], config)
      } catch (err) {
        if (!isToolUseFailed(err) || attempt >= TOOL_CALL_RETRIES) throw err
        console.warn(`ask-spending: malformed tool call, retry ${attempt + 1}/${TOOL_CALL_RETRIES}`)
      }
    }
  }

  return new StateGraph(MessagesAnnotation)
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
}
