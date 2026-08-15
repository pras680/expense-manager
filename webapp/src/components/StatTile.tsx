export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-xl bg-neutral-100 px-3 py-3 dark:bg-neutral-800">
      {/* Sentence case, not uppercase: small all-caps text loses the word shapes
          that make a label readable at a glance. neutral-600/300 rather than
          500/400 so the label clears 7:1 on its own tinted background. */}
      <div className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold text-neutral-900 dark:text-neutral-50">{value}</div>
    </div>
  )
}
