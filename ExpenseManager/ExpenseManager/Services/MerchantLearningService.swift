import Foundation

/// Learns merchant-name and category corrections from the user's own edits, so the same sender
/// or merchant comes in pre-corrected on future scans instead of repeating the same mistake
/// (e.g. the LLM extracting "the FairPrice Group app" with no category every time). Stored
/// on-device — no backend schema required, mirrors the local-only Gmail scan bookkeeping already
/// used elsewhere in ReceiptStore.
enum MerchantLearningService {
    private static let storageKey = "ExpenseManager.merchantCorrections"

    struct Correction: Codable {
        var merchant: String
        var category: String?
    }

    /// A stable identity for "who this receipt is from". Prefers the sender's email address —
    /// present on every Gmail-sourced receipt's raw text and constant across re-scans — over the
    /// LLM's merchant guess, which can vary run to run for the exact same email.
    static func signature(rawText: String, merchant: String?) -> String? {
        if let senderRange = rawText.range(of: #"[\w.+-]+@[\w-]+\.[\w.-]+"#, options: .regularExpression) {
            return "sender:" + rawText[senderRange].lowercased()
        }
        guard let merchant = merchant?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !merchant.isEmpty else {
            return nil
        }
        return "merchant:" + merchant
    }

    private static var store: [String: Correction] {
        get {
            guard let data = UserDefaults.standard.data(forKey: storageKey),
                  let decoded = try? JSONDecoder().decode([String: Correction].self, from: data) else {
                return [:]
            }
            return decoded
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    /// Looks up a remembered correction for a freshly-parsed receipt before it's shown for review.
    static func lookup(rawText: String, merchant: String?) -> Correction? {
        guard let key = signature(rawText: rawText, merchant: merchant) else { return nil }
        return store[key]
    }

    /// Records a correction, keyed off the *original* (pre-correction) extraction so the next
    /// email/receipt from the same sender is recognized. Call this whenever the user's saved
    /// merchant or category differs from what was auto-extracted.
    static func remember(originalRawText: String, originalMerchant: String?, correctedMerchant: String?, correctedCategory: String?) {
        guard let key = signature(rawText: originalRawText, merchant: originalMerchant),
              let merchant = correctedMerchant?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty else {
            return
        }
        var current = store
        current[key] = Correction(merchant: merchant, category: correctedCategory?.nilIfEmpty)
        store = current
    }
}
