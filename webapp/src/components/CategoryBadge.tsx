export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  return (
    <span className="inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-900/50 dark:text-teal-300">
      {category}
    </span>
  )
}
