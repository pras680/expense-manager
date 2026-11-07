// LangSmith tracing for an edge function. STAGE 6 (moved forward).
//
// LangChain/LangGraph trace themselves when these secrets are set:
//   LANGSMITH_TRACING=true, LANGSMITH_API_KEY, LANGSMITH_PROJECT,
//   LANGSMITH_ENDPOINT (this org is in APAC: https://apac.api.smith.langchain.com;
//   keys are region-bound and the SDK defaults to the US server).
//
// What this file adds is the edge-function part: traces are sent in the
// BACKGROUND, in batches, and an edge function may be shut down as soon as it
// has responded. Without an explicit flush, traces are silently lost.

import { Client } from 'langsmith'
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain'
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises'

// Supabase's runtime: keeps the function alive for a promise after responding.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

const enabled =
  (Deno.env.get('LANGSMITH_TRACING') ?? '').toLowerCase() === 'true' && !!Deno.env.get('LANGSMITH_API_KEY')

// One client per function instance. It batches runs and sends them in the
// background; we own it so we can flush it.
const client = enabled
  ? new Client({ apiUrl: Deno.env.get('LANGSMITH_ENDPOINT'), apiKey: Deno.env.get('LANGSMITH_API_KEY') })
  : null

export const tracingEnabled = enabled

/**
 * Spread into graph.invoke()'s config. Passing our own tracer (bound to our
 * client) stops LangChain creating a second, default one from the env vars,
 * so each run is traced exactly once and we know which client to flush.
 */
export function tracingConfig() {
  if (!client) return {}
  return {
    callbacks: [new LangChainTracer({ client, projectName: Deno.env.get('LANGSMITH_PROJECT') ?? 'ask-spending' })]
  }
}

/**
 * Sends any pending traces. On Supabase this runs AFTER the response is sent
 * (waitUntil), so tracing adds no latency for the user. Locally (plain Deno,
 * no EdgeRuntime) it's awaited instead. Never throws: losing a trace must not
 * fail a chat answer.
 */
export async function flushTraces(): Promise<void> {
  if (!client) return
  const flush = (async () => {
    await awaitAllCallbacks() // LangChain callbacks still running in the background
    await client.awaitPendingTraceBatches() // batched HTTP sends to LangSmith
  })().catch((err) => console.error(`LangSmith flush failed: ${err instanceof Error ? err.message : err}`))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(flush)
  else await flush
}

/** Stable, non-reversible id for a user, so traces can be grouped per user without storing who they are. */
export async function hashUser(sub: string | null): Promise<string | null> {
  if (!sub) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ask-spending:${sub}`))
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}
