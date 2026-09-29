import type { LlmQuotaStatus } from './supabaseClient'

// Turns the last-recorded provider headers (getLlmQuotaStatus) into what the
// Add Receipt screen shows.
//
// Groq's limits are rolling buckets that refill continuously, not windows that
// reset all at once: its x-ratelimit-reset-* header is the time until the
// bucket is *full again* at a steady rate (one request back every
// 86400s / 1000 = 86.4s on a 1000/day limit; 8000 tokens a minute refill at
// ~133/s). The snapshot is only as fresh as the last parse from any caller,
// so the current level is interpolated linearly from that snapshot towards
// full at its reset time — rather than showing a stale figure, or snapping
// straight to full.

export type ParserState = 'unknown' | 'ready' | 'low' | 'limited'

export interface QuotaMeter {
  remaining: number
  limit: number
  /** ms until this window refills; null once it already has (or unknown). */
  resetInMs: number | null
}

export interface ParserView {
  state: ParserState
  /** Only for 'limited': seconds until the provider said to retry. */
  secondsUntilReady: number | null
  requests: QuotaMeter | null
  tokens: QuotaMeter | null
  updatedAt: Date | null
}

// One image parse is the system prompt plus the image plus up to max_tokens
// (4000) of output — below this, the next image parse is likely to hit the
// per-minute token limit.
const LOW_TOKENS = 6000

function meter(
  remaining: number | null,
  limit: number | null,
  resetAt: string | null,
  recordedAt: number,
  now: number
): QuotaMeter | null {
  if (remaining == null || limit == null || limit <= 0) return null
  const resetMs = resetAt ? new Date(resetAt).getTime() : NaN
  if (!Number.isFinite(resetMs)) return { remaining, limit, resetInMs: null }
  if (resetMs <= now || remaining >= limit) return { remaining: limit, limit, resetInMs: null }
  const span = resetMs - recordedAt
  const progress = span > 0 ? Math.min(1, Math.max(0, (now - recordedAt) / span)) : 0
  return {
    remaining: Math.min(limit, Math.floor(remaining + (limit - remaining) * progress)),
    limit,
    resetInMs: resetMs - now
  }
}

export function deriveParserView(status: LlmQuotaStatus | null, now: number): ParserView {
  if (!status) {
    return { state: 'unknown', secondsUntilReady: null, requests: null, tokens: null, updatedAt: null }
  }

  const updatedAt = new Date(status.updatedAt)
  const recordedAt = Number.isFinite(updatedAt.getTime()) ? updatedAt.getTime() : now
  const requests = meter(status.remainingRequests, status.limitRequests, status.requestsResetAt, recordedAt, now)
  const tokens = meter(status.remainingTokens, status.limitTokens, status.tokensResetAt, recordedAt, now)

  const limitedUntil = status.rateLimitedUntil ? new Date(status.rateLimitedUntil).getTime() : NaN
  if (Number.isFinite(limitedUntil) && limitedUntil > now) {
    return { state: 'limited', secondsUntilReady: Math.ceil((limitedUntil - now) / 1000), requests, tokens, updatedAt }
  }

  const requestsLow = requests != null && requests.remaining <= Math.max(5, requests.limit * 0.05)
  // Capped at half the window so a small per-minute limit (Groq's is 6000 on
  // some tiers) doesn't read as permanently "low" whenever it isn't full.
  const tokensLow = tokens != null && tokens.remaining < Math.min(LOW_TOKENS, tokens.limit * 0.5)
  const state: ParserState = requests == null && tokens == null
    ? 'unknown'
    : requestsLow || tokensLow ? 'low' : 'ready'

  return { state, secondsUntilReady: null, requests, tokens, updatedAt }
}

/** "42s", "3m 05s", "2h 14m" */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** "just now", "4m ago", "2h ago", "3d ago" */
export function formatAgo(date: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
