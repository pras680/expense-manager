# Stage 3 — The agent as a LangGraph graph

Code: `supabase/functions/ask-spending/graph.ts` (new), `index.ts` (now calls the graph).
`tools.ts` is unchanged: same five tools as Stage 2.

## What changed

Stage 2 ran exactly one round of tools by hand, then gave up. Stage 3 hands
the loop to LangGraph:

```
START → agent ──(tool_calls?)──→ tools ─┐
          ▲  └──(no tool calls)──→ END  │
          └─────────────────────────────┘
```

```ts
new StateGraph(MessagesAnnotation)
  .addNode('agent', agent)
  .addNode('tools', new ToolNode(tools))
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', toolsCondition, ['tools', END])
  .addEdge('tools', 'agent')
  .compile()
```

That is the whole agent. Everything below explains one line of it.

## The pieces, mapped to the code

| Piece | In graph.ts | What it does |
|---|---|---|
| State | `MessagesAnnotation` | `{ messages: [] }` with an **append** reducer: a node returns only what it adds |
| Agent node | `agent(state, config)` | Calls the model with system prompt + `state.messages`; returns `{ messages: [reply] }` |
| Tools node | `new ToolNode(tools)` | Runs every tool call in the last AIMessage, in parallel; appends a ToolMessage per call |
| Decision | `addConditionalEdges('agent', toolsCondition, …)` | `tool_calls` present → `tools`, else `END` |
| Loop | `addEdge('tools', 'agent')` | After tools, always let the model look again |
| Step cap | `recursionLimit: 10` in `index.ts` | Each node run is one step; 10 ≈ 4 lookup rounds + the answer |

`graph.invoke({ messages: [new HumanMessage(q)] }, { recursionLimit })` runs to
END and returns the **final state**: the whole conversation including every
tool request and result. `index.ts` reads the reply and a `tool_calls` trace
out of it (`summarise()`).

## Behaviour you get for free (all tested against a fake Groq + database)

| Scenario | What happens |
|---|---|
| "cheese pizza" finds 0 | Model searches again ("pizza"), finds 3, answers. **2 rounds**; Stage 2 couldn't |
| Model asks for two tools at once | ToolNode runs both in parallel; each result carries its own `tool_call_id` |
| Model sends `from: "Oct 1"` | zod rejects it; ToolNode turns that into an error ToolMessage; the model reads it, fixes the date, retries |
| Database returns 500 | Same: error ToolMessage, the model apologises; the request does not crash |
| Model never stops asking | `GraphRecursionError` after 10 steps; `index.ts` returns a polite "too many lookups" reply |

Error handling is ToolNode's default (`handleToolErrors: true`). It appends
"Please fix your mistakes." to the error, which nudges the model to retry.

## Design choices worth noticing

- **System prompt added in the node, not stored in state.** Every model call
  gets a fresh "today", and the history never accumulates copies of it.
- **`config` passed to the model.** LangGraph threads callbacks and
  cancellation through it, which is how LangSmith will nest each model call
  under its node (Stage 6) and how a closed browser tab can cancel (Stage 5).
- **Graph compiled per request**, because the tools close over the caller's
  JWT. Compiling two nodes is cheap (no I/O). The alternative: compile once at
  module level and pass the caller's RPC function at run time through
  `config.configurable`. Tools read it from their `config` argument. Use that
  when the graph is big; here, per-request is clearer.
- **Tokens add up per round.** The response's `usage` sums every model call.
  The retry example used 3 calls; watch this number when you try real questions.

## Run it
1. If you haven't yet: run `supabase-edge/multiuser-21-ask-spending-rpcs.sql`.
2. Deploy from the repo root: `supabase functions deploy ask-spending --project-ref <ref>`
3. Try questions that need more than one lookup:
   - "Compare my grocery spend in September and October, and name the top grocery merchant in October"
   - "How many times have I eaten cheese pizza in the last 2 months?"
   - "What did I spend more on last month, dining or groceries, and where?"
   Check `rounds` and `tool_calls` in the response.

## Try this
- Set `RECURSION_LIMIT = 2` and ask the comparison question: you'll get the
  "too many lookups" reply. Put it back.
- Delete `.addEdge('tools', 'agent')`. The graph now ends after tools run, so
  the reply is raw JSON from a tool. That edge *is* the loop.

**Next, Stage 4:** memory. Right now every question starts from nothing, so
"and the month before?" has no idea what "the month" was.
