import { categoryStyle } from '../lib/categoryStyle'
import { Icon } from './Icon'

/** The round, colour-coded badge that stands for a category in every list. */
export function CategoryIcon({ category, size = 40 }: { category: string | null; size?: number }) {
  const style = categoryStyle(category)
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full text-on-cat"
      style={{ width: size, height: size, background: style.color }}
    >
      <Icon name={style.icon} size={Math.round(size * 0.48)} />
    </span>
  )
}

/** A small dot in the category's colour, for chart legends and compact rows. */
export function CategoryDot({ category }: { category: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: categoryStyle(category).color }}
    />
  )
}
