// The app's name as a logotype: "bill" set plain, "Skills" knocked out of a
// tilted accent block. Rendered as text (not an image) so it takes whichever
// theme is active.

const SIZES = {
  md: { text: 'text-[30px]', pad: 'px-2 py-0.5', radius: 'rounded-[10px]' },
  lg: { text: 'text-[46px]', pad: 'px-3 py-1', radius: 'rounded-2xl' }
} as const

interface WordmarkProps {
  size?: keyof typeof SIZES
  /** Home and sign-in render it as the page's h1; elsewhere it's decorative. */
  as?: 'h1' | 'div'
}

export function Wordmark({ size = 'md', as: Tag = 'div' }: WordmarkProps) {
  const s = SIZES[size]
  return (
    // aria-label gives screen readers (and tests) the real two-word name
    // rather than "billSkills" read as one token.
    <Tag aria-label="Bill Skills" className={`flex items-center font-display font-bold leading-none tracking-tight ${s.text}`}>
      <span aria-hidden="true" className="text-ink">bill</span>
      <span
        aria-hidden="true"
        className={`ml-0.5 inline-block -rotate-3 bg-accent text-on-accent ${s.pad} ${s.radius}`}
      >
        Skills
      </span>
    </Tag>
  )
}
