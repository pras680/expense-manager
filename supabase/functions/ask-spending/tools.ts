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
  const run = async (fn: string, args: Record<string, unknown>) => JSON.stringify(await callRpc(fn, args))

  const spendingByCategory = tool(
    ({ from, to }) => run('ask_spending_by_category', { p_from: from, p_to: to }),
    {
      name: 'spending_by_category',
      description:
        'Total spend per category between two dates (inclusive), largest first. ' +
        'Excludes money that only moved between accounts (Local Transfer, Credit Card Bill Payment). ' +
        'Use for "how much on X", "where did my money go", category breakdowns.',
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
        'Total spend per calendar month (YYYY-MM) between two dates, optionally for a single category. ' +
        'Use for trends and month-vs-month comparisons.',
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
        'Merchants ranked by total spend between two dates, optionally within one category. ' +
        'Use for "where do I spend most", "top restaurants", "how much at Grab".',
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
        p_category: category ?? null, p_limit: limit ?? 20
      }),
    {
      name: 'find_receipts',
      description:
        'List individual receipts, newest first, filtered by text (merchant, comment, line items, or anything printed on the receipt; all words must match), ' +
        'date range and/or category. INCLUDES transfers and card-bill payments. ' +
        'Use for "when did I last…", "show me the receipts for…", or to explain a total.',
      schema: z.object({
        search: z.string().optional().describe('Text to look for, e.g. "IKEA" or "DBS"'),
        from: isoDate.optional(),
        to: isoDate.optional(),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20')
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
        callRpc('ask_find_line_items', { p_search: item, ...range, p_limit: 30 })
      ])
      return JSON.stringify({ summary: Array.isArray(summary) ? summary[0] : summary, items })
    },
    {
      name: 'search_purchased_items',
      description:
        'Search the itemised lines on receipts (what was actually bought) for a product, e.g. "cheese pizza", "milk", "AirPods". ' +
        'Returns summary.times_bought (number of matching line items), receipts_with_item, total_spent, first/last date, ' +
        'plus up to 30 matching items. Matching is case-insensitive and needs ALL words in any order, so use short singular ' +
        'terms ("pizza" not "pizzas"); search again with a variant (e.g. "margherita") if nothing matches. ' +
        'summary.other_receipts_mentioning counts receipts that mention the item in their text but are not itemised ' +
        '(e.g. emailed receipts): mention them as "possibly more". Use for "how many times did I buy X", "how much do I spend on X".',
      schema: z.object({
        item: z.string().min(2).describe('Product words to look for'),
        from: isoDate.optional().describe('Start date, inclusive; omit for all time'),
        to: isoDate.optional().describe('End date, inclusive')
      })
    }
  )

  return [spendingByCategory, spendingByMonth, topMerchants, findReceipts, searchPurchasedItems]
}
