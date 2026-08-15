// Ported from ExpenseManager/ExpenseManager/Models/Invoice.swift (Invoice.expenseCategories / commonCurrencies)

export const EXPENSE_CATEGORIES = [
  'Groceries',
  'Food & Dining',
  'Electronics',
  'Clothing',
  'Entertainment',
  'Fuel',
  'EV Charging',
  'Utilities',
  'Travel',
  'Health',
  'Home',
  'Subscriptions',
  'Services',
  'Local Transfer',
  'Credit Card Bill Payment',
  'ATM Cash Withdrawal',
  'Miscellaneous'
] as const

export const COMMON_CURRENCIES = [
  'SGD', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CNY', 'HKD', 'INR',
  'MYR', 'THB', 'IDR', 'PHP', 'VND', 'KRW', 'AED'
] as const

export const DEFAULT_CURRENCY = 'SGD'

export const TRANSFER_KINDS = ['self', 'external'] as const

// Money that moved between accounts rather than was spent — kept as receipts
// for record-keeping (and Local Transfer gets its own detail fields below),
// but excluded from every "how much did I spend" total/average/chart so a
// self-transfer or paying off a card doesn't inflate real spending.
const NON_EXPENSE_CATEGORIES = new Set(['Local Transfer', 'Credit Card Bill Payment'])

export function isExpenseCategory(category: string | null | undefined): boolean {
  return !NON_EXPENSE_CATEGORIES.has(category ?? '')
}
