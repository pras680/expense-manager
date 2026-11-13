# Stage 6a — LangSmith tracing (moved ahead of Stage 4)

Code: `supabase/functions/ask-spending/tracing.ts` (new), small changes in `index.ts`.

## Setup (done once)

Secrets (this LangSmith org is in **APAC**; keys only work in their region and
the SDK defaults to the US server, so the endpoint is required):

```bash
supabase secrets set --project-ref <ref> LANGSMITH_TRACING=true \
  LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com \
  LANGSMITH_PROJECT=ask-spending "LANGSMITH_API_KEY=lsv2_..."
```

Use a **Tracing Only** key: it can write traces but read nothing, so a leaked
key exposes no data. Evaluation scripts later use a separate personal token
on your machine only.

## What the code does

LangChain and LangGraph trace automatically once those secrets exist. Three
additions make it reliable on an edge function:

1. **Flush.** Traces are sent in background batches, and an edge function can
   be shut down right after it responds. `flushTraces()` waits for pending
   callbacks and batches, inside `EdgeRuntime.waitUntil`, so it runs *after*
   the response is sent: no added latency, no lost traces. It runs in a
   `finally`, so failed runs are traced too.
2. **Our own tracer.** `tracingConfig()` passes a `LangChainTracer` bound to
   our `Client`. That stops LangChain from also creating a default tracer from
   the env vars (no duplicate traces) and gives us the client to flush.
3. **Labels.** Each run gets `runName: 'ask-spending'`, tags
   (`ask-spending`, `stage-3`), metadata (`model`, `max_tokens`, `user_hash`),
   and a `runId` we choose. The response returns it as `run_id`, so a Postman
   response leads straight to its trace (and later, thumbs up/down can attach
   feedback to it). `user_hash` is a salted SHA-256 of the user id: runs can
   be grouped per user without storing who the user is.

Without the secrets, tracing is fully off: no calls to LangSmith, `run_id: null`.

## Reading a trace

Open smith.langchain.com in the APAC region → project **ask-spending**. One
row per question; click it:

```
ask-spending                      ← the whole graph run (input: your question)
├─ agent                          ← node
│  └─ ChatGroq                    ← exact messages + tool schemas sent; reply with tool_calls
├─ tools                          ← node
│  └─ search_purchased_items      ← args in, FULL result out
├─ agent
│  └─ ChatGroq
└─ …
```

What to look at for a wrong answer:
- **ChatGroq input**: did the model have the data it needed?
- **ChatGroq output**: which tool and dates did it choose?
- **Tool output**: what did Postgres actually return? (row caps!)
- **Tokens/latency** per call: where the time and quota went.

## Try this
- Ask "How many times have I eaten Indian in the last 2 months?" and open the
  trace. Find which tool it used and whether the Indian restaurants were in
  the tool output. This is the "before" picture for ADR-0001.
- Filter by tag `stage-3` or metadata `model`; compare a qwen run with a llama run.
