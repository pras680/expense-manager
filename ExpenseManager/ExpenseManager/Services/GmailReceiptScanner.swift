import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

struct GmailReceiptCandidate: Identifiable {
    let id: String
    let messageID: String
    let receivedDate: Date?
    let rawText: String
}

struct GmailReceiptScanResult {
    let searchedFrom: Date
    let searchedThrough: Date
    let scannedMessageCount: Int
    let latestIdentifiedEmailDate: Date?
    let receiptCandidates: [GmailReceiptCandidate]
}

enum GmailReceiptScannerError: LocalizedError {
    case missingGoogleClientID
    case signInRequired
    case authorizationCancelled
    case authorizationFailed
    case tokenExchangeFailed(String)
    case gmailRequestFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingGoogleClientID:
            return "Configure a Google iOS OAuth client ID for Gmail read-only access first."
        case .signInRequired:
            return "Sign in from the app once before scheduled Gmail scans can run."
        case .authorizationCancelled:
            return "Gmail authorization was cancelled."
        case .authorizationFailed:
            return "Gmail authorization did not return a valid code."
        case .tokenExchangeFailed:
            return "Gmail token exchange failed. Please sign in again."
        case .gmailRequestFailed:
            return "Gmail request failed. Please try again."
        }
    }
}

enum GmailOAuthConfiguration {
    static let maximumLookbackDays = 30
    static let scope = "https://www.googleapis.com/auth/gmail.readonly"

    // Replace this with an iOS OAuth client ID from Google Cloud Console.
    // The OAuth consent screen should request only the Gmail read-only scope above.
    static let clientID = "67367466500-0dbd8c58hb9h3lpaiorduqk8ob8vvmno.apps.googleusercontent.com"

    static var callbackURLScheme: String {
        guard clientID.hasSuffix(".apps.googleusercontent.com") else {
            return "com.googleusercontent.apps.YOUR_IOS_CLIENT_ID"
        }
        let prefix = clientID.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
        return "com.googleusercontent.apps.\(prefix)"
    }

    static var redirectURI: String {
        "\(callbackURLScheme):/oauth2redirect/google"
    }

    static var isConfigured: Bool {
        !clientID.contains("REPLACE_WITH") && !clientID.contains("YOUR_IOS_CLIENT_ID")
    }
}

final class GmailReceiptScanner: NSObject, ASWebAuthenticationPresentationContextProviding {
    var onProgress: ((String) -> Void)?

    private let credentialStore = GmailCredentialStore(service: "ExpenseManager.Gmail", account: "readonly")
    private var authSession: ASWebAuthenticationSession?
    private var currentOAuthState: String?

    func scanReceiptsSinceLastScan(lastScanDate: Date?, lookbackDays: Int? = nil, allowInteractiveAuth: Bool) async throws -> GmailReceiptScanResult {
        reportProgress("Preparing Gmail read-only scan...")
        guard GmailOAuthConfiguration.isConfigured else {
            throw GmailReceiptScannerError.missingGoogleClientID
        }

        let token = try await validAccessToken(allowInteractiveAuth: allowInteractiveAuth)
        let safeLookbackDays = min(max(lookbackDays ?? GmailOAuthConfiguration.maximumLookbackDays, 1), GmailOAuthConfiguration.maximumLookbackDays)
        reportProgress("Gmail authorized. Calculating safe \(safeLookbackDays)-day search window...")
        let now = Date()
        let oldestAllowed = Calendar.current.date(
            byAdding: .day,
            value: -safeLookbackDays,
            to: now
        ) ?? now.addingTimeInterval(TimeInterval(-safeLookbackDays * 24 * 60 * 60))
        let searchedFrom = max(lastScanDate ?? oldestAllowed, oldestAllowed)
        reportProgress("Searching Gmail from \(Self.displayDate(searchedFrom))...")
        let messages = try await listMessages(accessToken: token, searchedFrom: searchedFrom, lookbackDays: safeLookbackDays)
        reportProgress("Found \(messages.count) possible email\(messages.count == 1 ? "" : "s"). Reading messages...")
        var candidates: [GmailReceiptCandidate] = []

        for (index, messageRef) in messages.enumerated() {
            try Task.checkCancellation()
            reportProgress("Reading Gmail message \(index + 1) of \(messages.count)...")
            let message = try await fetchMessage(id: messageRef.id, accessToken: token)
            guard let candidate = receiptCandidate(from: message, searchedFrom: searchedFrom) else { continue }
            candidates.append(candidate)
            reportProgress("Receipt-like email found.")
        }

        let latestIdentifiedEmailDate = candidates.compactMap(\.receivedDate).max()
        if let latestIdentifiedEmailDate {
            reportProgress("Latest identified Gmail email date: \(Self.displayDate(latestIdentifiedEmailDate)).")
        }
        reportProgress("Finished reading Gmail. Found \(candidates.count) receipt-like email\(candidates.count == 1 ? "" : "s").")
        return GmailReceiptScanResult(
            searchedFrom: searchedFrom,
            searchedThrough: now,
            scannedMessageCount: messages.count,
            latestIdentifiedEmailDate: latestIdentifiedEmailDate,
            receiptCandidates: candidates
        )
    }

    func signOut() {
        credentialStore.deleteCredential()
    }

    private func validAccessToken(allowInteractiveAuth: Bool) async throws -> String {
        reportProgress("Checking saved Gmail credentials...")
        if let credential = credentialStore.loadCredential() {
            if credential.expiresAt > Date().addingTimeInterval(60) {
                reportProgress("Using saved Gmail access token.")
                return credential.accessToken
            }

            reportProgress("Refreshing Gmail access token...")
            if let refreshed = try await refreshCredential(credential) {
                credentialStore.saveCredential(refreshed)
                reportProgress("Gmail access token refreshed.")
                return refreshed.accessToken
            }
            reportProgress("Saved Gmail token could not be refreshed.")
        }

        guard allowInteractiveAuth else {
            throw GmailReceiptScannerError.signInRequired
        }

        reportProgress("Opening Google sign-in for Gmail read-only access...")
        let credential = try await authorizeInteractively()
        credentialStore.saveCredential(credential)
        reportProgress("Gmail sign-in complete. Credentials saved securely.")
        return credential.accessToken
    }

    @MainActor
    private func authorizeInteractively() async throws -> GmailOAuthCredential {
        let verifier = Self.makeCodeVerifier()
        let challenge = Self.makeCodeChallenge(from: verifier)
        let state = Self.makeRandomToken(byteCount: 16)
        currentOAuthState = state

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: GmailOAuthConfiguration.clientID),
            URLQueryItem(name: "redirect_uri", value: GmailOAuthConfiguration.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: GmailOAuthConfiguration.scope),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state)
        ]

        guard let authorizationURL = components.url else {
            currentOAuthState = nil
            throw GmailReceiptScannerError.authorizationFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authorizationURL,
                callbackURLScheme: GmailOAuthConfiguration.callbackURLScheme
            ) { [weak self] callbackURL, error in
                Task { @MainActor in
                    self?.authSession = nil

                    if error != nil {
                        self?.currentOAuthState = nil
                        continuation.resume(throwing: GmailReceiptScannerError.authorizationCancelled)
                        return
                    }

                    guard let callbackURL else {
                        self?.currentOAuthState = nil
                        continuation.resume(throwing: GmailReceiptScannerError.authorizationFailed)
                        return
                    }

                    do {
                        let code = try self?.validatedAuthorizationCode(from: callbackURL) ?? ""
                        guard !code.isEmpty else { throw GmailReceiptScannerError.authorizationFailed }
                        let credential = try await Self.exchangeAuthorizationCode(code, verifier: verifier)
                        continuation.resume(returning: credential)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            authSession = session

            if !session.start() {
                authSession = nil
                continuation.resume(throwing: GmailReceiptScannerError.authorizationFailed)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    private func validatedAuthorizationCode(from callbackURL: URL) throws -> String {
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
              !code.isEmpty,
              let returnedState = components.queryItems?.first(where: { $0.name == "state" })?.value,
              let expectedState = currentOAuthState,
              returnedState == expectedState else {
            currentOAuthState = nil
            throw GmailReceiptScannerError.authorizationFailed
        }
        currentOAuthState = nil
        return code
    }

    private func refreshCredential(_ credential: GmailOAuthCredential) async throws -> GmailOAuthCredential? {
        guard let refreshToken = credential.refreshToken else { return nil }

        let body = Self.formBody([
            "client_id": GmailOAuthConfiguration.clientID,
            "grant_type": "refresh_token",
            "refresh_token": refreshToken
        ])

        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            credentialStore.deleteCredential()
            return nil
        }

        let tokenResponse = try JSONDecoder().decode(GmailTokenResponse.self, from: data)
        return GmailOAuthCredential(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken ?? refreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(tokenResponse.expiresIn ?? 3600))
        )
    }

    private static func exchangeAuthorizationCode(_ code: String, verifier: String) async throws -> GmailOAuthCredential {
        let body = formBody([
            "client_id": GmailOAuthConfiguration.clientID,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": GmailOAuthConfiguration.redirectURI
        ])

        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            AppSecurity.debugLog("Gmail token exchange failed with status \(statusCode).")
            throw GmailReceiptScannerError.tokenExchangeFailed("status=\(statusCode)")
        }

        let tokenResponse = try JSONDecoder().decode(GmailTokenResponse.self, from: data)
        return GmailOAuthCredential(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(tokenResponse.expiresIn ?? 3600))
        )
    }

    private func listMessages(accessToken: String, searchedFrom: Date, lookbackDays: Int) async throws -> [GmailMessageReference] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy/MM/dd"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        let afterDate = formatter.string(from: searchedFrom)
        let queryTerms = [
            "receipt", "invoice", "bill", "\"tax invoice\"", "\"order confirmation\"", "\"payment confirmation\"",
            "itinerary", "\"flight itinerary\"", "\"travel itinerary\"", "\"booking confirmation\"", "\"e-ticket\"", "\"air ticket\"",
            "paynow", "\"pay now\"", "paylah", "\"fund transfer\"", "\"funds transfer\"", "\"bank transfer\"",
            "\"fast transfer\"", "\"transfer successful\"", "\"successful transfer\"", "\"payment alert\"", "\"transaction alert\"",
            "\"transaction notification\"", "\"debit advice\"", "\"paid to\"", "\"sent to\"", "\"transferred to\"", "uen",
            "\"credit card payment\"", "\"card bill payment\"", "\"payment to credit card\""
        ]
        let query = "newer_than:\(lookbackDays)d after:\(afterDate) {\(queryTerms.joined(separator: " "))}"
        AppSecurity.debugLog("Gmail search prepared for \(lookbackDays)d lookback after \(afterDate).")

        var allMessages: [GmailMessageReference] = []
        var pageToken: String?
        var pageNumber = 1

        repeat {
            try Task.checkCancellation()
            reportProgress("Searching Gmail page \(pageNumber)...")
            var components = URLComponents(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages")!
            var queryItems = [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(name: "maxResults", value: "50")
            ]
            if let pageToken {
                queryItems.append(URLQueryItem(name: "pageToken", value: pageToken))
            }
            components.queryItems = queryItems

            guard let url = components.url else { break }
            var request = URLRequest(url: url)
            request.timeoutInterval = 30
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                AppSecurity.debugLog("Gmail list request failed with status \(statusCode).")
                throw GmailReceiptScannerError.gmailRequestFailed("status=\(statusCode)")
            }

            let result = try JSONDecoder().decode(GmailListResponse.self, from: data)
            allMessages.append(contentsOf: result.messages ?? [])
            pageToken = result.nextPageToken
            pageNumber += 1
        } while pageToken != nil && allMessages.count < 100

        return Array(allMessages.prefix(100))
    }

    private func fetchMessage(id: String, accessToken: String) async throws -> GmailAPIMessage {
        var components = URLComponents(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(id)")!
        components.queryItems = [URLQueryItem(name: "format", value: "full")]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 30
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            AppSecurity.debugLog("Gmail message fetch failed with status \(statusCode).")
            throw GmailReceiptScannerError.gmailRequestFailed("status=\(statusCode)")
        }

        return try JSONDecoder().decode(GmailAPIMessage.self, from: data)
    }

    private func receiptCandidate(from message: GmailAPIMessage, searchedFrom: Date) -> GmailReceiptCandidate? {
        guard let payload = message.payload else { return nil }
        let receivedDate = message.receivedDate
        if let receivedDate, receivedDate < searchedFrom { return nil }

        let subject = Self.headerValue("subject", in: payload.headers) ?? "Gmail receipt"
        let sender = Self.headerValue("from", in: payload.headers) ?? "Unknown sender"
        let emailDate = Self.headerValue("date", in: payload.headers) ?? ""
        let body = Self.extractText(from: payload)
        let combined = """
        Email Subject: \(subject)
        Email From: \(sender)
        Email Date: \(emailDate)

        \(body.isEmpty ? message.snippet ?? "" : body)
        """
        let normalized = combined.lowercased()
        AppSecurity.debugLog("Gmail email scanned: id=\(message.id), date=\(Self.displayOptionalDate(receivedDate)).")

        guard Self.looksLikeReceipt(normalized) else {
            AppSecurity.debugLog("Gmail email skipped: id=\(message.id), reason=\(Self.rejectionReason(for: normalized)).")
            return nil
        }

        AppSecurity.debugLog("Gmail email identified: id=\(message.id), type=\(Self.identificationReason(for: normalized)).")
        return GmailReceiptCandidate(
            id: message.id,
            messageID: message.id,
            receivedDate: receivedDate,
            rawText: AppSecurity.clippedSensitiveText(combined)
        )
    }

    private static let receiptTerms = [
        "receipt",
        "invoice",
        "bill",
        "tax invoice",
        "payment confirmation",
        "payment received",
        "order confirmation",
        "booking confirmation",
        "flight itinerary",
        "travel itinerary",
        "itinerary",
        "e-ticket",
        "air ticket",
        "amount paid",
        "total paid"
    ]

    private static let paymentAlertTerms = [
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
        "you have paid",
        "paid to",
        "sent to",
        "transferred to",
        "payment to",
        "uen",
        "credit card payment",
        "card bill payment",
        "payment to credit card",
        "credit card bill"
    ]

    private static func looksLikeReceipt(_ text: String) -> Bool {
        (containsAny(receiptTerms, in: text) || containsAny(paymentAlertTerms, in: text)) && containsAmount(in: text)
    }

    private static func identificationReason(for text: String) -> String {
        if containsAny(paymentAlertTerms, in: text) {
            return "PayNow/bank-transfer/payment alert"
        }
        if containsAny(["flight itinerary", "travel itinerary", "itinerary", "e-ticket", "air ticket", "booking confirmation"], in: text) {
            return "travel itinerary/booking"
        }
        if containsAny(receiptTerms, in: text) {
            return "receipt/bill"
        }
        return "unknown"
    }

    private static func rejectionReason(for text: String) -> String {
        let hasTerm = containsAny(receiptTerms, in: text) || containsAny(paymentAlertTerms, in: text)
        let hasAmount = containsAmount(in: text)
        if !hasTerm && !hasAmount { return "no receipt/paynow keyword and no amount" }
        if !hasTerm { return "no receipt/paynow keyword" }
        if !hasAmount { return "no amount found" }
        return "not receipt-like"
    }

    private static func containsAny(_ terms: [String], in text: String) -> Bool {
        terms.contains { text.contains($0) }
    }

    private static func containsAmount(in text: String) -> Bool {
        text.range(of: #"(?:(?:[$€£¥₹]|sgd|s\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|(?:[$€£¥₹]|sgd|s\$)\s?\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func headerValue(_ name: String, in headers: [GmailHeader]?) -> String? {
        headers?.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value
    }

    private static func extractText(from payload: GmailPayload) -> String {
        var pieces: [String] = []

        if payload.mimeType == "text/plain", let text = decodedBody(payload.body?.data) {
            pieces.append(text)
        } else if payload.mimeType == "text/html", let html = decodedBody(payload.body?.data) {
            pieces.append(stripHTML(html))
        }

        for part in payload.parts ?? [] {
            let partText = extractText(from: part)
            if !partText.isEmpty {
                pieces.append(partText)
            }
        }

        return pieces.joined(separator: "\n")
    }

    private static func decodedBody(_ encoded: String?) -> String? {
        guard var encoded else { return nil }
        encoded = encoded.replacingOccurrences(of: "-", with: "+")
        encoded = encoded.replacingOccurrences(of: "_", with: "/")
        let padding = (4 - encoded.count % 4) % 4
        encoded.append(String(repeating: "=", count: padding))
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func stripHTML(_ html: String) -> String {
        var text = html.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: "</p>", with: "\n", options: .caseInsensitive)
        text = text.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        let entities: [String: String] = [
            "&nbsp;": " ",
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": "\"",
            "&#39;": "'"
        ]
        for (entity, value) in entities {
            text = text.replacingOccurrences(of: entity, with: value)
        }
        return text.replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
    }

    private func reportProgress(_ message: String) {
        AppSecurity.debugLog("Gmail agent: \(message)")
        onProgress?(message)
    }

    private static func displayDate(_ date: Date) -> String {
        DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }

    private static func displayOptionalDate(_ date: Date?) -> String {
        guard let date else { return "unknown" }
        return displayDate(date)
    }

    private static func makeCodeVerifier() -> String {
        makeRandomToken(byteCount: 32)
    }

    private static func makeRandomToken(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { return UUID().uuidString }
        return Data(bytes).base64URLEncodedString()
    }

    private static func makeCodeChallenge(from verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64URLEncodedString()
    }

    private static func formBody(_ parameters: [String: String]) -> Data {
        var components = URLComponents()
        components.queryItems = parameters.map { URLQueryItem(name: $0.key, value: $0.value) }
        return Data((components.percentEncodedQuery ?? "").utf8)
    }
}

private struct GmailOAuthCredential: Codable {
    let accessToken: String
    let refreshToken: String?
    let expiresAt: Date
}

private struct GmailTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

private struct GmailListResponse: Decodable {
    let messages: [GmailMessageReference]?
    let nextPageToken: String?
}

private struct GmailMessageReference: Decodable {
    let id: String
}

private struct GmailAPIMessage: Decodable {
    let id: String
    let internalDate: String?
    let snippet: String?
    let payload: GmailPayload?

    var receivedDate: Date? {
        guard let internalDate, let milliseconds = Double(internalDate) else { return nil }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }
}

private struct GmailPayload: Decodable {
    let mimeType: String?
    let headers: [GmailHeader]?
    let body: GmailBody?
    let parts: [GmailPayload]?
}

private struct GmailHeader: Decodable {
    let name: String
    let value: String
}

private struct GmailBody: Decodable {
    let data: String?
}

private final class GmailCredentialStore {
    let service: String
    let account: String

    init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    func loadCredential() -> GmailOAuthCredential? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }

        return try? JSONDecoder().decode(GmailOAuthCredential.self, from: data)
    }

    func saveCredential(_ credential: GmailOAuthCredential) {
        guard let data = try? JSONEncoder().encode(credential) else { return }
        deleteCredential()

        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    func deleteCredential() {
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

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
