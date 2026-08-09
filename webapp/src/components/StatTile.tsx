export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-xl bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-neutral-900 dark:text-neutral-50 truncate">{value}</div>
    </div>
  )
}
