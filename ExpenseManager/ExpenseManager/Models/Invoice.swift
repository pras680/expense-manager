import Foundation

struct Invoice: Identifiable, Codable {
    var id: UUID = UUID()
    var merchant: String? = nil
    var date: Date? = nil
    /// Reporting amount in the app default currency. For this app, totals are shown in SGD by default.
    var total: Decimal? = nil
    /// Original amount printed on the receipt before default-currency conversion.
    var receiptAmount: Decimal? = nil
    /// Original receipt currency. Kept for backward compatibility with existing Supabase `currency` rows.
    var currency: String? = nil
    var defaultCurrency: String? = nil
    var receiptCurrency: String? = nil
    var conversionRate: Decimal? = nil
    var convertedTotal: Decimal? = nil
    var category: String? = nil
    var cardLast4: String? = nil
    var cardBank: String? = nil
    var rawText: String = ""
    var fileUrl: String? = nil
    /// Set server-side by the receipts_set_owner trigger; never written by the client.
    var userId: String? = nil
    var householdId: String? = nil
    /// "private" (owner only) or "household" (shared with, and editable by, members).
    var visibility: String = "household"
}

extension Invoice {

    static let defaultCurrency = "SGD"

    static let commonCurrencies = [
        "SGD",
        "USD",
        "EUR",
        "GBP",
        "AUD",
        "CAD",
        "JPY",
        "CNY",
        "HKD",
        "INR",
        "MYR",
        "THB",
        "IDR",
        "PHP",
        "VND",
        "KRW",
        "AED"
    ]

    static let expenseCategories = [
        "Groceries",
        "Food & Dining",
        "Electronics",
        "Clothing",
        "Entertainment",
        "Fuel",
        "EV Charging",
        "Utilities",
        "Travel",
        "Health",
        "Home",
        "Subscriptions",
        "Services",
        "Credit Card Bill Payment",
        "ATM Cash Withdrawal",
        "Miscellaneous"
    ]

    init(from parsed: ParsedReceipt, rawText: String, fileUrl: String? = nil) {
        let last4 = parsed.cardLast4 ?? PaymentMappingService.normalizedLast4(from: parsed.extracted_digits)
        let receiptCurrency = parsed.receipt_currency ?? parsed.currency
        let receiptAmount = parsed.receipt_amount ?? parsed.total
        self.init(
            id: UUID(),
            merchant: parsed.merchant,
            date: Invoice.parseDate(parsed.date),
            total: parsed.converted_total ?? parsed.total,
            receiptAmount: receiptAmount,
            currency: receiptCurrency,
            defaultCurrency: parsed.default_currency,
            receiptCurrency: receiptCurrency,
            conversionRate: parsed.conversion_rate,
            convertedTotal: parsed.converted_total,
            category: parsed.category,
            cardLast4: last4,
            cardBank: parsed.card_bank,
            rawText: rawText,
            fileUrl: fileUrl,
            // Ownership is unknown at parse time — the server assigns it on
            // insert, and the row is re-read from the DB afterwards.
            userId: nil,
            householdId: nil,
            visibility: parsed.visibility ?? "household"
        )
    }

    init?(from dictionary: [String: Any]) {
        guard let idString = dictionary["id"] as? String,
              let idValue = UUID(uuidString: idString) else {
            return nil
        }

        let rawJSON = dictionary["raw_ocr_json"] as? [String: Any]
        let merchant = dictionary["merchant"] as? String
        let dateString = dictionary["date"] as? String
        let fileUrl = dictionary["file_url"] as? String
        let currency = dictionary["currency"] as? String
        let defaultCurrency = dictionary["default_currency"] as? String ?? Invoice.stringValue(from: rawJSON?["default_currency"])
        let receiptCurrency = dictionary["receipt_currency"] as? String ?? Invoice.stringValue(from: rawJSON?["receipt_currency"]) ?? currency
        let category = dictionary["category"] as? String ?? Invoice.stringValue(from: rawJSON?["category"])
        let cardLast4 = dictionary["card_last4"] as? String ?? Invoice.stringValue(from: rawJSON?["card_last4"])
        let cardBank = dictionary["card_bank"] as? String ?? Invoice.stringValue(from: rawJSON?["card_bank"])
        let userId = dictionary["user_id"] as? String
        let householdId = dictionary["household_id"] as? String
        // Default to shared, matching the column default — a row that predates
        // the column must not silently vanish from the household's view.
        let visibility = (dictionary["visibility"] as? String) == "private" ? "private" : "household"

        let storedTotal = Invoice.decimalValue(from: dictionary["total"])
        let receiptAmount = Invoice.decimalValue(from: dictionary["receipt_amount"])
            ?? Invoice.decimalValue(from: rawJSON?["receipt_amount"])
            ?? storedTotal
        let conversionRate = Invoice.decimalValue(from: dictionary["conversion_rate"])
            ?? Invoice.decimalValue(from: rawJSON?["conversion_rate"])
        let convertedTotal = Invoice.decimalValue(from: dictionary["converted_total"])
            ?? Invoice.decimalValue(from: rawJSON?["converted_total"])
        let targetCurrency = CurrencyConversionService.normalizedCurrency(defaultCurrency) ?? Invoice.defaultCurrency
        let sourceCurrency = CurrencyConversionService.normalizedCurrency(receiptCurrency ?? currency) ?? targetCurrency
        let reportingTotal = convertedTotal ?? (sourceCurrency == targetCurrency ? storedTotal : nil)
        let rawText = Invoice.stringValue(from: rawJSON?["raw_text"]) ?? ""

        self.init(
            id: idValue,
            merchant: merchant,
            date: Invoice.parseDate(dateString),
            total: reportingTotal,
            receiptAmount: receiptAmount,
            currency: receiptCurrency ?? currency,
            defaultCurrency: defaultCurrency,
            receiptCurrency: receiptCurrency,
            conversionRate: conversionRate,
            convertedTotal: convertedTotal,
            category: category,
            cardLast4: cardLast4,
            cardBank: cardBank,
            rawText: rawText,
            fileUrl: fileUrl,
            userId: userId,
            householdId: householdId,
            visibility: visibility
        )
    }

    var reportingTotal: Decimal? {
        total ?? convertedTotal
    }

    var reportingCurrency: String {
        defaultCurrency?.nilIfEmpty ?? Invoice.defaultCurrency
    }

    func reportingTotal(defaultCurrencyCode: String) -> Decimal? {
        total ?? convertedTotal
    }

    func reportingCurrency(defaultCurrencyCode: String) -> String {
        CurrencyConversionService.normalizedCurrency(defaultCurrencyCode) ?? reportingCurrency
    }

    var displayReceiptCurrency: String {
        receiptCurrency?.nilIfEmpty ?? currency?.nilIfEmpty ?? Invoice.defaultCurrency
    }

    var displayReceiptAmount: Decimal? {
        receiptAmount ?? total
    }

    static func stringValue(from value: Any?) -> String? {
        if let string = value as? String {
            return string.nilIfEmpty
        }
        if let number = value as? NSNumber {
            return number.stringValue.nilIfEmpty
        }
        return nil
    }

    static func decimalValue(from value: Any?) -> Decimal? {
        if let number = value as? NSNumber {
            return number.decimalValue
        }
        if let string = value as? String {
            return Decimal(string: string)
        }
        return nil
    }

    static func parseDate(_ raw: String?) -> Date? {
        guard let raw = raw else { return nil }
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: raw) {
            return date
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        for format in ["yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy", "M/d/yyyy", "d MMMM yyyy", "d MMM yyyy"] {
            formatter.dateFormat = format
            if let d = formatter.date(from: raw) {
                return d
            }
        }

        return nil
    }

    func matches(_ query: String) -> Bool {
        let lowercased = query.lowercased()
        if merchant?.lowercased().contains(lowercased) == true { return true }
        if currency?.lowercased().contains(lowercased) == true { return true }
        if category?.lowercased().contains(lowercased) == true { return true }
        if cardLast4?.lowercased().contains(lowercased) == true { return true }
        if cardBank?.lowercased().contains(lowercased) == true { return true }
        if rawText.lowercased().contains(lowercased) { return true }
        if let date = date,
           DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .none)
            .lowercased()
            .contains(lowercased) {
            return true
        }
        if let total = total,
           NSDecimalNumber(decimal: total).stringValue.contains(lowercased) {
            return true
        }
        return false
    }
}

enum InvoiceParseError: Error {
    case notFound
}

struct InvoiceParser {
    static func parse(from text: String) -> Invoice {
        var invoice = Invoice(rawText: text)

        if let smsMerchant = extractSMSMerchant(from: text) {
            invoice.merchant = smsMerchant
        } else if let payNowRecipient = extractPayNowRecipient(from: text) {
            invoice.merchant = payNowRecipient
        } else if let merchantLine = text
            .components(separatedBy: .newlines)
            .map({ $0.trimmingCharacters(in: .whitespaces) })
            .first(where: { !$0.isEmpty }) {
            invoice.merchant = merchantLine
        }

        if let date = findDate(in: text) {
            invoice.date = date
        }

        if let total = findLargestAmount(in: text) {
            invoice.total = total
        }

        invoice.cardLast4 = PaymentMappingService.extractCardLast4(from: text)
        invoice.category = inferCategory(from: text, merchant: invoice.merchant)

        return invoice
    }

    static func inferCategory(from text: String, merchant: String?) -> String {
        let haystack = "\(merchant ?? "") \n\(text)".lowercased()

        if isCreditCardBillPayment(text: haystack) {
            return "Credit Card Bill Payment"
        }

        if isATMWithdrawal(text: haystack) {
            return "ATM Cash Withdrawal"
        }

        if isPayNowTransfer(text: haystack), payNowRecipientLooksLikePerson(text: haystack, merchant: merchant) {
            return "Services"
        }

        let categoryKeywords: [(String, [String])] = [
            ("EV Charging", ["evgo", "chargepoint", "electrify america", "tesla supercharger", "supercharger", "ev charging", "charging station", "kwh"]),
            ("Fuel", ["shell", "chevron", "exxon", "mobil", "bp", "arco", "petro", "gasoline", "diesel", "fuel", "gallon"]),
            ("Groceries", ["grocery", "groceries", "supermarket", "fairprice", "ntuc", "cold storage", "sheng siong", "giant", "don don donki", "trader joe", "whole foods", "safeway", "kroger", "costco", "walmart", "target", "produce", "milk", "bread", "eggs"]),
            ("Food & Dining", ["restaurant", "cafe", "coffee", "kopi", "kopitiam", "food court", "foodcourt", "hawker", "hawker centre", "hawker center", "food republic", "koufu", "toast box", "ya kun", "mcdonald", "kfc", "burger king", "subway", "pizza", "burger", "doordash", "ubereats", "grabfood", "foodpanda", "deliveroo", "bakery", "bar", "bistro", "dining", "eatery", "canteen", "meal"]),
            ("Electronics", ["apple", "best buy", "challenger", "courts", "gain city", "electronics", "computer", "laptop", "phone", "charger", "cable", "headphones", "monitor"]),
            ("Clothing", ["clothing", "apparel", "shirt", "pants", "shoes", "nike", "adidas", "uniqlo", "zara", "h&m", "laundry"]),
            ("Entertainment", ["cinema", "movie", "theater", "ticket", "concert", "netflix", "spotify", "game", "gaming", "book", "klook"]),
            ("Utilities", ["utility", "electric", "water", "internet", "phone bill", "singtel", "starhub", "m1", "sp services", "xfinity", "comcast", "verizon", "at&t"]),
            ("Travel", ["flight", "flight itinerary", "travel itinerary", "itinerary", "e-ticket", "air ticket", "booking confirmation", "boarding", "airport", "airline", "scoot", "singapore airlines", "sq ", "jetstar", "airasia", "emirates", "qatar airways", "hotel", "grab", "gojek", "uber", "lyft", "taxi", "parking", "train", "transit", "mrt", "rental car"]),
            ("Health", ["pharmacy", "guardian", "watsons", "cvs", "walgreens", "medical", "doctor", "dental", "clinic", "fitness", "gym"]),
            ("Home", ["home depot", "lowes", "ikea", "hardware", "furniture", "garden", "paint", "tools"]),
            ("Subscriptions", ["subscription", "membership", "monthly", "annual plan", "renewal"]),
            ("Services", ["service", "repair", "cleaning", "salon", "spa", "tuition", "lesson", "consultation", "maintenance", "plumber", "electrician", "handyman"])
        ]

        for (category, keywords) in categoryKeywords {
            if keywords.contains(where: { haystack.contains($0) }) {
                return category
            }
        }

        if isPayNowTransfer(text: haystack) {
            return payNowRecipientLooksLikeBusiness(text: haystack, merchant: merchant) ? "Miscellaneous" : "Services"
        }

        return "Miscellaneous"
    }

    static func isCreditCardBillPayment(text: String) -> Bool {
        let hasCard = text.contains("credit card") || text.contains("card bill") || text.contains("card payment") || text.contains("visa") || text.contains("mastercard") || text.contains("amex")
        let hasPayment = text.contains("bill payment") || text.contains("payment received") || text.contains("payment confirmation") || text.contains("payment successful") || text.contains("paid")
        let hasBankContext = text.contains("minimum payment") || text.contains("statement") || text.contains("outstanding") || text.contains("card account") || text.contains("amount due")
        return hasCard && hasPayment && hasBankContext
    }

    static func isATMWithdrawal(text: String) -> Bool {
        let normalized = text.lowercased()
        return [
            "atm withdrawal",
            "cash withdrawal",
            "atm cash",
            "withdrawal fee",
            "cash advance",
            "atm transaction"
        ].contains { normalized.contains($0) }
    }

    static func isPayNowTransfer(text: String) -> Bool {
        let normalized = text.lowercased()
        return [
            "paynow",
            "pay now",
            "paylah",
            "fund transfer",
            "funds transfer",
            "bank transfer",
            "fast transfer",
            "transfer successful",
            "successful transfer",
            "payment alert",
            "transaction alert",
            "transaction notification",
            "debit advice",
            "paid to",
            "sent to",
            "transferred to",
            "uen"
        ].contains { normalized.contains($0) }
    }

    static func looksLikeExpenseSMS(text: String) -> Bool {
        let normalized = text.lowercased()
        let hasMoney = findLargestAmount(in: text) != nil || normalized.contains("sgd") || normalized.contains("s$")
        let hasTransactionCue = [
            "spent",
            "purchase",
            "transaction",
            "payment",
            "paid",
            "debit",
            "charged",
            "card ending",
            "card no",
            "paynow",
            "paylah",
            "transfer",
            "sent to",
            "paid to",
            "merchant",
            "withdraw",
            "withdrawal",
            "atm"
        ].contains { normalized.contains($0) } || isReversalTransaction(text: text)
        let hasNonExpenseCue = [
            "otp",
            "one-time password",
            "verification code",
            "login",
            "balance enquiry",
            "available balance only"
        ].contains { normalized.contains($0) }
        return hasMoney && hasTransactionCue && !hasNonExpenseCue
    }

    /// Detects reversal/refund/chargeback alerts that cancel out a previous charge.
    static func isReversalTransaction(text: String) -> Bool {
        let normalized = text.lowercased()
        let reversalCues = [
            "reversal",
            "reversed",
            "has been reversed",
            "transaction reversed",
            "charge reversed",
            "payment reversed",
            "refund",
            "refunded",
            "chargeback",
            "charge back",
            "credited back",
            "credit back",
            "money back",
            "amount credited",
            "transaction cancelled",
            "transaction canceled",
            "cancelled transaction",
            "canceled transaction",
            "transaction voided",
            "voided",
            "declined and reversed"
        ]
        return reversalCues.contains { normalized.contains($0) }
    }

    static func extractSMSMerchant(from text: String) -> String? {
        let patterns = [
            #"(?:at|with|merchant)[:\s]+([a-z0-9 .&'*/()/-]{3,80})"#,
            #"(?:spent|charged|debited|purchase(?:d)?|transaction)\s+(?:of\s+)?(?:sgd|s\$)?\s*[0-9,.]+\s+(?:at|with|to)\s+([a-z0-9 .&'*/()/-]{3,80})"#,
            #"(?:card|acct|account).*?(?:used|charged).*?(?:at|with)\s+([a-z0-9 .&'*/()/-]{3,80})"#,
            #"(?:you paid|payment to|paid to|sent to|transferred to)\s+([a-z0-9 .&'*/()/-]{3,80})"#
        ]
        let ns = text as NSString
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            guard let match = regex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)), match.numberOfRanges > 1 else { continue }
            let candidate = ns.substring(with: match.range(at: 1))
                .replacingOccurrences(of: #"\s+(?:on|at\s+\d|for|amount|sgd|s\$|ref|reference|txn|transaction|card|ending|available|balance).*$"#, with: "", options: [.regularExpression, .caseInsensitive])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let cleaned = cleanedMerchantName(candidate) {
                return cleaned
            }
        }
        return nil
    }

    private static func cleanedMerchantName(_ raw: String) -> String? {
        let trimmed = raw
            .replacingOccurrences(of: #"[^a-zA-Z0-9 .&'*/()/-]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let stopValues = ["sgd", "s", "amount", "transaction", "payment", "purchase", "card", "account", "acct"]
        guard trimmed.count >= 3, !stopValues.contains(trimmed.lowercased()) else { return nil }
        return trimmed
    }

    static func payNowRecipientLooksLikeBusiness(text: String, merchant: String?) -> Bool {
        let candidate = (merchant ?? extractPayNowRecipient(from: text) ?? "").lowercased()
        let businessTerms = ["pte", "ltd", "llp", "co.", "company", "enterprise", "trading", "services", "service", "restaurant", "cafe", "kopitiam", "food court", "foodcourt", "hawker", "koufu", "food republic", "store", "shop", "mart", "market", "salon", "clinic", "tuition", "school", "studio", "repair", "laundry", "bakery", "food", "technology", "solutions", "uen"]
        return businessTerms.contains { candidate.contains($0) || text.contains($0) }
    }

    static func payNowRecipientLooksLikePerson(text: String, merchant: String?) -> Bool {
        if payNowRecipientLooksLikeBusiness(text: text, merchant: merchant) { return false }
        let candidate = (merchant ?? extractPayNowRecipient(from: text) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let words = candidate.split(separator: " ").filter { $0.allSatisfy { $0.isLetter || $0 == "." } }
        return (1...4).contains(words.count)
    }

    static func extractPayNowRecipient(from text: String) -> String? {
        let patterns = [
            #"(?:to|recipient|payee|merchant|beneficiary)[:\s]+([a-z0-9 .&'/-]{3,80})"#,
            #"you have paid\s+([a-z0-9 .&'/-]{3,80})"#,
            #"(?:payment|paid|sent|transferred)\s+to\s+([a-z0-9 .&'/-]{3,80})"#,
            #"(?:funds?|bank|fast)\s+transfer\s+to\s+([a-z0-9 .&'/-]{3,80})"#,
            #"(?:paynow|paylah)\s+(?:to|recipient|payee|merchant)[:\s]+([a-z0-9 .&'/-]{3,80})"#
        ]
        let ns = text as NSString
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            if let match = regex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)), match.numberOfRanges > 1 {
                return ns.substring(with: match.range(at: 1))
                    .replacingOccurrences(of: #"\s+(?:on|at|for|amount|sgd|s\$).*$"#, with: "", options: [.regularExpression, .caseInsensitive])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return nil
    }

    static func findDate(in text: String) -> Date? {
        let patterns = [
            "\\d{4}-\\d{2}-\\d{2}",
            "\\d{1,2}/\\d{1,2}/\\d{4}",
            "\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}"
        ]

        for pat in patterns {
            if let range = text.range(of: pat, options: .regularExpression) {
                let s = String(text[range])
                if let d = Invoice.parseDate(s) {
                    return d
                }
            }
        }
        return nil
    }

    static func findLargestAmount(in text: String) -> Decimal? {
        let pattern = "([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{2})|[0-9]+(?:\\.[0-9]{2}))"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return nil }
        let ns = text as NSString
        let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length))
        var biggest: Decimal? = nil
        for m in matches {
            let s = ns.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: "")
            if let dec = Decimal(string: s) {
                if biggest == nil || dec > biggest! {
                    biggest = dec
                }
            }
        }
        return biggest
    }
}
