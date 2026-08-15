/** "2026-08" — sorts and round-trips as a URL segment cleanly. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "2026-08" -> "August 2026". Invalid input passes through unchanged. */
export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
