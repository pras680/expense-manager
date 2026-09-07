import type { NavigateFunction } from 'react-router-dom'

/**
 * Whether there is an in-app history entry to return to.
 *
 * React Router stamps its position in the history stack onto `history.state`.
 * An idx of 0 means this is the first entry — a deep link, a reload, or a PWA
 * cold start — where popping would leave the app entirely.
 */
export function canGoBack(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}

/**
 * Leaves the current page the same way the header's back button does: pop to
 * the true previous screen when there's in-app history, otherwise replace
 * with `fallback` (a deep link, reload, or PWA cold start straight onto this
 * page has no history to pop).
 *
 * Anything that programmatically leaves a page after finishing an action on
 * it (a form save, a delete) needs this instead of a plain `navigate(to)` —
 * a plain push leaves the page the user is "done with" sitting in the back
 * stack, so the *next* back tap lands right back on it. That's what made
 * editing a receipt feel circular: save pushed a fresh `/receipts` entry, so
 * tapping back from there returned to the just-saved edit screen instead of
 * wherever the user actually came from.
 */
export function goBack(navigate: NavigateFunction, fallback: string) {
  if (canGoBack()) {
    navigate(-1)
  } else {
    navigate(fallback, { replace: true })
  }
}
