export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  return (
    <span className="inline-block rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-800 dark:bg-accent-900/50 dark:text-accent-300">
      {category}
    </span>
  )
}
