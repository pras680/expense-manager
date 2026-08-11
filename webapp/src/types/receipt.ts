export type ReceiptVisibility = 'private' | 'household'

export interface Receipt {
  id: string
  merchant: string | null
  date: string | null // ISO string
  total: number | null // reporting total in defaultCurrency
  receiptAmount: number | null // original amount on the receipt/SMS
  currency: string | null // receipt currency (legacy column)
  defaultCurrency: string | null
  receiptCurrency: string | null
  conversionRate: number | null
  convertedTotal: number | null
  category: string | null
  cardLast4: string | null
  cardBank: string | null
  rawText: string
  fileUrl: string | null
  /** Owner. Set server-side by the receipts_set_owner trigger, never by the client. */
  userId: string | null
  householdId: string | null
  /** 'private' = owner only; 'household' = visible to and editable by all members. */
  visibility: ReceiptVisibility
}

export interface ParsedReceipt {
  merchant?: string | null
  date?: string | null
  total?: number | null
  currency?: string | null
  extracted_digits?: string | null
  card_last4?: string | null
  card_bank?: string | null
  category?: string | null
  line_items?: { description?: string; amount?: number }[]
}

export interface PaymentMethod {
  id: string
  lastDigits: string
  bankName: string
  cardName: string | null
}
