import { useLocation } from 'react-router-dom'

// The breadcrumb trail shown on drill-down pages (Insights -> Nov 2026 ->
// Groceries -> FairPrice -> receipt). Each link down a level hands the next
// page the trail so far through router state, so the chips reflect the path
// actually taken — a receipt opened from Home says "Home", the same receipt
// opened from a merchant page says where it came from.

export interface Crumb {
  label: string
  /** Where the chip goes when there's no in-app history to pop back through. */
  to: string
}

export interface TrailState {
  trail?: Crumb[]
}

export interface Trail {
  crumbs: Crumb[]
  /**
   * True when the trail came from router state, i.e. each crumb is a real
   * history entry behind this page and a chip can pop back to it. False for
   * the fallback trail on a deep link or reload, where chips navigate instead.
   */
  fromHistory: boolean
}

/** The trail passed to this page, or `fallback` on a deep link / reload. */
export function useTrail(fallback: Crumb[]): Trail {
  const state = useLocation().state as TrailState | null
  const passed = Array.isArray(state?.trail) ? state.trail : null
  return passed ? { crumbs: passed, fromHistory: true } : { crumbs: fallback, fromHistory: false }
}

/** Router state for a link one level down: the current trail plus this page. */
export function extendTrail(trail: Trail, here: Crumb): TrailState {
  return { trail: [...trail.crumbs, here] }
}
