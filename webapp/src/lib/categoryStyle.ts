import type { IconName } from '../components/Icon'

// The colour and icon each category wears everywhere it appears (list rows,
// chart segments, the category page). Colours are indexes into the --cat-N
// palette in index.css, which has a dark-scheme and a light-scheme set.
//
// There are more built-in categories than palette colours, so a few share one;
// the pairs chosen rarely sit next to each other in a month's breakdown, and
// the icon still tells them apart.
const BUILT_IN: Record<string, { color: number; icon: IconName }> = {
  'Groceries': { color: 2, icon: 'cart' },
  'Food & Dining': { color: 1, icon: 'utensils' },
  'Electronics': { color: 9, icon: 'monitor' },
  'Clothing': { color: 5, icon: 'shirt' },
  'Entertainment': { color: 4, icon: 'ticket' },
  'Fuel': { color: 6, icon: 'fuel' },
  'EV Charging': { color: 7, icon: 'bolt' },
  'Utilities': { color: 12, icon: 'bulb' },
  'Travel': { color: 3, icon: 'plane' },
  'Commute': { color: 11, icon: 'car' },
  'Health': { color: 5, icon: 'heart' },
  'Home': { color: 8, icon: 'home' },
  'Subscriptions': { color: 4, icon: 'repeat' },
  'Services': { color: 9, icon: 'briefcase' },
  'Local Transfer': { color: 10, icon: 'swap' },
  'Credit Card Bill Payment': { color: 10, icon: 'card' },
  'ATM Cash Withdrawal': { color: 8, icon: 'banknote' },
  'Miscellaneous': { color: 10, icon: 'tag' }
}

const PALETTE_SIZE = 12

export interface CategoryStyle {
  /** A CSS colour value, e.g. "var(--cat-3)" — use in an inline style. */
  color: string
  icon: IconName
}

/**
 * A household's own categories aren't in the table above, so they get a
 * colour from a hash of the name: stable across sessions and devices without
 * storing anything.
 */
export function categoryStyle(category: string | null | undefined): CategoryStyle {
  const name = category || 'Miscellaneous'
  const builtIn = BUILT_IN[name]
  if (builtIn) return { color: `var(--cat-${builtIn.color})`, icon: builtIn.icon }
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return { color: `var(--cat-${(hash % PALETTE_SIZE) + 1})`, icon: 'tag' }
}
