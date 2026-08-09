// Ported from ExpenseManager/ExpenseManager/Services/CurrencyConversionService.swift
// and mirrored exactly in supabase/functions/process-sms-inbox/index.ts.

const FALLBACK_RATES_TO_SGD: Record<string, number> = {
  SGD: 1, USD: 1.35, EUR: 1.46, GBP: 1.71, AUD: 0.89, CAD: 0.99, JPY: 0.0091,
  CNY: 0.19, HKD: 0.17, INR: 0.016, MYR: 0.29, THB: 0.037, IDR: 0.000083,
  PHP: 0.023, VND: 0.000053, KRW: 0.00098, AED: 0.37
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
  onDateISO: string
): Promise<{ rate: number; converted: number }> {
  if (from === to) return { rate: 1, converted: round2(amount) }

  const now = new Date()
  const parsedDate = new Date(onDateISO)
  const clamped = Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() > now.getTime() ? now : parsedDate
  const dateStr = clamped.toISOString().slice(0, 10)

  try {
    const resp = await fetch(`https://api.frankfurter.app/${dateStr}?from=${from}&to=${to}`)
    if (!resp.ok) throw new Error(`Frankfurter HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = data?.rates?.[to]
    if (typeof rate !== 'number') throw new Error('Frankfurter response missing rate')
    return { rate, converted: round2(amount * rate) }
  } catch {
    const fromToSGD = FALLBACK_RATES_TO_SGD[from] ?? 1
    const toToSGD = FALLBACK_RATES_TO_SGD[to] ?? 1
    const rate = fromToSGD / toToSGD
    return { rate, converted: round2(amount * rate) }
  }
}
