import Foundation
import Combine
import PhotosUI
import SwiftUI
import UIKit

@MainActor
class ReceiptStore: ObservableObject {
    @Published var invoices: [Invoice] = []
    @Published var isProcessing = false
    @Published var statusMessage: String? = nil
    @Published var showScanner = false
    @Published var showPhotoPicker = false
    @Published var selectedPhoto: PhotosPickerItem? = nil
    @Published var pendingReceipts: [PendingReceipt] = []
    @Published var showPendingReview = false
    @Published var savingPendingReceiptIDs: Set<UUID> = []
    @Published var editingInvoice: Invoice? = nil
    @Published var searchText = ""
    @Published var selectedFilter: ReceiptFilter = .all
    @Published var paymentMethods: [PaymentMethod] = []

    @Published var showSMSImport = false
    @Published var smsInboxPendingCount: Int? = nil
    @Published var smsInboxFailedCount: Int? = nil
    @Published var smsInboxFetchLog: String? = nil
    @Published var gmailFetchLog: String? = nil
    @Published var gmailIsScanning = false
    @Published var gmailScanResult: GmailReceiptScanResult? = nil
    @Published var isImportingGmailResult = false

    let supabaseService: SupabaseService
    private let paymentMappingService: PaymentMappingService
    private let ocr = OCRService()
    private let calendar = Calendar.current
    private let gmailScanner = GmailReceiptScanner()
    private static let lastGmailScanDateKey = "ExpenseManager.lastGmailScanDate"
    private static let importedGmailMessageIDsKey = "ExpenseManager.importedGmailMessageIDs"

    private var lastGmailScanDate: Date? {
        get { UserDefaults.standard.object(forKey: Self.lastGmailScanDateKey) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: Self.lastGmailScanDateKey) }
    }

    /// Gmail message IDs already shown to the user in a scan (approved or rejected doesn't
    /// matter, either way they've been reviewed) so a re-scan never re-surfaces the same email
    /// as "new" again — this is what was missing before and let the same forwarded receipt get
    /// imported more than once. Stored oldest-first and capped so it can't grow without bound.
    private var importedGmailMessageIDs: [String] {
        get { UserDefaults.standard.stringArray(forKey: Self.importedGmailMessageIDsKey) ?? [] }
        set { UserDefaults.standard.set(Array(newValue.suffix(2000)), forKey: Self.importedGmailMessageIDsKey) }
    }

    private func rememberImportedGmailMessages(_ ids: [String]) {
        var current = importedGmailMessageIDs
        let known = Set(current)
        current.append(contentsOf: ids.filter { !known.contains($0) })
        importedGmailMessageIDs = current
    }

    struct PendingReceipt: Identifiable {
        let id: UUID
        var invoice: Invoice
        var imageData: Data?
    }

    struct CardSpendSummary: Identifiable {
        let id: String
        let bank: String
        let last4: String?
        let amount: Decimal
        let receiptCount: Int

        var displayName: String {
            if let last4 {
                return "\(bank) •••• \(last4)"
            }
            return bank
        }
    }

    struct SpendSummary: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let amount: Decimal
        let receiptCount: Int
    }

    enum ReceiptFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case last30Days = "Last 30 Days"
        case noDate = "No Date"

        var id: String { rawValue }
    }

    init(supabaseService: SupabaseService) {
        self.supabaseService = supabaseService
        self.paymentMappingService = PaymentMappingService(
            supabaseUrl: supabaseService.supabaseUrl.absoluteString,
            supabaseAnonKey: supabaseService.supabaseAnonKey
        )
    }

    var filteredInvoices: [Invoice] {
        invoices.filter { invoice in
            let matchesSearch = searchText.isEmpty || invoice.matches(searchText)
            guard matchesSearch else { return false }

            switch selectedFilter {
            case .all:
                return true
            case .last30Days:
                return invoice.date.map { calendar.dateComponents([.day], from: $0, to: Date()).day ?? 999 < 30 } ?? false
            case .noDate:
                return invoice.date == nil
            }
        }
    }

    var totalSpend: Decimal {
        invoices.compactMap { $0.total }.reduce(0, +)
    }

    var monthlySpend: Decimal {
        invoices
            .filter { invoice in
                guard let date = invoice.date else { return false }
                return calendar.isDate(date, equalTo: Date(), toGranularity: .month)
            }
            .compactMap { $0.total }
            .reduce(0, +)
    }

    var receiptCount: Int {
        invoices.count
    }

    var recentInvoices: [Invoice] {
        invoices.sorted(by: { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }).prefix(4).map { $0 }
    }

    var availableCardLast4Options: [String] {
        Array(Set((paymentMethods.map(\.lastDigits) + invoices.compactMap { $0.cardLast4?.nilIfEmpty })))
            .sorted()
    }

    var availableCardBankOptions: [String] {
        Array(Set((paymentMethods.map(\.bankName) + invoices.compactMap { $0.cardBank?.nilIfEmpty })))
            .sorted()
    }

    var categorySpendSummaries: [SpendSummary] {
        groupedSpend { invoice in
            let category = invoice.category?.nilIfEmpty ?? "Miscellaneous"
            return (id: category, title: category, subtitle: "Expense category")
        }
    }

    var monthlySpendSummaries: [SpendSummary] {
        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy-MM"
        let titleFormatter = DateFormatter()
        titleFormatter.dateFormat = "MMM yyyy"

        return groupedSpend { invoice in
            guard let date = invoice.date else {
                return (id: "unknown", title: "No Date", subtitle: "Receipts without a date")
            }
            return (id: monthFormatter.string(from: date), title: titleFormatter.string(from: date), subtitle: "Monthly spend")
        }
    }

    var cardSpendSummaries: [CardSpendSummary] {
        var grouped: [String: (bank: String, last4: String?, amount: Decimal, receiptCount: Int)] = [:]

        for invoice in invoices {
            let bank = invoice.cardBank?.nilIfEmpty ?? "Unknown Bank"
            let last4 = invoice.cardLast4?.nilIfEmpty
            let key = "\(bank)|\(last4 ?? "unknown")"
            let existing = grouped[key] ?? (bank: bank, last4: last4, amount: 0, receiptCount: 0)
            grouped[key] = (
                bank: bank,
                last4: last4,
                amount: existing.amount + (invoice.total ?? 0),
                receiptCount: existing.receiptCount + 1
            )
        }

        return grouped.map { key, value in
            CardSpendSummary(
                id: key,
                bank: value.bank,
                last4: value.last4,
                amount: value.amount,
                receiptCount: value.receiptCount
            )
        }
        .sorted { $0.amount > $1.amount }
    }

    var cardSpendReportSummaries: [SpendSummary] {
        cardSpendSummaries.map { summary in
            SpendSummary(
                id: summary.id,
                title: summary.displayName,
                subtitle: "\(summary.receiptCount) receipt\(summary.receiptCount == 1 ? "" : "s")",
                amount: summary.amount,
                receiptCount: summary.receiptCount
            )
        }
    }

    private func groupedSpend(keyProvider: (Invoice) -> (id: String, title: String, subtitle: String)) -> [SpendSummary] {
        var grouped: [String: (title: String, subtitle: String, amount: Decimal, receiptCount: Int)] = [:]

        for invoice in invoices {
            let key = keyProvider(invoice)
            let existing = grouped[key.id] ?? (title: key.title, subtitle: key.subtitle, amount: 0, receiptCount: 0)
            grouped[key.id] = (
                title: key.title,
                subtitle: key.subtitle,
                amount: existing.amount + (invoice.total ?? 0),
                receiptCount: existing.receiptCount + 1
            )
        }

        return grouped.map { id, value in
            SpendSummary(
                id: id,
                title: value.title,
                subtitle: value.subtitle,
                amount: value.amount,
                receiptCount: value.receiptCount
            )
        }
        .sorted { $0.amount > $1.amount }
    }

    var weeklySpendByDay: [(label: String, amount: Decimal)] {
        let today = calendar.startOfDay(for: Date())
        let labels = (0..<7).reversed().compactMap { offset -> Date? in
            calendar.date(byAdding: .day, value: -offset, to: today)
        }

        var amounts = Dictionary(uniqueKeysWithValues: labels.map { ($0, Decimal(0)) })

        for invoice in invoices {
            guard let date = invoice.date else { continue }
            let day = calendar.startOfDay(for: date)
            if amounts[day] != nil {
                amounts[day]? += invoice.total ?? 0
            }
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "E"

        return labels.map { date in
            (label: formatter.string(from: date), amount: amounts[date] ?? 0)
        }
    }

    /// Newest-first by receipt date (undated receipts sort last) — the order the Receipts tab,
    /// search, and filters all display.
    private func resortInvoices() {
        invoices.sort { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }

    func loadReceipts() async {
        isProcessing = true
        statusMessage = "Loading receipts..."

        do {
            invoices = try await supabaseService.fetchReceipts()
            resortInvoices()
            await loadPaymentMethods()
            statusMessage = "Loaded \(invoices.count) receipts"
        } catch {
            invoices = []
            await loadPaymentMethods()
            statusMessage = "Receipts will save after backend access is configured."
            print("DEBUG: fetch receipts failed: \(error.localizedDescription)")
        }

        isProcessing = false
    }

    func loadPaymentMethods() async {
        do {
            paymentMethods = try await paymentMappingService.fetchPaymentMethods()
        } catch {
            paymentMethods = []
            print("DEBUG: payment methods fetch failed: \(error.localizedDescription)")
        }
    }

    func processScannerResult(_ result: Result<[ScannerImage], Error>) async {
        showScanner = false
        print("DEBUG: scanner result received")
        
        switch result {
        case .success(let images):
            print("DEBUG: scanner captured \(images.count) image(s)")
            // Small delay to ensure scanner sheet closes before pending receipt sheet opens
            try? await Task.sleep(nanoseconds: 300_000_000) // 0.3 seconds
            await processImages(images)
        case .failure(let error):
            statusMessage = error.localizedDescription
            print("DEBUG: scanner failed: \(error.localizedDescription)")
        }
    }

    func processImages(_ images: [ScannerImage]) async {
        guard !images.isEmpty else {
            statusMessage = "No receipt pages found."
            return
        }

        isProcessing = true
        statusMessage = "Extracting receipt data..."
        print("DEBUG: starting processing of \(images.count) scanned image(s)")

        for image in images {
            do {
                try await processImage(image)
            } catch {
                statusMessage = "Receipt processing failed: \(error.localizedDescription)"
                print("DEBUG: processImage failed: \(error.localizedDescription)")
                isProcessing = false
                return
            }
        }

        isProcessing = false
        statusMessage = "Receipt ready for review"
        print("DEBUG: receipt ready for review")
    }

    func importPhotoItem(_ item: PhotosPickerItem?) async {
        guard let item = item else { return }

        isProcessing = true
        statusMessage = "Importing image..."
        showPhotoPicker = false
        selectedPhoto = nil
        print("DEBUG: photo item selected")

        do {
            if let data = try await item.loadTransferable(type: Data.self), let uiImage = UIImage(data: data) {
                statusMessage = "Processing receipt..."
                try await processImage(uiImage)
                statusMessage = "Receipt ready for review"
                print("DEBUG: photo import processed")
            } else {
                statusMessage = "Unable to load image from library."
                print("DEBUG: failed to load photo item data")
            }
        } catch {
            statusMessage = "Import failed: \(error.localizedDescription)"
            print("DEBUG: photo import error: \(error.localizedDescription)")
        }

        isProcessing = false
    }

    func processImage(_ image: ScannerImage) async throws {
        let rawText = try await ocr.recognizeText(from: image)
        try await processExtractedText(rawText, imageData: image.jpegData(compressionQuality: 0.8))
    }

    func processExtractedText(_ rawText: String, imageData: Data?, fallbackDate: Date? = nil) async throws {
        // Skip candidates that are already saved (e.g. the same email content re-surfaced by a
        // second Gmail scan, or a receipt re-scanned from the same photo) before spending an
        // edge-function call parsing it. This is the primary duplicate guard; approvePendingReceipt
        // re-checks right before the DB write as a second line of defense.
        if let duplicate = existingInvoice(matchingRawText: rawText) {
            statusMessage = "Skipped — already saved as \(duplicate.merchant ?? "a receipt") (\(duplicate.total.map { $0.formatted(.currency(code: duplicate.currency ?? Invoice.defaultCurrency)) } ?? "no amount"))."
            print("DEBUG: processExtractedText skipped duplicate of \(duplicate.id)")
            return
        }

        let parsed: ParsedReceipt

        do {
            parsed = try await supabaseService.parseReceiptWithEdge(rawText: rawText)
        } catch {
            let fallbackInvoice = InvoiceParser.parse(from: rawText)
            parsed = ParsedReceipt(
                merchant: fallbackInvoice.merchant,
                date: fallbackInvoice.date.map { ISO8601DateFormatter().string(from: $0) },
                total: fallbackInvoice.total,
                currency: fallbackInvoice.currency ?? Invoice.defaultCurrency,
                extracted_digits: fallbackInvoice.cardLast4,
                card_last4: fallbackInvoice.cardLast4,
                card_bank: nil,
                category: fallbackInvoice.category,
                line_items: nil
            )
            statusMessage = "Cloud parsing unavailable; using on-device extraction."
            print("DEBUG: edge parse failed, using local parser: \(error.localizedDescription)")
        }

        var invoice = Invoice(from: parsed, rawText: rawText)
        invoice.currency = parsed.currency ?? Invoice.defaultCurrency
        invoice.cardLast4 = invoice.cardLast4 ?? PaymentMappingService.extractCardLast4(from: rawText)
        invoice.date = invoice.date ?? fallbackDate
        await applyPaymentLookup(to: &invoice)

        if let learned = MerchantLearningService.lookup(rawText: rawText, merchant: invoice.merchant) {
            invoice.merchant = learned.merchant
            if let category = learned.category { invoice.category = category }
        }

        enqueuePendingReceipt(invoice: invoice, imageData: imageData)
        statusMessage = "Receipt extracted — review and approve before saving."
    }

    /// Normalizes raw text (collapse whitespace, lowercase) so the same email/SMS/photo content
    /// matches regardless of minor formatting differences, then looks for an existing saved
    /// receipt with the same content. This is the ground-truth duplicate signature — merchant
    /// text and even the extracted date can vary between two parses of the identical source
    /// text, but the source text itself doesn't.
    private func normalizedRawTextKey(_ text: String) -> String? {
        let normalized = text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .lowercased()
        return normalized.isEmpty ? nil : normalized
    }

    private func existingInvoice(matchingRawText rawText: String) -> Invoice? {
        guard let key = normalizedRawTextKey(rawText) else { return nil }
        return invoices.first { normalizedRawTextKey($0.rawText) == key }
    }

    private func applyPaymentLookup(to invoice: inout Invoice) async {
        invoice.cardLast4 = PaymentMappingService.normalizedLast4(from: invoice.cardLast4)
        guard let last4 = invoice.cardLast4 else { return }

        // Only fill in a bank when one isn't already known — a bank the user just typed (or the
        // parser already extracted) is trusted as-is rather than silently overwritten by a
        // possibly-stale payment_methods lookup. This also means a deliberate correction survives
        // long enough for rememberCardBankIfNeeded to pick it up and save it for next time.
        let hasUsableBank = invoice.cardBank?.nilIfEmpty != nil && invoice.cardBank != "Unknown Bank"
        guard !hasUsableBank else { return }

        do {
            if let paymentMethod = try await paymentMappingService.findPaymentMethod(lastDigits: last4) {
                invoice.cardBank = paymentMethod.bankName
            } else {
                invoice.cardBank = "Unknown Bank"
            }
        } catch {
            if invoice.cardBank == nil {
                invoice.cardBank = "Unknown Bank"
            }
            print("DEBUG: payment lookup failed for card ending \(last4): \(error.localizedDescription)")
        }
    }

    /// Persists a corrected/known card→bank pairing to Supabase so every future receipt with
    /// this card last-4 auto-fills the right bank instead of relying on re-extracting it (or
    /// re-guessing "Unknown Bank") every single scan.
    private func rememberCardBankIfNeeded(_ invoice: Invoice) async {
        guard let last4 = invoice.cardLast4?.nilIfEmpty,
              let bank = invoice.cardBank?.nilIfEmpty, bank != "Unknown Bank" else { return }
        await paymentMappingService.upsertPaymentMethod(lastDigits: last4, bankName: bank)
        await loadPaymentMethods()
    }

    func runSampleReceiptTrial() async {
        isProcessing = true
        statusMessage = "Rendering sample receipt for OCR..."

        do {
            let image = Self.makeSampleReceiptImage()
            statusMessage = "Running Vision OCR on sample receipt..."
            let rawText = try await ocr.recognizeText(from: image)
            try await processExtractedText(rawText, imageData: image.jpegData(compressionQuality: 0.86))
            statusMessage = "Sample OCR complete — approve it to test Supabase save."
        } catch {
            let fallbackRawText = Self.sampleReceiptText
            do {
                try await processExtractedText(fallbackRawText, imageData: nil)
                statusMessage = "Sample image OCR failed; using sample text for review."
            } catch {
                statusMessage = "Sample trial failed: \(error.localizedDescription)"
            }
        }

        isProcessing = false
    }

    /// Adds a freshly-extracted receipt to the review queue. The queue view opens automatically
    /// the first time it goes from empty to non-empty, then stays open (and live-updates) as
    /// more candidates stream in — e.g. from a Gmail or SMS inbox scan.
    func enqueuePendingReceipt(invoice: Invoice, imageData: Data?) {
        let pending = PendingReceipt(id: invoice.id, invoice: invoice, imageData: imageData)
        pendingReceipts.append(pending)
        print("DEBUG: enqueuePendingReceipt, queue size = \(pendingReceipts.count)")
        if pendingReceipts.count == 1 {
            showPendingReview = true
        }
    }

    /// Saves one queued receipt (by id, not necessarily the first) and removes it from the queue.
    /// Pass `editedInvoice` when approving from the detail view after field edits; omit it to
    /// approve the line exactly as extracted (the inline "Approve" action in the queue list).
    func approvePendingReceipt(_ pending: PendingReceipt, editedInvoice: Invoice? = nil) async {
        guard !savingPendingReceiptIDs.contains(pending.id) else { return }
        savingPendingReceiptIDs.insert(pending.id)
        defer { savingPendingReceiptIDs.remove(pending.id) }

        let invoice = editedInvoice ?? pending.invoice

        // Second, final duplicate check right at the write boundary: catches the same content
        // queued twice in one batch (e.g. two near-simultaneous scans of one photo), which the
        // enqueue-time check in processExtractedText can't see since neither was saved yet then.
        if let duplicate = existingInvoice(matchingRawText: invoice.rawText) {
            statusMessage = "Skipped — already saved as \(duplicate.merchant ?? "a receipt") (\(duplicate.total.map { $0.formatted(.currency(code: duplicate.currency ?? Invoice.defaultCurrency)) } ?? "no amount"))."
            pendingReceipts.removeAll { $0.id == pending.id }
            return
        }

        if let editedInvoice, editedInvoice.merchant != pending.invoice.merchant || editedInvoice.category != pending.invoice.category {
            MerchantLearningService.remember(
                originalRawText: pending.invoice.rawText,
                originalMerchant: pending.invoice.merchant,
                correctedMerchant: editedInvoice.merchant,
                correctedCategory: editedInvoice.category
            )
        }

        statusMessage = "Saving receipt..."

        do {
            var fileUrl: String?
            var uploadWarning: String?
            if let imageData = pending.imageData {
                do {
                    let filename = "receipt-\(UUID().uuidString).jpg"
                    fileUrl = try await supabaseService.uploadReceiptImage(data: imageData, filename: filename)
                } catch {
                    uploadWarning = " Image upload skipped: \(error.localizedDescription)"
                    print("DEBUG: receipt image upload failed, continuing with DB insert: \(error.localizedDescription)")
                }
            }

            let receiptId = try await supabaseService.insertReceiptToDB(parsed: ParsedReceipt(
                merchant: invoice.merchant,
                date: invoice.date.map { ISO8601DateFormatter().string(from: $0) },
                total: invoice.total,
                currency: invoice.currency,
                extracted_digits: invoice.cardLast4,
                card_last4: invoice.cardLast4,
                card_bank: invoice.cardBank,
                category: invoice.category,
                line_items: nil
            ), rawText: invoice.rawText, fileUrl: fileUrl)

            var savedInvoice = invoice
            savedInvoice.id = receiptId
            savedInvoice.fileUrl = fileUrl
            invoices.append(savedInvoice)
            resortInvoices()
            statusMessage = "Saved receipt for \(invoice.merchant ?? "unknown merchant").\(uploadWarning ?? "")"
            pendingReceipts.removeAll { $0.id == pending.id }
            await rememberCardBankIfNeeded(invoice)
        } catch {
            statusMessage = "Save failed: \(error.localizedDescription)"
        }
    }

    /// Discards one queued receipt (by id) without saving it.
    func rejectPendingReceipt(_ pending: PendingReceipt) {
        pendingReceipts.removeAll { $0.id == pending.id }
    }

    func updateInvoice(_ invoice: Invoice) async {
        isProcessing = true
        statusMessage = "Saving changes..."
        let previous = invoices.first { $0.id == invoice.id }
        var updatedInvoice = invoice
        await applyPaymentLookup(to: &updatedInvoice)

        do {
            try await supabaseService.updateReceipt(
                id: updatedInvoice.id,
                merchant: updatedInvoice.merchant,
                date: updatedInvoice.date,
                total: updatedInvoice.total,
                currency: updatedInvoice.currency,
                category: updatedInvoice.category,
                cardLast4: updatedInvoice.cardLast4,
                cardBank: updatedInvoice.cardBank
            )
            if let index = invoices.firstIndex(where: { $0.id == updatedInvoice.id }) {
                invoices[index] = updatedInvoice
            }
            resortInvoices()
            statusMessage = "Receipt updated"

            if let previous, previous.merchant != updatedInvoice.merchant || previous.category != updatedInvoice.category {
                MerchantLearningService.remember(
                    originalRawText: previous.rawText,
                    originalMerchant: previous.merchant,
                    correctedMerchant: updatedInvoice.merchant,
                    correctedCategory: updatedInvoice.category
                )
            }
            await rememberCardBankIfNeeded(updatedInvoice)
        } catch {
            statusMessage = "Update failed: \(error.localizedDescription)"
        }

        isProcessing = false
    }

    func deleteInvoice(_ invoice: Invoice) async {
        guard let index = invoices.firstIndex(where: { $0.id == invoice.id }) else { return }
        invoices.remove(at: index)
        isProcessing = true
        statusMessage = "Removing receipt..."

        do {
            try await supabaseService.deleteReceipt(id: invoice.id)
            statusMessage = "Receipt deleted"
        } catch {
            statusMessage = "Delete failed: \(error.localizedDescription)"
        }

        isProcessing = false
    }

    // MARK: - Gmail scan

    /// Phase 1: searches Gmail (read-only) for receipt-like emails since the last successful
    /// scan and stops — it does NOT parse or queue anything yet. Already-imported messages are
    /// filtered out first so a re-scan can't resurface (and re-import) the same email twice.
    /// The result populates `gmailScanResult`, which shows a count/confirm screen; nothing is
    /// touched until the user explicitly proceeds via `proceedWithGmailImport()`.
    func scanGmailReceipts() async {
        guard !isProcessing else { return }
        isProcessing = true
        gmailIsScanning = true
        statusMessage = "Preparing Gmail scan..."
        gmailFetchLog = statusMessage
        gmailScanner.onProgress = { [weak self] message in
            Task { @MainActor in
                self?.gmailFetchLog = message
                self?.statusMessage = message
            }
        }

        defer {
            isProcessing = false
            gmailIsScanning = false
            gmailScanner.onProgress = nil
        }

        do {
            let rawResult = try await gmailScanner.scanReceiptsSinceLastScan(lastScanDate: lastGmailScanDate, allowInteractiveAuth: true)
            let alreadyImported = Set(importedGmailMessageIDs)
            let newCandidates = rawResult.receiptCandidates.filter { !alreadyImported.contains($0.messageID) }
            let skippedDuplicates = rawResult.receiptCandidates.count - newCandidates.count

            let result = GmailReceiptScanResult(
                searchedFrom: rawResult.searchedFrom,
                searchedThrough: rawResult.searchedThrough,
                scannedMessageCount: rawResult.scannedMessageCount,
                latestIdentifiedEmailDate: rawResult.latestIdentifiedEmailDate,
                receiptCandidates: newCandidates
            )
            gmailScanResult = result

            let count = newCandidates.count
            var summary = count == 0
                ? "No new receipt emails found."
                : "Found \(count) receipt email\(count == 1 ? "" : "s")."
            if skippedDuplicates > 0 {
                summary += " Skipped \(skippedDuplicates) already imported."
            }
            statusMessage = summary
            gmailFetchLog = summary

            // Nothing new to review, so there's no count screen to show — just move the
            // scan window forward so the next scan doesn't re-search this same range.
            if count == 0 {
                lastGmailScanDate = rawResult.latestIdentifiedEmailDate ?? rawResult.searchedThrough
            }
        } catch {
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Gmail scan failed. Please try again.")
            gmailFetchLog = statusMessage
            AppSecurity.debugLog("Gmail scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    /// Phase 2: the user tapped "Proceed" on the count screen. Parses every found candidate
    /// (this is the expensive step — one edge-function call per email) and queues each result
    /// into `pendingReceipts` for line-by-line review/approval.
    func proceedWithGmailImport() async {
        guard let result = gmailScanResult else { return }
        isImportingGmailResult = true
        defer { isImportingGmailResult = false }

        for candidate in result.receiptCandidates {
            try? await processExtractedText(candidate.rawText, imageData: nil)
        }
        rememberImportedGmailMessages(result.receiptCandidates.map(\.messageID))
        lastGmailScanDate = result.latestIdentifiedEmailDate ?? result.searchedThrough
        gmailScanResult = nil
        statusMessage = "Added \(result.receiptCandidates.count) Gmail receipt\(result.receiptCandidates.count == 1 ? "" : "s") to the review queue."
        gmailFetchLog = statusMessage
    }

    /// The user tapped "Cancel" on the count screen — discard the findings without parsing or
    /// queueing anything. `lastGmailScanDate` is left untouched so the next scan searches the
    /// same window again in case they change their mind later.
    func cancelGmailImport() {
        gmailScanResult = nil
        statusMessage = "Gmail scan discarded."
        gmailFetchLog = statusMessage
    }

    func signOutOfGmail() {
        gmailScanner.signOut()
        lastGmailScanDate = nil
        statusMessage = "Gmail credentials cleared."
    }

    // MARK: - SMS inbox scan (Supabase, populated by the `receive-sms` Edge Function)

    /// Refreshes the pending/failed row counts so the Scan SMS sheet can show inbox health.
    func refreshSMSInboxCounts() async {
        do {
            let counts = try await supabaseService.fetchSMSInboxCounts()
            smsInboxPendingCount = counts.pending
            smsInboxFailedCount = counts.failed
        } catch {
            AppSecurity.debugLog("SMS inbox count refresh failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    /// Pulls the oldest not-yet-processed SMS rows from Supabase, routes each through the same
    /// expense pipeline as a scanned receipt, and marks every row processed/skipped/failed so a
    /// re-scan never imports the same SMS twice.
    func importSMSFromInbox() async {
        guard !isProcessing else {
            smsInboxFetchLog = "SMS inbox scan ignored because another scan is already running."
            return
        }

        isProcessing = true
        statusMessage = "Checking SMS inbox..."
        smsInboxFetchLog = statusMessage

        defer { isProcessing = false }

        do {
            let rows = try await supabaseService.fetchPendingSMSInbox()
            guard !rows.isEmpty else {
                statusMessage = "No new SMS inbox messages to import."
                smsInboxFetchLog = statusMessage
                await refreshSMSInboxCounts()
                return
            }

            var imported = 0
            var skipped = 0
            for row in rows {
                let smsText = AppSecurity.clippedSensitiveText(row.body, limit: AppSecurity.maxSharedTextCharacters)
                guard !smsText.isEmpty, InvoiceParser.looksLikeExpenseSMS(text: smsText) else {
                    await markSMSInboxSafely(row.id, status: "skipped", errorMessage: nil)
                    skipped += 1
                    continue
                }

                do {
                    try await processExtractedText("SMS Expense Alert:\n\(smsText)", imageData: nil, fallbackDate: row.receivedAt)
                    imported += 1
                    await markSMSInboxSafely(row.id, status: "processed", errorMessage: nil)
                } catch {
                    skipped += 1
                    await markSMSInboxSafely(row.id, status: "failed", errorMessage: AppSecurity.redactedDiagnostic(error.localizedDescription))
                }
            }

            statusMessage = imported == 0
                ? "No SMS inbox expenses found (\(skipped) skipped)."
                : "Imported \(imported) SMS expense\(imported == 1 ? "" : "s") for review (\(skipped) skipped)."
            smsInboxFetchLog = statusMessage
        } catch {
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Could not read the SMS inbox. Please try again.")
            smsInboxFetchLog = statusMessage
            AppSecurity.debugLog("SMS inbox scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
        await refreshSMSInboxCounts()
    }

    /// Manual fallback: parses SMS text pasted directly into the app, one message per blank-line block.
    func importSMSText(_ text: String) async {
        guard !isProcessing else { return }
        let blocks = text
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard !blocks.isEmpty else { return }

        isProcessing = true
        statusMessage = "Parsing pasted SMS text..."
        defer { isProcessing = false }

        var imported = 0
        for block in blocks {
            guard InvoiceParser.looksLikeExpenseSMS(text: block) else { continue }
            try? await processExtractedText("SMS Expense Alert:\n\(block)", imageData: nil)
            imported += 1
        }

        statusMessage = imported == 0
            ? "No expense-looking SMS found in the pasted text."
            : "Parsed \(imported) SMS message\(imported == 1 ? "" : "s") for review."
    }

    private func markSMSInboxSafely(_ id: UUID, status: String, errorMessage: String?) async {
        do {
            try await supabaseService.markSMSInbox(id: id, status: status, receiptId: nil, errorMessage: errorMessage)
        } catch {
            AppSecurity.debugLog("Failed to update sms_inbox row \(id): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    // MARK: - Report drill-down

    func receipts(forCategory category: String) -> [Invoice] {
        invoices
            .filter { ($0.category?.nilIfEmpty ?? "Miscellaneous") == category }
            .sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }

    func receipts(forCategory category: String, monthKey: String) -> [Invoice] {
        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy-MM"
        return receipts(forCategory: category).filter { invoice in
            guard let date = invoice.date else { return monthKey == "unknown" }
            return monthFormatter.string(from: date) == monthKey
        }
    }

    /// Month-by-month spend breakdown within a single category, for the category report drill-down.
    func monthSummaries(forCategory category: String) -> [SpendSummary] {
        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy-MM"
        let titleFormatter = DateFormatter()
        titleFormatter.dateFormat = "MMM yyyy"

        var grouped: [String: (title: String, subtitle: String, amount: Decimal, receiptCount: Int)] = [:]
        for invoice in receipts(forCategory: category) {
            let key: String
            let title: String
            let subtitle: String
            if let date = invoice.date {
                key = monthFormatter.string(from: date)
                title = titleFormatter.string(from: date)
                subtitle = "Monthly spend"
            } else {
                key = "unknown"
                title = "No Date"
                subtitle = "Receipts without a date"
            }
            let existing = grouped[key] ?? (title: title, subtitle: subtitle, amount: 0, receiptCount: 0)
            grouped[key] = (title: title, subtitle: subtitle, amount: existing.amount + (invoice.total ?? 0), receiptCount: existing.receiptCount + 1)
        }

        return grouped.map { key, value in
            SpendSummary(id: key, title: value.title, subtitle: value.subtitle, amount: value.amount, receiptCount: value.receiptCount)
        }
        .sorted { lhs, rhs in
            if lhs.id == "unknown" { return false }
            if rhs.id == "unknown" { return true }
            return lhs.id > rhs.id
        }
    }

    func receipts(forMonthKey monthKey: String) -> [Invoice] {
        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy-MM"
        return invoices
            .filter { invoice in
                guard let date = invoice.date else { return monthKey == "unknown" }
                return monthFormatter.string(from: date) == monthKey
            }
            .sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }

    func receipts(forCardKey cardKey: String) -> [Invoice] {
        invoices
            .filter { invoice in
                let bank = invoice.cardBank?.nilIfEmpty ?? "Unknown Bank"
                let last4 = invoice.cardLast4?.nilIfEmpty
                return "\(bank)|\(last4 ?? "unknown")" == cardKey
            }
            .sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }

    static let sampleReceiptText = """
    BLUE BOTTLE COFFEE
    315 Linden Street
    San Francisco, CA
    04/22/2026 09:41 AM
    Latte                         5.75
    Almond Croissant              4.95
    Subtotal                     10.70
    Tax                           0.94
    TOTAL                        11.64
    VISA **** 4242
    Thank you!
    """

    static func makeSampleReceiptImage() -> UIImage {
        let size = CGSize(width: 760, height: 1040)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))

            let borderPath = UIBezierPath(roundedRect: CGRect(x: 38, y: 34, width: size.width - 76, height: size.height - 68), cornerRadius: 28)
            UIColor.systemGray5.setStroke()
            borderPath.lineWidth = 4
            borderPath.stroke()

            let titleStyle = NSMutableParagraphStyle()
            titleStyle.alignment = .center

            let titleAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 42, weight: .bold),
                .foregroundColor: UIColor.black,
                .paragraphStyle: titleStyle
            ]
            let bodyAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedSystemFont(ofSize: 30, weight: .regular),
                .foregroundColor: UIColor.black
            ]
            let totalAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedSystemFont(ofSize: 34, weight: .bold),
                .foregroundColor: UIColor.black
            ]

            "BLUE BOTTLE COFFEE".draw(in: CGRect(x: 70, y: 90, width: size.width - 140, height: 60), withAttributes: titleAttributes)
            "315 Linden Street\nSan Francisco, CA\n\n04/22/2026 09:41 AM\n\nLatte                         5.75\nAlmond Croissant              4.95\nSubtotal                     10.70\nTax                           0.94"
                .draw(in: CGRect(x: 90, y: 190, width: size.width - 180, height: 500), withAttributes: bodyAttributes)

            let separator = UIBezierPath()
            separator.move(to: CGPoint(x: 90, y: 700))
            separator.addLine(to: CGPoint(x: size.width - 90, y: 700))
            UIColor.black.setStroke()
            separator.lineWidth = 2
            separator.stroke()

            "TOTAL                        11.64".draw(in: CGRect(x: 90, y: 730, width: size.width - 180, height: 55), withAttributes: totalAttributes)
            "\nVISA **** 4242\n\nThank you!".draw(in: CGRect(x: 90, y: 810, width: size.width - 180, height: 170), withAttributes: bodyAttributes)
        }
    }
}
