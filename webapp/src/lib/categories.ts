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
  'Credit Card Bill Payment',
  'ATM Cash Withdrawal',
  'Miscellaneous'
] as const

export const COMMON_CURRENCIES = [
  'SGD', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CNY', 'HKD', 'INR',
  'MYR', 'THB', 'IDR', 'PHP', 'VND', 'KRW', 'AED'
] as const

export const DEFAULT_CURRENCY = 'SGD'
