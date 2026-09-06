// Shared brand tokens for the "poster" visual language introduced on the
// Home landing page (Claude Design project ccbe8d7a, option 2a) and now
// applied app-wide — see index.css's `accent-*` Tailwind palette for the
// same colors as ordinary utility classes (bg-accent-700, text-accent-400,
// etc.), which is what most pages use. This raw hex export exists for the
// handful of spots (LandingPage's poster hero) that need the literal value
// in inline styles rather than a class.
export const ACCENT = '#ec3013'

// The "Where it went" category-breakdown bars, darkest (top category) to
// lightest — matches the accent-800/500/300/200 steps in index.css.
export const CATEGORY_BAR_CLASSES = ['bg-[#dd2b0f]', 'bg-[#ff563c]', 'bg-[#ff9783]', 'bg-[#ffc4b8]']
