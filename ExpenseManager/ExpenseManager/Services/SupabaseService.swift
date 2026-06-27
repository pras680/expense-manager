import Foundation

struct ParsedReceipt: Codable {
    var merchant: String?
    var date: String?
    var total: Decimal?
    var currency: String?
    var extracted_digits: String?
    var card_last4: String?
    var card_bank: String?
    var category: String?
    var line_items: [ParsedLineItem]?

    var cardLast4: String? {
        PaymentMappingService.normalizedLast4(from: card_last4) ?? PaymentMappingService.normalizedLast4(from: extracted_digits)
    }
}

struct ParsedLineItem: Codable {
    var description: String?
    var amount: Decimal?
}

actor SupabaseService {
    let supabaseUrl: URL
    let supabaseAnonKey: String
    let edgeFunctionBaseUrl: URL

    init(supabaseUrl: String, supabaseAnonKey: String, edgeFunctionBaseUrl: String) {
        self.supabaseUrl = URL(string: supabaseUrl)!
        self.supabaseAnonKey = supabaseAnonKey
        self.edgeFunctionBaseUrl = URL(string: edgeFunctionBaseUrl)!
    }

    private var canUseBearerAuthorization: Bool {
        supabaseAnonKey.split(separator: ".").count == 3
    }

    private func applySupabaseHeaders(to request: inout URLRequest, contentType: String? = nil, prefer: String? = nil) {
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        if canUseBearerAuthorization {
            request.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        }
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        if let prefer {
            request.setValue(prefer, forHTTPHeaderField: "Prefer")
        }
    }

    private func jsonString(_ value: String?) -> Any {
        value.map { $0 as Any } ?? NSNull()
    }

    private func jsonDecimal(_ value: Decimal?) -> Any {
        value.map { NSDecimalNumber(decimal: $0) as Any } ?? NSNull()
    }

    private func jsonLineItems(_ items: [ParsedLineItem]?) -> [[String: Any]] {
        items?.map { item in
            [
                "description": item.description.map { $0 as Any } ?? NSNull(),
                "amount": item.amount.map { NSDecimalNumber(decimal: $0) as Any } ?? NSNull()
            ]
        } ?? []
    }

    // Upload bytes to Supabase Storage (bucket: receipt-documents)
    func uploadReceiptImage(data: Data, filename: String) async throws -> String {
        let bucket = "receipt-documents"
        let url = supabaseUrl.appendingPathComponent("storage/v1/object/")
            .appendingPathComponent(bucket)
            .appendingPathComponent(filename)

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applySupabaseHeaders(to: &req, contentType: "image/jpeg")
        req.httpBody = data

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "SupabaseStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: "Upload failed: \(text)"])
        }

        return "\(supabaseUrl.absoluteString)/storage/v1/object/public/\(bucket)/\(filename)"
    }

    // Call Edge Function to parse raw_text using Anthropic (Edge Function hosted on Supabase)
    func parseReceiptWithEdge(rawText: String) async throws -> ParsedReceipt {
        let url = edgeFunctionBaseUrl
            .appendingPathComponent("functions")
            .appendingPathComponent("v1")
            .appendingPathComponent("parse-receipt")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applySupabaseHeaders(to: &req, contentType: "application/json")
        let payload = ["raw_text": rawText]
        req.httpBody = try JSONEncoder().encode(payload)

        let (d, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let txt = String(data: d, encoding: .utf8) ?? ""
            throw NSError(domain: "EdgeFunction", code: 1, userInfo: [NSLocalizedDescriptionKey: "Edge parse failed: \(txt)"])
        }

        return try JSONDecoder().decode(ParsedReceipt.self, from: d)
    }

    // Fetch receipts from Supabase PostgREST
    func fetchReceipts() async throws -> [Invoice] {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/receipts"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for receipts fetch"])
        }
        components.queryItems = [URLQueryItem(name: "select", value: "*")]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for receipts fetch"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applySupabaseHeaders(to: &req)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "PostgREST", code: 1, userInfo: [NSLocalizedDescriptionKey: "Fetch failed: \(text)"])
        }

        guard let rows = try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]] else {
            throw NSError(domain: "PostgREST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unexpected fetch response"])
        }

        return rows.compactMap { Invoice(from: $0) }
    }

    func updateReceipt(id: UUID, merchant: String?, date: Date?, total: Decimal?, currency: String?, category: String?, cardLast4: String?, cardBank: String?) async throws {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/receipts"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for receipt update"])
        }
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(id.uuidString)")]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for receipt update"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        applySupabaseHeaders(to: &req, contentType: "application/json", prefer: "return=minimal")

        let body: [String: Any] = [
            "merchant": jsonString(merchant),
            "date": date.map { ISO8601DateFormatter().string(from: $0) as Any } ?? NSNull(),
            "total": jsonDecimal(total),
            "currency": jsonString(currency),
            "category": jsonString(category),
            "card_last4": jsonString(PaymentMappingService.normalizedLast4(from: cardLast4)),
            "card_bank": jsonString(cardBank)
        ]

        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (_, response) = try await URLSession.shared.data(for: req)

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain: "PostgREST", code: 3, userInfo: [NSLocalizedDescriptionKey: "Update failed"])
        }
    }

    func deleteReceipt(id: UUID) async throws {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/receipts"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for receipt delete"])
        }
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(id.uuidString)")]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for receipt delete"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        applySupabaseHeaders(to: &req, prefer: "return=minimal")

        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain: "PostgREST", code: 4, userInfo: [NSLocalizedDescriptionKey: "Delete failed"])
        }
    }

    func insertReceiptToDB(parsed: ParsedReceipt, rawText: String? = nil, fileUrl: String?) async throws -> UUID {
        let url = supabaseUrl.appendingPathComponent("/rest/v1/receipts")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applySupabaseHeaders(to: &req, contentType: "application/json", prefer: "return=representation")

        let cardLast4 = parsed.cardLast4
        let body: [String: Any] = [
            "merchant": jsonString(parsed.merchant),
            "date": jsonString(parsed.date),
            "total": jsonDecimal(parsed.total),
            "currency": jsonString(parsed.currency),
            "category": jsonString(parsed.category),
            "card_last4": jsonString(cardLast4),
            "card_bank": jsonString(parsed.card_bank),
            "file_url": jsonString(fileUrl),
            "raw_ocr_json": [
                "raw_text": rawText ?? "",
                "extracted_digits": parsed.extracted_digits ?? "",
                "card_last4": cardLast4 ?? "",
                "card_bank": parsed.card_bank ?? "",
                "category": parsed.category ?? "",
                "line_items": jsonLineItems(parsed.line_items)
            ] as Any
        ]

        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (d, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let txt = String(data: d, encoding: .utf8) ?? ""
            throw NSError(domain: "PostgREST", code: 1, userInfo: [NSLocalizedDescriptionKey: "Insert failed: \(txt)"])
        }

        if let arr = try JSONSerialization.jsonObject(with: d, options: []) as? [[String: Any]], let first = arr.first,
           let idStr = first["id"] as? String,
           let uuid = UUID(uuidString: idStr) {
            return uuid
        }

        throw NSError(domain: "PostgREST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not parse inserted id"])
    }
}
