import Foundation

/// Centralized privacy/security helpers for client-side sanitization and diagnostics.
enum AppSecurity {
    static let maxExtractedTextCharacters = 18_000
    static let maxSharedTextCharacters = 8_000

    static func clippedSensitiveText(_ text: String, limit: Int = maxExtractedTextCharacters) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit else { return trimmed }
        return String(trimmed.prefix(limit))
    }

    static func safeUserMessage(for error: Error, fallback: String) -> String {
        let nsError = error as NSError
        if ["PostgREST", "SupabaseStorage", "EdgeFunction", "Gmail"].contains(nsError.domain) {
            return fallback
        }
        return error.localizedDescription
    }

    static func redactedDiagnostic(_ text: String) -> String {
        var redacted = text
        let patterns = [
            #"Bearer\s+[A-Za-z0-9._\-]+"#,
            #"sb_publishable_[A-Za-z0-9_\-]+"#,
            #"eyJ[A-Za-z0-9._\-]+"#,
            #"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\"?\s*[:=]\s*\"?[^\"\s,}]+"#
        ]
        for pattern in patterns {
            redacted = redacted.replacingOccurrences(of: pattern, with: "[REDACTED]", options: .regularExpression)
        }
        return String(redacted.prefix(1_000))
    }

    static func debugLog(_ message: String) {
        #if DEBUG
        print("DEBUG: \(message)")
        #endif
    }
}

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

    // MARK: - SMS inbox (iOS Shortcuts automation via the `receive-sms` Edge Function)

    struct SMSInboxRow {
        let id: UUID
        let body: String
        let sender: String?
        let receivedAt: Date?
    }

    /// Rows queued in Supabase `sms_inbox`, oldest first, not yet successfully processed.
    /// Includes `failed` rows so a transient error gets retried on the next scan.
    func fetchPendingSMSInbox(limit: Int = 25) async throws -> [SMSInboxRow] {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/sms_inbox"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for SMS inbox fetch"])
        }
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,body,sender,received_at"),
            URLQueryItem(name: "or", value: "(status.eq.pending,status.eq.failed)"),
            URLQueryItem(name: "order", value: "received_at.asc"),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for SMS inbox fetch"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applySupabaseHeaders(to: &req)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "PostgREST", code: 1, userInfo: [NSLocalizedDescriptionKey: "SMS inbox fetch failed: \(text)"])
        }

        guard let rows = try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]] else {
            throw NSError(domain: "PostgREST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unexpected SMS inbox fetch response"])
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        return rows.compactMap { row in
            guard let idString = row["id"] as? String, let id = UUID(uuidString: idString),
                  let body = row["body"] as? String else { return nil }
            let sender = row["sender"] as? String
            let receivedAtString = row["received_at"] as? String
            let receivedAt = receivedAtString.flatMap { formatter.date(from: $0) } ?? receivedAtString.flatMap { ISO8601DateFormatter().date(from: $0) }
            return SMSInboxRow(id: id, body: body, sender: sender, receivedAt: receivedAt)
        }
    }

    /// Counts of rows awaiting attention, so the app can surface inbox health without a SQL query.
    func fetchSMSInboxCounts() async throws -> (pending: Int, failed: Int) {
        async let pending = fetchSMSInboxCount(status: "pending")
        async let failed = fetchSMSInboxCount(status: "failed")
        return (try await pending, try await failed)
    }

    private func fetchSMSInboxCount(status: String) async throws -> Int {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/sms_inbox"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for SMS inbox count"])
        }
        components.queryItems = [
            URLQueryItem(name: "select", value: "id"),
            URLQueryItem(name: "status", value: "eq.\(status)"),
            URLQueryItem(name: "limit", value: "1")
        ]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for SMS inbox count"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        applySupabaseHeaders(to: &req, prefer: "count=exact")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "PostgREST", code: 1, userInfo: [NSLocalizedDescriptionKey: "SMS inbox count failed: \(text)"])
        }

        let contentRange = http.value(forHTTPHeaderField: "Content-Range") ?? ""
        guard let totalString = contentRange.split(separator: "/").last, let total = Int(totalString) else {
            return 0
        }
        return total
    }

    /// Marks an `sms_inbox` row processed/skipped/failed after the app has attempted to import it,
    /// so a re-scan never imports the same SMS twice.
    func markSMSInbox(id: UUID, status: String, receiptId: UUID?, errorMessage: String?) async throws {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/sms_inbox"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for SMS inbox update"])
        }
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(id.uuidString)")]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for SMS inbox update"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        applySupabaseHeaders(to: &req, contentType: "application/json", prefer: "return=minimal")

        var body: [String: Any] = [
            "status": status,
            "processed_at": ISO8601DateFormatter().string(from: Date())
        ]
        body["receipt_id"] = receiptId.map { $0.uuidString as Any } ?? NSNull()
        body["error_message"] = errorMessage.map { AppSecurity.clippedSensitiveText($0, limit: 500) as Any } ?? NSNull()

        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "PostgREST", code: 1, userInfo: [NSLocalizedDescriptionKey: "SMS inbox update failed: \(text)"])
        }
    }
}
