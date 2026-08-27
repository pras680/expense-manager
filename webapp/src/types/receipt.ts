export type ReceiptVisibility = 'private' | 'household'
/** Where a receipt came from. 'sms' and 'gmail' arrive unattended and need checking. */
export type ReceiptSource = 'manual' | 'photo' | 'sms' | 'gmail'

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
  /** Only meaningful when category is 'Local Transfer'. */
  transferFromBank: string | null
  transferToBank: string | null
  transferKind: 'self' | 'external' | null
  rawText: string
  lineItems: { description: string; amount: number | null }[]
  fileUrl: string | null
  /** Owner. Set server-side by the receipts_set_owner trigger, never by the client. */
  userId: string | null
  householdId: string | null
  /** 'private' = owner only; 'household' = visible to and editable by all members. */
  visibility: ReceiptVisibility
  source: ReceiptSource
  /** Null means nobody has verified this auto-imported receipt yet. */
  reviewedAt: string | null
  /** Auto-filled from the parser's derivation_note, freely editable afterward. */
  comment: string | null
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
  raw_text?: string | null
  /** One-liner explaining how the parser derived these values. */
  derivation_note?: string | null
}

export interface PaymentMethod {
  id: string
  lastDigits: string
  bankName: string
  cardName: string | null
}
