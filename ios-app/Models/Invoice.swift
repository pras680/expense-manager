import Foundation

struct Invoice: Identifiable, Codable {
    var id: UUID = UUID()
    var merchant: String? = nil
    var date: Date? = nil
    var total: Decimal? = nil
    var currency: String? = nil
    var rawText: String = ""
    var fileUrl: String? = nil
}

extension Invoice {

    init(from parsed: ParsedReceipt, rawText: String, fileUrl: String? = nil) {
        self.init(
            id: UUID(),
            merchant: parsed.merchant,
            date: Invoice.parseDate(parsed.date),
            total: parsed.total,
            currency: parsed.currency,
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
            rawText: "",
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

        return invoice
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
