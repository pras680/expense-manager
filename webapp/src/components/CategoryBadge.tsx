export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  return (
    <span className="inline-block rounded-full bg-card-2 px-2 py-0.5 text-[11px] font-medium text-ink">
      {category}
    </span>
  )
}
