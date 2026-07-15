import Foundation

struct PaymentMethod: Identifiable, Equatable {
    let id: UUID
    let lastDigits: String
    let bankName: String
    let cardName: String?
}

actor PaymentMappingService {
    let supabaseUrl: URL
    let supabaseAnonKey: String
    private var authAccessToken: String?

    init(supabaseUrl: String, supabaseAnonKey: String) {
        self.supabaseUrl = URL(string: supabaseUrl)!
        self.supabaseAnonKey = supabaseAnonKey
    }

    func setAuthAccessToken(_ token: String?) {
        authAccessToken = token
    }

    private func applyHeaders(to request: inout URLRequest) {
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        if let authAccessToken {
            request.setValue("Bearer \(authAccessToken)", forHTTPHeaderField: "Authorization")
        } else {
            request.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        }
    }

    // Query payment_methods table for a matching last_digits.
    func findPaymentMethod(lastDigits: String) async throws -> PaymentMethod? {
        guard let normalizedLast4 = Self.normalizedLast4(from: lastDigits),
              var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/payment_methods"), resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.queryItems = [
            URLQueryItem(name: "select", value: "id,last_digits,bank_name,card_name"),
            URLQueryItem(name: "last_digits", value: "eq.\(normalizedLast4)")
        ]
        guard let url = components.url else {
            return nil
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applyHeaders(to: &req)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return nil
        }

        guard let rows = try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]],
              let first = rows.first,
              let idString = first["id"] as? String,
              let id = UUID(uuidString: idString) else {
            return nil
        }

        let bankName = first["bank_name"] as? String
            ?? first["card_bank"] as? String
            ?? first["bank"] as? String
            ?? "Unknown Bank"
        let cardName = first["card_name"] as? String
            ?? first["name"] as? String

        return PaymentMethod(
            id: id,
            lastDigits: normalizedLast4,
            bankName: bankName,
            cardName: cardName
        )
    }

    func findPaymentMethodId(lastDigits: String) async throws -> UUID? {
        try await findPaymentMethod(lastDigits: lastDigits)?.id
    }

    func fetchPaymentMethods() async throws -> [PaymentMethod] {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/payment_methods"), resolvingAgainstBaseURL: false) else {
            return []
        }

        components.queryItems = [
            URLQueryItem(name: "select", value: "id,last_digits,bank_name,card_name"),
            URLQueryItem(name: "order", value: "bank_name.asc,last_digits.asc")
        ]
        guard let url = components.url else {
            return []
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applyHeaders(to: &req)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return []
        }

        guard let rows = try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]] else {
            return []
        }

        return rows.compactMap { row in
            guard let idString = row["id"] as? String,
                  let id = UUID(uuidString: idString),
                  let rawLastDigits = row["last_digits"] as? String,
                  let lastDigits = Self.normalizedLast4(from: rawLastDigits) else {
                return nil
            }
            let bankName = row["bank_name"] as? String
                ?? row["card_bank"] as? String
                ?? row["bank"] as? String
                ?? "Unknown Bank"
            let cardName = row["card_name"] as? String
                ?? row["name"] as? String
            return PaymentMethod(id: id, lastDigits: lastDigits, bankName: bankName, cardName: cardName)
        }
    }

    static func normalizedLast4(from value: String?) -> String? {
        guard let value else { return nil }
        let digits = value.filter(\.isNumber)
        guard digits.count >= 4 else { return nil }
        return String(digits.suffix(4))
    }

    static func extractCardLast4(from text: String) -> String? {
        let patterns = [
            "(?i)(?:visa|mastercard|master card|amex|american express|discover|card|credit|debit|paywave|contactless|nets)[^\\n\\r]{0,40}(\\d{4})",
            "(?i)(?:\\*{2,}|x{2,}|•{2,}|-\\s*)\\s*(\\d{4})"
        ]

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let nsText = text as NSString
            let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))
            for match in matches where match.numberOfRanges > 1 {
                let candidate = nsText.substring(with: match.range(at: 1))
                if let last4 = normalizedLast4(from: candidate) {
                    return last4
                }
            }
        }

        return nil
    }
}
