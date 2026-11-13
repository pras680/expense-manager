# Stage 2 — Tools

Code: `supabase/functions/ask-spending/tools.ts`, `index.ts`;
SQL: `supabase-edge/multiuser-21-ask-spending-rpcs.sql`.

## The big idea: the model never runs anything

Tool calling is a **two-call protocol**:

```
call 1  [system, human]                         → AIMessage{ tool_calls: [{id, name, args}] }
you     run the tool(s) yourself                → ToolMessage{ content, tool_call_id }
call 2  [system, human, AIMessage, ToolMessage] → AIMessage{ content: "You spent S$412.30…" }
```

The model only ever produces *text that describes a function call*. Your code
decides whether and how to run it. That's why the data layer is safe: the
model can only ask for the four things we expose, and each runs as the
signed-in user.

## The pieces

**`tool(fn, { name, description, schema })`** (tools.ts). The schema is a zod
object; LangChain converts it to JSON Schema and sends it with the request. It
also **validates** the model's args before `fn` runs: a model that sends
`from: "Oct 1"` gets a validation error instead of a bad SQL query.
**The description is a prompt.** It's the only thing that tells the model when to
use the tool, so write it for the model ("Use for 'how much on X'…").

**`model.bindTools(tools)`** returns a new Runnable that attaches the tool
schemas to every call. The original model is unchanged.

**`AIMessage.tool_calls`** is LangChain's provider-neutral shape
`[{ id, name, args }]`. Groq, OpenAI and Anthropic all format this differently
on the wire; you never see that.

**`ToolMessage({ content, tool_call_id })`** returns the result. The id must
match: providers reject a conversation with an unanswered tool call. Tool
errors are sent *back to the model* as text (`status: 'error'`), not thrown, so
it can recover or explain.

## Design choices worth noticing
- **Typed RPCs, not text-to-SQL.** Four `SECURITY INVOKER` functions, called
  with the user's JWT. RLS still decides visibility. A prompt injection
  inside a receipt can, at worst, make the model call one of these four
  read-only functions with odd arguments.
- **Tools are built per request** (`makeTools(callRpc)`) so they close over
  *this* caller's token. A module-level tool would need a credential of its
  own, which would mean the service role, and that bypasses RLS.
- **Same maths as Reports.** Transfers and card-bill payments are excluded
  from totals; receipts are bucketed by Singapore-local day. The SQL was
  tested against `date`, `timestamptz` and text-typed `date` columns.
- **The model gets today's date in Asia/Singapore**, not UTC. On the 1st
  before 08:00 SGT, UTC is still in the previous month.

## Stage 2b — searching what you bought (`raw_ocr_json`)

Photo/PDF receipts keep the parser's `line_items` (`[{description, amount}]`)
inside `raw_ocr_json`. The new tool `search_purchased_items` answers "how many
times have I had cheese pizza in the last 2 months?":

- **One tool, two RPCs.** It calls `ask_line_item_summary` (the counts) and
  `ask_find_line_items` (the rows) in parallel and returns both. A tool is
  just a function, so shape its output like the answer you want.
- **Postgres counts, the model doesn't.** LLMs miscount lists. `times_bought`
  comes back as a number, and the model only has to read it.
- **Matching is all-words, any order**, so "cheese pizza" finds
  "PIZZA - CHEESE 12in". The description tells the model to use singular
  terms and to retry with variants. Retrying needs a loop (Stage 3).
- **Honest gaps.** Emailed receipts often have no line items, only text.
  `other_receipts_mentioning` counts those separately, so the model can say
  "3 times, possibly 1 more" instead of under-counting silently.

**A bug this fixed.** Stage 2's SQL used `coalesce(total, converted_total)`
and the `category` column only. The webapp (`receiptShape.ts`) is subtler.
Fields fall back to `raw_ocr_json` when the column is empty. A foreign-currency
receipt counts as its `converted_total`, and its raw `total` is used only when
the currency already matches the reporting currency. All of that now lives in
**one security-invoker view, `ask_receipts`**, and every function reads from
it, so the chat's numbers match Reports and there is one place to fix next
time. Lesson: when an agent reports numbers, put the business rules in the
data layer, never in the prompt.

## The limitation (on purpose)
`index.ts` runs **one** round of tools by hand. Ask "compare groceries in
September vs October and tell me the top 3 merchants": the model may want a
second round after seeing the first results, and the hand-written code gives
up. You could write a `while` loop… and you'd be rebuilding LangGraph badly.
That's Stage 3.

## Run it
1. Run `supabase-edge/multiuser-21-ask-spending-rpcs.sql` in the SQL editor
   (needs multiuser-19 applied, for `converted_total`).
2. Deploy from the repo root: `supabase functions deploy ask-spending --project-ref <ref>`
3. Try, with a fresh user token:
   - "How much did I spend on groceries last month?"
   - "Top 5 merchants this month"
   - "When did I last pay my credit card bill?" (`find_receipts`, which includes transfers)
   - "How many times have I eaten cheese pizza in the last 2 months?"
   - "What's the capital of France?" (no tool call; `tool_calls` comes back empty)

The response includes `tool_calls`: exactly what the model asked for. Check
its dates. Wrong date maths is the most common agent bug, and the system
prompt is where you fix it.

## Try this
- Delete the "Use for…" sentence from one tool's description and see whether
  the model still picks it.
- Ask something that needs two lookups and watch it hit the one-round limit.
