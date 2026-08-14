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
