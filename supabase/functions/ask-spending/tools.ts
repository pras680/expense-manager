// The agent's tools. STAGE 2.
//
// A LangChain tool = a function + a name + a description + an input schema.
// The model never runs these. It only sees name/description/schema (converted
// to JSON Schema and sent with the request) and replies with a structured
// "please call X with {args}" — a tool_call. Our code runs it.
//
// The description is a prompt: it's the ONLY thing telling the model when to
// pick this tool, so it's written for the model, not for humans.

import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/** Calls a Postgres RPC as the signed-in user. Injected so tools never hold credentials themselves. */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'yyyy-mm-dd')

export function makeTools(callRpc: RpcCaller) {
  // Tools return a STRING: it becomes the content of a ToolMessage the model
  // reads next. JSON is the easiest format for it to read numbers back from.
  // Every result is re-sent on each later model call in the question, against
  // Groq's per-minute token budget. Long free-text fields (parser comments,
  // item descriptions) are clipped: the model needs to recognise a row, not
  // reread its full note.
  const run = async (fn: string, args: Record<string, unknown>) => compact(await callRpc(fn, args))

  const spendingByCategory = tool(
    ({ from, to }) => run('ask_spending_by_category', { p_from: from, p_to: to }),
    {
      name: 'spending_by_category',
      description:
        'Spend per category between two dates (inclusive), largest first. Excludes Local Transfer and Credit Card Bill Payment. ' +
        'uncounted_receipts = receipts in another currency with no conversion, not in the total. ' +
        'For "how much on X", "where did my money go".',
      schema: z.object({
        from: isoDate.describe('Start date, inclusive'),
        to: isoDate.describe('End date, inclusive')
      })
    }
  )

  const spendingByMonth = tool(
    ({ from, to, category }) =>
      run('ask_spending_by_month', { p_from: from, p_to: to, p_category: category ?? null }),
    {
      name: 'spending_by_month',
      description:
        'Spend per month (YYYY-MM) between two dates, optionally for one category. For trends and month comparisons.',
      schema: z.object({
        from: isoDate.describe('Start date, inclusive'),
        to: isoDate.describe('End date, inclusive'),
        category: z.string().optional().describe('Exact category name, e.g. "Groceries"; omit for all spending')
      })
    }
  )

  const topMerchants = tool(
    ({ from, to, category, limit }) =>
      run('ask_top_merchants', { p_from: from, p_to: to, p_category: category ?? null, p_limit: limit ?? 10 }),
    {
      name: 'top_merchants',
      description:
        'Merchants ranked by spend between two dates, optionally in one category. For "top restaurants", "how much at Grab".',
      schema: z.object({
        from: isoDate.describe('Start date, inclusive'),
        to: isoDate.describe('End date, inclusive'),
        category: z.string().optional().describe('Exact category name; omit for all'),
        limit: z.number().int().min(1).max(25).optional().describe('How many merchants, default 10')
      })
    }
  )

  const findReceipts = tool(
    ({ search, from, to, category, limit }) =>
      run('ask_find_receipts', {
        p_search: search ?? null, p_from: from ?? null, p_to: to ?? null,
        p_category: category ?? null, p_limit: limit ?? 10
      }),
    {
      name: 'find_receipts',
      description:
        'Individual receipts, newest first, filtered by text (all words must appear in merchant, comment or receipt text), ' +
        'dates and/or category. Includes transfers and card-bill payments. For "when did I last…" or explaining a total.',
      schema: z.object({
        search: z.string().optional().describe('Text to look for, e.g. "IKEA" or "DBS"'),
        from: isoDate.optional(),
        to: isoDate.optional(),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 10')
      })
    }
  )

  // One tool, two RPCs. A tool is just a function, so it can compose several
  // queries into one answer-shaped result. The COUNT comes from Postgres, not
  // the model: LLMs miscount long lists, so never ask one to count rows.
  const searchPurchasedItems = tool(
    async ({ item, from, to }) => {
      const range = { p_from: from ?? null, p_to: to ?? null }
      const [summary, items] = await Promise.all([
        callRpc('ask_line_item_summary', { p_search: item, ...range }),
        callRpc('ask_find_line_items', { p_search: item, ...range, p_limit: 15 })
      ])
      return compact({ summary: Array.isArray(summary) ? summary[0] : summary, items })
    },
    {
      name: 'search_purchased_items',
      description:
        'Search itemised receipt lines (what was bought) for a product, e.g. "milk", "AirPods". summary counts ALL matches ' +
        '(times_bought, receipts_with_item, total_spent, first/last date); items lists up to 15. All words must match, so use ' +
        'short singular terms and retry a variant if nothing matches. summary.other_receipts_mentioning = un-itemised receipts ' +
        'mentioning it: say "possibly more". For "how often did I buy X".',
      schema: z.object({
        item: z.string().min(2).describe('Product words to look for'),
        from: isoDate.optional().describe('Start date, inclusive; omit for all time'),
        to: isoDate.optional().describe('End date, inclusive')
      })
    }
  )

  return [spendingByCategory, spendingByMonth, topMerchants, findReceipts, searchPurchasedItems]
}

const MAX_TEXT_CHARS = 120

/** JSON with long strings clipped and nulls (and zero uncounted_receipts) dropped, to keep tool results small. */
function compact(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (v === null) return undefined
    if (key === 'uncounted_receipts' && Number(v) === 0) return undefined
    if (typeof v === 'string' && v.length > MAX_TEXT_CHARS) return `${v.slice(0, MAX_TEXT_CHARS)}…`
    return v
  })
}
