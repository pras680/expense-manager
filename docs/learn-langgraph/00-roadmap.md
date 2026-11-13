# Learning LangGraph by building "Ask about your spending"

A chat page in the webapp where household members ask questions like
"how much did we spend on Grab last month?" or "why was October higher than
September?". Built in stages; each stage adds one LangChain/LangGraph idea and
ends with something you can run.

**Decisions (fixed up front)**
- Runtime: new Supabase Edge Function `supabase/functions/ask-spending` (Deno, LangChain.js / LangGraph.js). No new server.
- LLM: Groq, with its **own** key `CHAT_LLM_API_KEY`, so chat can never drain `parse-receipt`'s quota.
- Data access: the agent calls typed Postgres RPCs **with the user's own JWT**, so RLS and household visibility apply exactly as they do in the app. No text-to-SQL, no service-role key.
- Spending maths must match the Reports pages: exclude `Local Transfer` and `Credit Card Bill Payment`; use `total`, falling back to `converted_total`.

| Stage | You'll learn | You'll have |
|---|---|---|
| 1 | Chat models, typed messages, `invoke()`, token usage | Function that answers (without data) |
| 2 | Tools: `tool()` + zod schemas, `bindTools`, tool calls | Security-invoker RPCs + tools; model *requests* data |
| 3 | `StateGraph`, state/annotations, nodes, conditional edges, `ToolNode`, the agent loop, recursion limits | A real agent that answers from your data |
| 4 | Memory: client-sent history vs checkpointers (`thread_id`) | Follow-up questions work ("and the month before?") |
| 5 | Streaming (`streamMode`), the chat UI | `/ask` page in the PWA with streamed answers |
| 6 | LangSmith tracing, then a small eval dataset | Every conversation traced; regression tests for questions |

Lessons: `01-chat-models.md`, `02-tools.md`, … one per stage.
