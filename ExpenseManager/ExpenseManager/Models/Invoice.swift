import Foundation

struct Invoice: Identifiable, Codable {
    var id: UUID = UUID()
    var merchant: String? = nil
    var date: Date? = nil
    var total: Decimal? = nil
    var currency: String? = nil
    var category: String? = nil
    var cardLast4: String? = nil
    var cardBank: String? = nil
    var rawText: String = ""
    var fileUrl: String? = nil
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
        "ATM Cash Withdrawal",
        "Miscellaneous"
    ]

    init(from parsed: ParsedReceipt, rawText: String, fileUrl: String? = nil) {
        let last4 = parsed.cardLast4 ?? PaymentMappingService.normalizedLast4(from: parsed.extracted_digits)
        self.init(
            id: UUID(),
            merchant: parsed.merchant,
            date: Invoice.parseDate(parsed.date),
            total: parsed.total,
            currency: parsed.currency,
            category: parsed.category,
            cardLast4: last4,
            cardBank: parsed.card_bank,
            rawText: rawText,
            fileUrl: fileUrl
        )
    }

    init?(from dictionary: [String: Any]) {
        guard let idString = dictionary["id"] as? String,
              let idValue = UUID(uuidString: idString) else {
            return nil
        }

        let merchant = dictionary["merchant"] as? String
        let dateString = dictionary["date"] as? String
        let fileUrl = dictionary["file_url"] as? String
        let currency = dictionary["currency"] as? String

        // `raw_text` isn't a top-level column; it's stored inside `raw_ocr_json` at insert time
        // (see SupabaseService.insertReceiptToDB) and must be read back from there. PostgREST
        // normally embeds jsonb columns as a nested object, but fall back to string-decoding it
        // in case the column ever comes back JSON-encoded as text.
        var rawOcrJson = dictionary["raw_ocr_json"] as? [String: Any]
        if rawOcrJson == nil, let jsonString = dictionary["raw_ocr_json"] as? String, let data = jsonString.data(using: .utf8) {
            rawOcrJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        }
        let rawText = (rawOcrJson?["raw_text"] as? String) ?? ""

        // A number of existing rows (written by an earlier build of the insert path) only ever
        // populated these fields inside raw_ocr_json and left the top-level columns NULL — which
        // silently dropped those receipts into "Miscellaneous" and hid their card info in Reports.
        // Fall back to the nested copy whenever the column itself is empty.
        let category = (dictionary["category"] as? String)?.nilIfEmpty ?? (rawOcrJson?["category"] as? String)?.nilIfEmpty
        let cardLast4 = (dictionary["card_last4"] as? String)?.nilIfEmpty ?? (rawOcrJson?["card_last4"] as? String)?.nilIfEmpty
        let cardBank = (dictionary["card_bank"] as? String)?.nilIfEmpty ?? (rawOcrJson?["card_bank"] as? String)?.nilIfEmpty

        let total: Decimal?
        if let number = dictionary["total"] as? NSNumber {
            total = number.decimalValue
        } else if let string = dictionary["total"] as? String {
            total = Decimal(string: string)
        } else {
            total = nil
        }

        self.init(
            id: idValue,
            merchant: merchant,
            date: Invoice.parseDate(dateString),
            total: total,
            currency: currency,
            category: category,
            cardLast4: cardLast4,
            cardBank: cardBank,
            rawText: rawText,
            fileUrl: fileUrl
        )
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

        if let merchantLine = text
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
        let categoryKeywords: [(String, [String])] = [
            ("EV Charging", ["evgo", "chargepoint", "electrify america", "tesla supercharger", "supercharger", "ev charging", "charging station", "kwh"]),
            ("Fuel", ["shell", "chevron", "exxon", "mobil", "bp", "arco", "petro", "gasoline", "diesel", "fuel", "gallon"]),
            ("Groceries", ["grocery", "groceries", "supermarket", "trader joe", "whole foods", "safeway", "kroger", "costco", "walmart", "target", "produce", "milk", "bread", "eggs"]),
            ("Food & Dining", ["restaurant", "cafe", "coffee", "pizza", "burger", "doordash", "ubereats", "grubhub", "bakery", "bar", "dining"]),
            ("Electronics", ["apple", "best buy", "electronics", "computer", "laptop", "phone", "charger", "cable", "headphones", "monitor"]),
            ("Clothing", ["clothing", "apparel", "shirt", "pants", "shoes", "nike", "adidas", "uniqlo", "zara", "h&m", "laundry"]),
            ("Entertainment", ["cinema", "movie", "theater", "ticket", "concert", "netflix", "spotify", "game", "gaming", "book"]),
            ("Utilities", ["utility", "electric", "water", "internet", "phone bill", "xfinity", "comcast", "verizon", "at&t"]),
            ("Travel", ["hotel", "airline", "uber", "lyft", "taxi", "parking", "airport", "train", "transit", "rental car"]),
            ("Health", ["pharmacy", "cvs", "walgreens", "medical", "doctor", "dental", "clinic", "fitness", "gym"]),
            ("Home", ["home depot", "lowes", "hardware", "furniture", "garden", "paint", "tools"]),
            ("Subscriptions", ["subscription", "membership", "monthly", "annual plan", "renewal"]),
            ("ATM Cash Withdrawal", ["atm", "cash withdrawal", "cash advance", "withdrawal fee"])
        ]

        for (category, keywords) in categoryKeywords {
            if keywords.contains(where: { haystack.contains($0) }) {
                return category
            }
        }

        return "Miscellaneous"
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

    /// Heuristic gate so SMS inbox / pasted SMS scans don't waste edge-function calls on OTPs,
    /// balance enquiries, or other non-expense texts before running the full parser.
    static func looksLikeExpenseSMS(text: String) -> Bool {
        let normalized = text.lowercased()
        let hasMoney = findLargestAmount(in: text) != nil || normalized.contains("sgd") || normalized.contains("s$")
        let hasTransactionCue = [
            "spent", "purchase", "transaction", "payment", "paid", "debit", "charged",
            "card ending", "card no", "paynow", "paylah", "transfer", "sent to", "paid to", "merchant"
        ].contains { normalized.contains($0) }
        let hasNonExpenseCue = [
            "otp", "one-time password", "verification code", "login", "balance enquiry", "available balance only"
        ].contains { normalized.contains($0) }
        return hasMoney && hasTransactionCue && !hasNonExpenseCue
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
