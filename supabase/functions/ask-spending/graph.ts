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
import { SystemMessage } from '@langchain/core/messages'
import type { ChatGroq } from '@langchain/groq'
import type { makeTools } from './tools.ts'

type Tools = ReturnType<typeof makeTools>

export function buildGraph(opts: { model: ChatGroq; tools: Tools; systemPrompt: () => string }) {
  const modelWithTools = opts.model.bindTools(opts.tools)

  // STATE: MessagesAnnotation = { messages: BaseMessage[] } with an APPEND
  // reducer. A node returns only what it adds; LangGraph merges it in.

  // AGENT NODE: the thinking step. Reads the conversation, calls the model,
  // returns the reply as an update. It never decides where to go next.
  // The system prompt is added on every call but never stored in state, so
  // the date stays fresh and the history holds no duplicates.
  // `config` is passed through so tracing and cancellation reach the model.
  async function agent(state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) {
    const reply = await modelWithTools.invoke([new SystemMessage(opts.systemPrompt()), ...state.messages], config)
    return { messages: [reply] }
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
