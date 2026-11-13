# Stage 1 — Chat models and messages

Code: `supabase/functions/ask-spending/index.ts` (+ `deno.json` for pinned npm versions).

## The three ideas

**1. A ChatModel is a provider adapter.** `new ChatGroq({...})` wraps Groq's
chat-completions API behind LangChain's common interface. `ChatAnthropic`,
`ChatOpenAI` etc. expose the *same* methods, so everything you build in later
stages (tools, the graph) is provider-neutral. That's most of LangChain's value
at this layer: compare it with `parse-receipt`, which hand-builds the HTTP body
for one provider.

**2. Messages are typed objects.** `SystemMessage`, `HumanMessage`, and (back
from the model) `AIMessage`. In Stage 2 a fourth appears, `ToolMessage`, and in
Stage 3 the whole agent's state becomes "a list of these messages". That's why
they're objects and not `{role, content}` dicts: the graph needs to recognise
an `AIMessage` that contains `tool_calls`.

**3. Everything is a Runnable with `.invoke()`.** Models, tools, prompts and
(later) compiled graphs all share `invoke` / `stream` / `batch`. Learn it once.
The response is an `AIMessage`; `usage_metadata` gives normalised token counts
for any provider.

## Two gotchas this stage already caught
- `ChatGroq`'s constructor **throws** if the API key is missing. Creating it at
  module load would crash the function on boot, so it's built lazily
  (`getModel()`) after the key check.
- LangChain **retries by default** (6 attempts with backoff). On an edge
  function that turns a Groq 429 into a long hang. `maxRetries: 1`.

## Run it
```bash
# 1. a NEW Groq key, separate from parse-receipt's
supabase secrets set CHAT_LLM_API_KEY=gsk_... --project-ref <ref>
# optional: pick a Groq model that supports tool calling (needed from Stage 2)
supabase secrets set CHAT_MODEL=llama-3.3-70b-versatile --project-ref <ref>

supabase functions deploy ask-spending --project-ref <ref>

# 2. get a signed-in user's access token (expires in ~1h). Either copy it from the
#    webapp (DevTools → Application → Local Storage → bill-skills-auth-session →
#    access_token), or sign in via the auth API:
USER_JWT=$(curl -s "https://<ref>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .access_token)

# 3. call it: apikey AND the user's bearer token
curl -s https://<ref>.supabase.co/functions/v1/ask-spending \
  -H "apikey: $ANON" -H "Authorization: Bearer $USER_JWT" -H 'content-type: application/json' \
  -d '{"message":"How much did I spend on groceries last month?"}'
```
Expected: a polite "I can't look that up yet", plus a `usage` block. The anon
key gets a 401, by design: this endpoint costs money.

## Try this before Stage 2
- Change the system prompt to "answer in one sentence" and see it obey.
- Ask "what's today's date?": it knows only because we inject it. Models have
  no clock; you'll inject the same thing for "last month" maths in Stage 2.
- Swap `ChatGroq` for another provider in your head: which lines change? (Only
  the import and constructor.)

**Next, Stage 2:** give the model *tools*. It still can't run them itself; it
returns a structured request ("call `spend_by_category` with
`{from, to}`"), and you'll see exactly what that looks like.
