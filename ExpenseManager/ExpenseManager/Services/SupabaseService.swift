import Foundation
import Security

/// Centralized privacy/security helpers for client-side sanitization.
/// The Supabase publishable key in the app is not a secret; backend security must be enforced by RLS/Auth.
enum AppSecurity {
    static let maxExtractedTextCharacters = 18_000
    static let maxSharedTextCharacters = 8_000
    static let maxReceiptUploadBytes = 8 * 1024 * 1024

    static func clippedSensitiveText(_ text: String, limit: Int = maxExtractedTextCharacters) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit else { return trimmed }
        return String(trimmed.prefix(limit))
    }

    static func sanitizedStorageFilename(_ filename: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        let sanitizedScalars = filename.unicodeScalars.map { scalar in
            allowed.contains(scalar) ? String(scalar) : "-"
        }.joined()
        let sanitized = sanitizedScalars
            .replacingOccurrences(of: #"-+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        let base = sanitized.isEmpty ? UUID().uuidString : sanitized
        return String(base.prefix(120))
    }

    static func backendError(prefix: String, statusCode: Int?, data: Data) -> NSError {
        let statusText = statusCode.map { "HTTP \($0)" } ?? "No HTTP status"
        let userMessage = "\(prefix) (\(statusText)). Check backend access, RLS, or network configuration."
        var userInfo: [String: Any] = [NSLocalizedDescriptionKey: userMessage]
        if let raw = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            userInfo[NSDebugDescriptionErrorKey] = redactedDiagnostic(raw)
        }
        return NSError(domain: "Backend", code: statusCode ?? -1, userInfo: userInfo)
    }

    static func safeUserMessage(for error: Error, fallback: String) -> String {
        let nsError = error as NSError
        if ["Backend", "PostgREST", "SupabaseStorage", "EdgeFunction"].contains(nsError.domain) {
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

    static func debugLog(_ message: @autoclosure () -> String) {
        #if DEBUG
        let rendered = "DEBUG: \(message())"
        print(rendered)
        NSLog("%@", rendered)
        #endif
    }

}

struct ParsedReceipt: Codable {
    var merchant: String?
    var date: String?
    var total: Decimal?
    var receipt_amount: Decimal?
    var currency: String?
    var default_currency: String?
    var receipt_currency: String?
    var conversion_rate: Decimal?
    var converted_total: Decimal?
    var extracted_digits: String?
    var card_last4: String?
    var card_bank: String?
    var category: String?
    var line_items: [ParsedLineItem]?
    /// "private" or "household". Nil means fall back to the column default.
    var visibility: String?

    var cardLast4: String? {
        PaymentMappingService.normalizedLast4(from: card_last4) ?? PaymentMappingService.normalizedLast4(from: extracted_digits)
    }
}

struct ParsedLineItem: Codable {
    var description: String?
    var amount: Decimal?
}

struct ReceiptLearningHint: Codable, Hashable {
    let merchantKeyword: String
    let correctedMerchant: String?
    let correctedCategory: String?
    let correctedCurrency: String?
    let correctedCardLast4: String?
    let correctedCardBank: String?
}

enum SupabaseAuthError: LocalizedError {
    case notAuthenticated

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Sign in to Supabase to load and save receipts."
        }
    }
}

struct SupabaseAuthSession: Codable, Equatable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userID: String
    let email: String?

    var isExpiredOrNearExpiry: Bool {
        Date().addingTimeInterval(90) >= expiresAt
    }
}

private struct SupabaseTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int?
    let user: SupabaseAuthUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case user
    }
}

private struct SupabaseAuthUser: Decodable {
    let id: String
    let email: String?
}

actor SupabaseService {
    let supabaseUrl: URL
    let supabaseAnonKey: String
    let edgeFunctionBaseUrl: URL
    private let authCredentialStore: SupabaseCredentialStore
    private var authSession: SupabaseAuthSession?

    init(supabaseUrl: String, supabaseAnonKey: String, edgeFunctionBaseUrl: String) {
        self.supabaseUrl = URL(string: supabaseUrl)!
        self.supabaseAnonKey = supabaseAnonKey
        self.edgeFunctionBaseUrl = URL(string: edgeFunctionBaseUrl)!
        self.authCredentialStore = SupabaseCredentialStore(
            service: "BillSkillsSupabaseAuth",
            account: URL(string: supabaseUrl)?.host ?? supabaseUrl
        )
        self.authSession = authCredentialStore.loadSession()
    }

    func currentSession() -> SupabaseAuthSession? {
        authSession
    }

    /// Always returns a usable token, refreshing first when it is near expiry.
    func currentAccessToken() async -> String? {
        try? await refreshAuthSessionIfNeeded()
        return authSession?.accessToken
    }

    func signIn(email: String, password: String) async throws -> SupabaseAuthSession {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/auth/v1/token"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "SupabaseAuth", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid Supabase Auth URL"])
        }
        components.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
        guard let url = components.url else {
            throw NSError(domain: "SupabaseAuth", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid Supabase Auth URL components"])
        }

        let response = try await requestToken(url: url, body: [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password
        ])
        let session = makeAuthSession(from: response, fallbackRefreshToken: response.refreshToken)
        authSession = session
        authCredentialStore.saveSession(session)
        return session
    }

    func signOut() {
        authSession = nil
        authCredentialStore.deleteSession()
    }

    private func refreshAuthSessionIfNeeded() async throws {
        guard let session = authSession, session.isExpiredOrNearExpiry else { return }
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/auth/v1/token"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "SupabaseAuth", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid Supabase Auth URL"])
        }
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        guard let url = components.url else {
            throw NSError(domain: "SupabaseAuth", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid Supabase Auth URL components"])
        }

        let response = try await requestToken(url: url, body: ["refresh_token": session.refreshToken])
        let refreshedSession = makeAuthSession(from: response, fallbackRefreshToken: session.refreshToken)
        authSession = refreshedSession
        authCredentialStore.saveSession(refreshedSession)
    }

    private func requestToken(url: URL, body: [String: String]) async throws -> SupabaseTokenResponse {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "Sign in failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
        }
        return try JSONDecoder().decode(SupabaseTokenResponse.self, from: data)
    }

    private func makeAuthSession(from response: SupabaseTokenResponse, fallbackRefreshToken: String?) -> SupabaseAuthSession {
        SupabaseAuthSession(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken ?? fallbackRefreshToken ?? "",
            expiresAt: Date().addingTimeInterval(TimeInterval(response.expiresIn ?? 3600)),
            userID: response.user.id,
            email: response.user.email
        )
    }

    private func applySupabaseHeaders(to request: inout URLRequest, contentType: String? = nil, prefer: String? = nil) async throws {
        try await refreshAuthSessionIfNeeded()
        guard let accessToken = authSession?.accessToken else {
            // Deliberately no anon-key fallback. Under per-user RLS the anon role
            // can read nothing, so falling back would turn "you are signed out"
            // into an empty receipts list — data that looks deleted rather than
            // an app that asks you to sign in.
            throw SupabaseAuthError.notAuthenticated
        }
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
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

    private func postgrestError(prefix: String, statusCode: Int?, data: Data) -> NSError {
        AppSecurity.backendError(prefix: prefix, statusCode: statusCode, data: data)
    }

    private func isMissingColumnError(_ error: Error) -> Bool {
        let nsError = error as NSError
        let message = "\(error.localizedDescription) \(nsError.userInfo[NSDebugDescriptionErrorKey] as? String ?? "")".lowercased()
        return message.contains("pgrst204")
            || message.contains("42703")
            || message.contains("schema cache")
            || message.contains("column") && message.contains("could not find")
            || message.contains("column") && message.contains("does not exist")
    }

    // Upload bytes to Supabase Storage (bucket: receipt-documents)
    func uploadReceiptImage(data: Data, filename: String) async throws -> String {
        guard data.count <= AppSecurity.maxReceiptUploadBytes else {
            throw NSError(domain: "SupabaseStorage", code: 413, userInfo: [NSLocalizedDescriptionKey: "Upload failed: image is too large."])
        }

        // The <uid>/ prefix is what the storage policies authorize against, so an
        // unowned path can't be uploaded at all — no anon branch remains.
        guard let userID = authSession?.userID else { throw SupabaseAuthError.notAuthenticated }

        let bucket = "receipt-documents"
        let safeFilename = AppSecurity.sanitizedStorageFilename(filename)
        let objectPath = "\(userID)/\(safeFilename)"
        let url = supabaseUrl.appendingPathComponent("storage/v1/object/")
            .appendingPathComponent(bucket)
            .appendingPathComponent(userID)
            .appendingPathComponent(safeFilename)

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        try await applySupabaseHeaders(to: &req, contentType: "image/jpeg")
        req.httpBody = data

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "Upload failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
        }

        // Returns the object path, not a /object/public/ URL: the bucket is
        // private, so those URLs no longer resolve. Anything displaying an image
        // must sign the path first.
        return objectPath
    }

    // Call Edge Function to parse raw_text using Anthropic (Edge Function hosted on Supabase)
    func parseReceiptWithEdge(rawText: String, learningHints: [ReceiptLearningHint] = []) async throws -> ParsedReceipt {
        let url = edgeFunctionBaseUrl
            .appendingPathComponent("functions")
            .appendingPathComponent("v1")
            .appendingPathComponent("parse-receipt")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        try await applySupabaseHeaders(to: &req, contentType: "application/json")
        let payload = ReceiptParseRequest(
            rawText: AppSecurity.clippedSensitiveText(rawText),
            learningHints: Array(learningHints.prefix(12))
        )
        req.httpBody = try JSONEncoder().encode(payload)

        let (d, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "Edge parse failed", statusCode: (resp as? HTTPURLResponse)?.statusCode, data: d)
        }

        return try JSONDecoder().decode(ParsedReceipt.self, from: d)
    }

    private struct ReceiptParseRequest: Encodable {
        let rawText: String
        let learningHints: [ReceiptLearningHint]

        enum CodingKeys: String, CodingKey {
            case rawText = "raw_text"
            case learningHints = "learning_hints"
        }
    }

    // Fetch receipts from Supabase PostgREST
    func fetchReceipts() async throws -> [Invoice] {
        do {
            return try await fetchReceipts(
                selectColumns: "id,merchant,date,total,currency,file_url,raw_ocr_json,card_last4,card_bank,default_currency,receipt_amount,receipt_currency,conversion_rate,converted_total,category,user_id,household_id,visibility"
            )
        } catch {
            guard isMissingColumnError(error) else { throw error }
            AppSecurity.debugLog("Optional receipt columns are missing in Supabase. Retrying fetch with legacy-compatible columns.")
            return try await fetchReceipts(
                selectColumns: "id,merchant,date,total,currency,file_url,raw_ocr_json,user_id,household_id,visibility"
            )
        }
    }

    private func fetchReceipts(selectColumns: String) async throws -> [Invoice] {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/receipts"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for receipts fetch"])
        }
        components.queryItems = [URLQueryItem(name: "select", value: selectColumns)]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for receipts fetch"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        try await applySupabaseHeaders(to: &req)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "Fetch failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
        }

        guard let rows = try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]] else {
            throw NSError(domain: "PostgREST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unexpected fetch response"])
        }

        return rows.compactMap { Invoice(from: $0) }
    }

    func updateReceipt(
        id: UUID,
        merchant: String?,
        date: Date?,
        total: Decimal?,
        receiptAmount: Decimal?,
        currency: String?,
        defaultCurrency: String?,
        receiptCurrency: String?,
        conversionRate: Decimal?,
        convertedTotal: Decimal?,
        category: String?,
        cardLast4: String?,
        cardBank: String?,
        rawText: String?
    ) async throws {
        do {
            try await updateReceipt(
                id: id,
                merchant: merchant,
                date: date,
                total: total,
                receiptAmount: receiptAmount,
                currency: currency,
                defaultCurrency: defaultCurrency,
                receiptCurrency: receiptCurrency,
                conversionRate: conversionRate,
                convertedTotal: convertedTotal,
                category: category,
                cardLast4: cardLast4,
                cardBank: cardBank,
                rawText: rawText,
                includeOptionalColumns: true
            )
        } catch {
            guard isMissingColumnError(error) else { throw error }
            AppSecurity.debugLog("Optional receipt columns are missing or not visible in Supabase schema cache. Retrying update with legacy-compatible raw JSON payload.")
            try await updateReceipt(
                id: id,
                merchant: merchant,
                date: date,
                total: total,
                receiptAmount: receiptAmount,
                currency: currency,
                defaultCurrency: defaultCurrency,
                receiptCurrency: receiptCurrency,
                conversionRate: conversionRate,
                convertedTotal: convertedTotal,
                category: category,
                cardLast4: cardLast4,
                cardBank: cardBank,
                rawText: rawText,
                includeOptionalColumns: false
            )
        }
    }

    private func updateReceipt(
        id: UUID,
        merchant: String?,
        date: Date?,
        total: Decimal?,
        receiptAmount: Decimal?,
        currency: String?,
        defaultCurrency: String?,
        receiptCurrency: String?,
        conversionRate: Decimal?,
        convertedTotal: Decimal?,
        category: String?,
        cardLast4: String?,
        cardBank: String?,
        rawText: String?,
        includeOptionalColumns: Bool
    ) async throws {
        guard var components = URLComponents(url: supabaseUrl.appendingPathComponent("/rest/v1/receipts"), resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for receipt update"])
        }
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(id.uuidString)")]
        guard let url = components.url else {
            throw NSError(domain: "PostgREST", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL components for receipt update"])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        try await applySupabaseHeaders(to: &req, contentType: "application/json", prefer: "return=minimal")

        var body: [String: Any] = [
            "merchant": jsonString(merchant),
            "date": date.map { ISO8601DateFormatter().string(from: $0) as Any } ?? NSNull(),
            "total": jsonDecimal(total),
            "currency": jsonString(receiptCurrency ?? currency),
            "raw_ocr_json": [
                "raw_text": rawText.map { AppSecurity.clippedSensitiveText($0) } ?? "",
                "receipt_amount": receiptAmount?.description ?? "",
                "receipt_currency": receiptCurrency ?? currency ?? "",
                "default_currency": defaultCurrency ?? "",
                "conversion_rate": conversionRate?.description ?? "",
                "converted_total": convertedTotal?.description ?? "",
                "category": category ?? "",
                "card_last4": PaymentMappingService.normalizedLast4(from: cardLast4) ?? "",
                "card_bank": cardBank ?? ""
            ] as Any
        ]

        if includeOptionalColumns {
            body["receipt_amount"] = jsonDecimal(receiptAmount)
            body["default_currency"] = jsonString(defaultCurrency)
            body["receipt_currency"] = jsonString(receiptCurrency ?? currency)
            body["conversion_rate"] = jsonDecimal(conversionRate)
            body["converted_total"] = jsonDecimal(convertedTotal)
            body["category"] = jsonString(category)
            body["card_last4"] = jsonString(PaymentMappingService.normalizedLast4(from: cardLast4))
            body["card_bank"] = jsonString(cardBank)
        }

        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: req)

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw postgrestError(prefix: "Update failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
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
        try await applySupabaseHeaders(to: &req, prefer: "return=minimal")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "Delete failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
        }
    }

    // MARK: - SMS inbox (iOS Shortcuts automation)

    struct SMSInboxRow {
        let id: UUID
        let body: String
        let sender: String?
        let receivedAt: Date?
    }

    /// Rows queued by the `receive-sms` Edge Function, oldest first, not yet successfully processed.
    /// Includes `failed` rows (e.g. a transient parsing/network error) so they get retried on the
    /// next scan instead of getting stuck forever.
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
        try await applySupabaseHeaders(to: &req)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "SMS inbox fetch failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
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

    /// Counts of rows awaiting attention, for surfacing inbox health in the app without a SQL query.
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
        try await applySupabaseHeaders(to: &req, prefer: "count=exact")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppSecurity.backendError(prefix: "SMS inbox count failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
        }

        let contentRange = http.value(forHTTPHeaderField: "Content-Range") ?? ""
        guard let totalString = contentRange.split(separator: "/").last, let total = Int(totalString) else {
            return 0
        }
        return total
    }

    /// Marks an `sms_inbox` row as processed/skipped/failed after the app has attempted to import it.
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
        try await applySupabaseHeaders(to: &req, contentType: "application/json", prefer: "return=minimal")

        var body: [String: Any] = [
            "status": status,
            "processed_at": ISO8601DateFormatter().string(from: Date())
        ]
        body["receipt_id"] = receiptId.map { $0.uuidString as Any } ?? NSNull()
        body["error_message"] = errorMessage.map { AppSecurity.clippedSensitiveText($0, limit: 500) as Any } ?? NSNull()

        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw postgrestError(prefix: "SMS inbox update failed", statusCode: (response as? HTTPURLResponse)?.statusCode, data: data)
        }
    }

    func insertReceiptToDB(parsed: ParsedReceipt, rawText: String? = nil, fileUrl: String?) async throws -> UUID {
        do {
            return try await insertReceiptToDB(parsed: parsed, rawText: rawText, fileUrl: fileUrl, includeOptionalColumns: true)
        } catch {
            guard isMissingColumnError(error) else { throw error }
            AppSecurity.debugLog("Optional receipt columns missing or not visible in Supabase schema cache for this insert. Retrying this one receipt with a legacy-compatible payload.")
            return try await insertReceiptToDB(parsed: parsed, rawText: rawText, fileUrl: fileUrl, includeOptionalColumns: false)
        }
    }

    private func insertReceiptToDB(parsed: ParsedReceipt, rawText: String?, fileUrl: String?, includeOptionalColumns: Bool) async throws -> UUID {
        let url = supabaseUrl.appendingPathComponent("/rest/v1/receipts")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        try await applySupabaseHeaders(to: &req, contentType: "application/json", prefer: "return=representation")

        let cardLast4 = parsed.cardLast4
        let receiptAmount = parsed.receipt_amount ?? parsed.total
        let receiptCurrency = parsed.receipt_currency ?? parsed.currency
        // user_id and household_id are NOT sent: the receipts_set_owner trigger
        // stamps them from auth.uid(). This used to live in the optional-columns
        // block below, which meant the legacy retry path silently dropped
        // ownership whenever a schema-cache miss occurred.
        //
        // visibility stays in the base body rather than the optional block: the
        // optional block is dropped wholesale on any missing-column error (and
        // default_currency et al genuinely do not exist), so anything placed
        // there would never actually be sent.
        var body: [String: Any] = [
            "merchant": jsonString(parsed.merchant),
            "date": jsonString(parsed.date),
            "total": jsonDecimal(parsed.total),
            "currency": jsonString(receiptCurrency),
            "file_url": jsonString(fileUrl),
            "visibility": parsed.visibility ?? "household",
            "raw_ocr_json": [
                "raw_text": rawText.map { AppSecurity.clippedSensitiveText($0) } ?? "",
                "extracted_digits": parsed.extracted_digits ?? "",
                "receipt_amount": receiptAmount?.description ?? "",
                "card_last4": cardLast4 ?? "",
                "card_bank": parsed.card_bank ?? "",
                "category": parsed.category ?? "",
                "default_currency": parsed.default_currency ?? "",
                "receipt_currency": receiptCurrency ?? "",
                "conversion_rate": parsed.conversion_rate?.description ?? "",
                "converted_total": parsed.converted_total?.description ?? "",
                "line_items": jsonLineItems(parsed.line_items)
            ] as Any
        ]

        if includeOptionalColumns {
            body["receipt_amount"] = jsonDecimal(receiptAmount)
            body["default_currency"] = jsonString(parsed.default_currency)
            body["receipt_currency"] = jsonString(receiptCurrency)
            body["conversion_rate"] = jsonDecimal(parsed.conversion_rate)
            body["converted_total"] = jsonDecimal(parsed.converted_total)
            body["category"] = jsonString(parsed.category)
            body["card_last4"] = jsonString(cardLast4)
            body["card_bank"] = jsonString(parsed.card_bank)
        }

        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (d, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw postgrestError(prefix: "Insert failed", statusCode: (resp as? HTTPURLResponse)?.statusCode, data: d)
        }

        if let arr = try JSONSerialization.jsonObject(with: d, options: []) as? [[String: Any]], let first = arr.first,
           let idStr = first["id"] as? String,
           let uuid = UUID(uuidString: idStr) {
            return uuid
        }

        throw NSError(domain: "PostgREST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not parse inserted id"])
    }
}

private final class SupabaseCredentialStore {
    let service: String
    let account: String

    init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    func loadSession() -> SupabaseAuthSession? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }

        return try? JSONDecoder().decode(SupabaseAuthSession.self, from: data)
    }

    func saveSession(_ session: SupabaseAuthSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        deleteSession()

        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    func deleteSession() {
        SecItemDelete(baseQuery() as CFDictionary)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
