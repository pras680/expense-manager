import Foundation
import Security

/// A single message pulled from the Telegram bot.
struct TelegramMessage: Identifiable {
    let id: Int
    let text: String
    let date: Date?
}

struct TelegramBotIdentity {
    let id: Int
    let username: String?
    let firstName: String?

    var displayName: String {
        if let username, !username.isEmpty {
            return "@\(username)"
        }
        if let firstName, !firstName.isEmpty {
            return firstName
        }
        return "bot id \(id)"
    }
}

enum TelegramServiceError: LocalizedError {
    case missingToken
    case invalidToken
    case requestFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingToken:
            return "Add your Telegram bot token first, then tap Fetch from Telegram."
        case .invalidToken:
            return "That Telegram bot token was rejected. Double-check it with @BotFather."
        case .requestFailed:
            return "Could not reach Telegram. Please check your connection and try again."
        }
    }
}

/// Reads messages relayed to a Telegram bot (SMS forwarded from iMessage).
/// The app acts as a Telegram client and polls `getUpdates`, tracking the last
/// processed `update_id` so each message is only read once.
enum TelegramConfiguration {
    /// Paste your bot token from @BotFather here to hardcode it (optional).
    /// Leave as the placeholder to require entering the token in-app instead.
    /// A token saved in the Keychain (via the Scan SMS screen) always overrides this.
    static let hardcodedBotToken = "8709896476:AAFpjU73bcteumBHiXicIHSywYZQyjK9i6Y"

    static var hardcodedTokenIfAvailable: String? {
        let trimmed = hardcodedBotToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("REPLACE_WITH") else { return nil }
        return trimmed
    }
}

actor TelegramService {
    private let credentialStore = TelegramCredentialStore(service: "ExpenseManager.Telegram", account: "botToken")
    private let lastUpdateIdKey = "telegramLastUpdateId"

    // MARK: - Token management

    /// The active token, preferring a Keychain-saved token, then the hardcoded fallback.
    private func resolvedToken() -> String? {
        if let stored = credentialStore.loadToken(), !stored.isEmpty {
            return stored
        }
        return TelegramConfiguration.hardcodedTokenIfAvailable
    }

    nonisolated func isConfigured() -> Bool {
        if let stored = credentialStore.loadToken(), !stored.isEmpty {
            return true
        }
        return TelegramConfiguration.hardcodedTokenIfAvailable != nil
    }

    func saveToken(_ token: String) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            clearToken()
            return
        }
        credentialStore.saveToken(trimmed)
    }

    func clearToken() {
        credentialStore.deleteToken()
    }

    func fetchBotIdentity() async throws -> TelegramBotIdentity {
        guard let token = resolvedToken(), !token.isEmpty else {
            AppSecurity.debugLog("Telegram getMe aborted: no bot token configured.")
            throw TelegramServiceError.missingToken
        }

        guard let url = URL(string: "https://api.telegram.org/bot\(token)/getMe") else {
            AppSecurity.debugLog("Telegram getMe failed: invalid URL.")
            throw TelegramServiceError.requestFailed("bad url")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch {
            AppSecurity.debugLog("Telegram getMe network request failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            throw TelegramServiceError.requestFailed(AppSecurity.redactedDiagnostic(error.localizedDescription))
        }

        if let httpResponse = response as? HTTPURLResponse {
            AppSecurity.debugLog("Telegram getMe HTTP status=\(httpResponse.statusCode), bytes=\(data.count)")
            if httpResponse.statusCode == 401 || httpResponse.statusCode == 404 {
                throw TelegramServiceError.invalidToken
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                throw TelegramServiceError.requestFailed("status \(httpResponse.statusCode)")
            }
        }

        let decoded: TelegramGetMeResponse
        do {
            decoded = try JSONDecoder().decode(TelegramGetMeResponse.self, from: data)
        } catch {
            AppSecurity.debugLog("Telegram getMe decode failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            throw TelegramServiceError.requestFailed(AppSecurity.redactedDiagnostic(error.localizedDescription))
        }

        guard decoded.ok else {
            AppSecurity.debugLog("Telegram getMe response was not ok.")
            throw TelegramServiceError.invalidToken
        }

        let identity = TelegramBotIdentity(id: decoded.result.id, username: decoded.result.username, firstName: decoded.result.firstName)
        AppSecurity.debugLog("Telegram active bot identity: \(identity.displayName), id=\(identity.id), firstName=\(identity.firstName ?? "n/a")")
        return identity
    }

    // MARK: - Fetching

    /// Fetches new messages since the last processed update and advances the stored offset.
    func fetchNewMessages() async throws -> [TelegramMessage] {
        guard let token = resolvedToken(), !token.isEmpty else {
            AppSecurity.debugLog("Telegram fetch aborted: no bot token configured.")
            throw TelegramServiceError.missingToken
        }

        let previousOffset = storedOffset()
        var components = URLComponents(string: "https://api.telegram.org/bot\(token)/getUpdates")
        var queryItems = [
            URLQueryItem(name: "timeout", value: "0"),
            URLQueryItem(name: "allowed_updates", value: #"["message","channel_post","edited_message","edited_channel_post"]"#)
        ]
        if let offset = previousOffset {
            queryItems.append(URLQueryItem(name: "offset", value: String(offset + 1)))
        }
        components?.queryItems = queryItems

        guard let url = components?.url else {
            AppSecurity.debugLog("Telegram fetch failed: invalid getUpdates URL.")
            throw TelegramServiceError.requestFailed("bad url")
        }

        AppSecurity.debugLog("Telegram getUpdates request started. previousOffset=\(previousOffset.map(String.init) ?? "none")")
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch {
            AppSecurity.debugLog("Telegram network request failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            throw TelegramServiceError.requestFailed(AppSecurity.redactedDiagnostic(error.localizedDescription))
        }

        if let httpResponse = response as? HTTPURLResponse {
            AppSecurity.debugLog("Telegram getUpdates HTTP status=\(httpResponse.statusCode), bytes=\(data.count)")
            if httpResponse.statusCode == 401 || httpResponse.statusCode == 404 {
                throw TelegramServiceError.invalidToken
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                throw TelegramServiceError.requestFailed("status \(httpResponse.statusCode)")
            }
        }

        let decoded: TelegramGetUpdatesResponse
        do {
            decoded = try JSONDecoder().decode(TelegramGetUpdatesResponse.self, from: data)
        } catch {
            AppSecurity.debugLog("Telegram response decode failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            throw TelegramServiceError.requestFailed(AppSecurity.redactedDiagnostic(error.localizedDescription))
        }

        guard decoded.ok else {
            AppSecurity.debugLog("Telegram response was not ok.")
            throw TelegramServiceError.invalidToken
        }

        var messages: [TelegramMessage] = []
        var highestUpdateId = previousOffset
        var lastTextMessage: TelegramMessage? = nil

        for update in decoded.result {
            highestUpdateId = max(highestUpdateId ?? update.updateId, update.updateId)
            let apiMessage = update.message ?? update.editedMessage ?? update.channelPost ?? update.editedChannelPost
            let rawText = apiMessage?.text ?? apiMessage?.caption
            guard let rawText, !rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                AppSecurity.debugLog("Telegram update \(update.updateId) skipped: no text/caption payload.")
                continue
            }
            let date = apiMessage?.date.map { Date(timeIntervalSince1970: TimeInterval($0)) }
            let message = TelegramMessage(id: update.updateId, text: rawText, date: date)
            messages.append(message)
            lastTextMessage = message
        }

        if decoded.result.isEmpty {
            await logZeroUpdateDiagnostics(token: token)
        }

        let lastProcessedAfter = highestUpdateId.map(String.init) ?? "unchanged"
        let lastSmsDescription = lastTextMessage.map { message in
            "lastSmsProcessed=updateId \(message.id), date=\(telegramDebugDate(message.date)), preview=\"\(telegramDebugPreview(message.text))\""
        } ?? "lastSmsProcessed=none"
        AppSecurity.debugLog("Telegram fetch summary: lastProcessedBefore=\(previousOffset.map(String.init) ?? "none"), newUpdatesSinceThen=\(decoded.result.count), newSmsSinceThen=\(messages.count), lastProcessedAfter=\(lastProcessedAfter), \(lastSmsDescription)")

        if let highestUpdateId, highestUpdateId != previousOffset {
            saveOffset(highestUpdateId)
            AppSecurity.debugLog("Telegram offset advanced to \(highestUpdateId). textMessages=\(messages.count), rawUpdates=\(decoded.result.count)")
        } else if let previousOffset {
            AppSecurity.debugLog("Telegram offset unchanged at \(previousOffset). textMessages=\(messages.count), rawUpdates=\(decoded.result.count)")
        } else {
            AppSecurity.debugLog("Telegram fetch complete. rawUpdates=0, textMessages=0, offset unchanged.")
        }

        return messages
    }

    // MARK: - Offset persistence

    private func storedOffset() -> Int? {
        let value = UserDefaults.standard.integer(forKey: lastUpdateIdKey)
        return value == 0 ? nil : value
    }

    private func saveOffset(_ offset: Int) {
        UserDefaults.standard.set(offset, forKey: lastUpdateIdKey)
    }

    private func telegramDebugDate(_ date: Date?) -> String {
        guard let date else { return "unknown" }
        return ISO8601DateFormatter().string(from: date)
    }

    private func telegramDebugPreview(_ text: String) -> String {
        let flattened = text
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let redactedLongNumbers = flattened.replacingOccurrences(
            of: #"\b\d{6,}\b"#,
            with: "[digits]",
            options: .regularExpression
        )
        return String(redactedLongNumbers.prefix(120))
    }

    private func logZeroUpdateDiagnostics(token: String) async {
        guard let url = URL(string: "https://api.telegram.org/bot\(token)/getWebhookInfo") else {
            AppSecurity.debugLog("Telegram zero-update diagnostics skipped: invalid getWebhookInfo URL.")
            return
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let httpResponse = response as? HTTPURLResponse {
                AppSecurity.debugLog("Telegram getWebhookInfo HTTP status=\(httpResponse.statusCode), bytes=\(data.count)")
            }

            let decoded = try JSONDecoder().decode(TelegramWebhookInfoResponse.self, from: data)
            guard decoded.ok else {
                AppSecurity.debugLog("Telegram zero-update diagnostics: getWebhookInfo returned ok=false.")
                return
            }

            let info = decoded.result
            let webhookConfigured = !(info.url ?? "").isEmpty
            let lastErrorDate = info.lastErrorDate.map { Date(timeIntervalSince1970: TimeInterval($0)) }.map(telegramDebugDate) ?? "none"
            AppSecurity.debugLog("Telegram zero-update diagnostics: webhookConfigured=\(webhookConfigured), pendingUpdateCount=\(info.pendingUpdateCount), allowedUpdates=\(info.allowedUpdates?.joined(separator: ",") ?? "default"), lastErrorDate=\(lastErrorDate), lastErrorMessage=\(info.lastErrorMessage ?? "none")")
            AppSecurity.debugLog("Telegram zero-update explanation: Bot API returned no queued updates. Existing Telegram chat history cannot be pulled by getUpdates; send/forward a new message to the bot after this build and fetch again.")
        } catch {
            AppSecurity.debugLog("Telegram zero-update diagnostics failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }
}

// MARK: - Decodable payloads

private struct TelegramGetUpdatesResponse: Decodable {
    let ok: Bool
    let result: [TelegramUpdate]
}

private struct TelegramGetMeResponse: Decodable {
    let ok: Bool
    let result: TelegramBotUser
}

private struct TelegramBotUser: Decodable {
    let id: Int
    let username: String?
    let firstName: String?

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case firstName = "first_name"
    }
}

private struct TelegramUpdate: Decodable {
    let updateId: Int
    let message: TelegramApiMessage?
    let editedMessage: TelegramApiMessage?
    let channelPost: TelegramApiMessage?
    let editedChannelPost: TelegramApiMessage?

    enum CodingKeys: String, CodingKey {
        case updateId = "update_id"
        case message
        case editedMessage = "edited_message"
        case channelPost = "channel_post"
        case editedChannelPost = "edited_channel_post"
    }
}

private struct TelegramApiMessage: Decodable {
    let text: String?
    let caption: String?
    let date: Int?
}

private struct TelegramWebhookInfoResponse: Decodable {
    let ok: Bool
    let result: TelegramWebhookInfo
}

private struct TelegramWebhookInfo: Decodable {
    let url: String?
    let pendingUpdateCount: Int
    let lastErrorDate: Int?
    let lastErrorMessage: String?
    let allowedUpdates: [String]?

    enum CodingKeys: String, CodingKey {
        case url
        case pendingUpdateCount = "pending_update_count"
        case lastErrorDate = "last_error_date"
        case lastErrorMessage = "last_error_message"
        case allowedUpdates = "allowed_updates"
    }
}

// MARK: - Keychain

private final class TelegramCredentialStore {
    let service: String
    let account: String

    init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    func loadToken() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    func saveToken(_ token: String) {
        guard let data = token.data(using: .utf8) else { return }
        deleteToken()

        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    func deleteToken() {
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
