import { useCallback, useEffect, useRef, useState } from 'react'
import { getLlmQuotaStatus, type LlmQuotaStatus } from '../lib/supabaseClient'
import { deriveParserView, type ParserView } from '../lib/parserQuota'

const POLL_MS = 60_000
// parse-receipt writes the new snapshot after its response has already gone
// out (EdgeRuntime.waitUntil), so reading it back immediately would usually
// still see the previous values.
const AFTER_PARSE_DELAY_MS = 1_500

/** Re-renders every `intervalMs` so countdowns tick. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useParserStatus(): { view: ParserView; now: number; refreshSoon: () => void } {
  const [status, setStatus] = useState<LlmQuotaStatus | null>(null)
  const now = useNow()
  const timeoutRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await getLlmQuotaStatus())
    } catch {
      // Signed-out handling happens elsewhere; the status line just stays as is.
    }
  }, [])

  useEffect(() => {
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => {
      window.clearInterval(id)
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current)
    }
  }, [load])

  const refreshSoon = useCallback(() => {
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(load, AFTER_PARSE_DELAY_MS)
  }, [load])

  return { view: deriveParserView(status, now), now, refreshSoon }
}
