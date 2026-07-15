import Foundation
import Combine
import CryptoKit
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
    @Published var pendingReceipt: PendingReceipt? = nil
    @Published var editingInvoice: Invoice? = nil
    @Published var searchText = ""
    @Published var selectedFilter: ReceiptFilter = .all
    @Published var paymentMethods: [PaymentMethod] = []
    @Published var gmailAgentIsRunning = false
    @Published var gmailDailyAgentEnabled: Bool
    @Published var gmailLastScanDate: Date?
    @Published var gmailScanSummary: String? = nil
    @Published var gmailScanLog: GmailScanLog? = nil
    @Published var defaultCurrencyCode: String
    @Published var supabaseSession: SupabaseAuthSession?
    @Published var showSupabaseSignIn = false

    let supabaseService: SupabaseService
    private let paymentMappingService: PaymentMappingService
    private let currencyConversionService = CurrencyConversionService()
    private let ocr = OCRService()
    private let gmailScanner = GmailReceiptScanner()
    private let calendar = Calendar.current
    private var pendingReceiptQueue: [PendingReceipt] = []
    private var gmailScanTask: Task<Void, Never>?
    private let defaultCurrencyCodeKey = "defaultCurrencyCode"
    private let gmailDailyAgentEnabledKey = "gmailDailyAgentEnabled"
    private let gmailLastScanDateKey = "gmailLastScanDate"
    private let gmailLastDailyRunDateKey = "gmailLastDailyRunDate"
    private let reviewedReceiptFingerprintsKey = "reviewedReceiptFingerprints"
    private let receiptCorrectionRulesKey = "receiptCorrectionRules"
    private let maximumReviewedReceiptFingerprints = 500
    private let maximumReceiptCorrectionRules = 120

    struct PendingReceipt: Identifiable {
        let id: UUID
        var invoice: Invoice
        var imageData: Data?
    }

    struct ReviewedReceiptFingerprint: Codable, Hashable {
        let rawTextHash: String?
        let semanticKey: String
        let reviewedAt: Date
        let action: String
    }

    struct ReceiptCorrectionRule: Codable, Identifiable, Hashable {
        let id: UUID
        let merchantKeyword: String
        let correctedMerchant: String?
        let correctedCategory: String?
        let correctedCurrency: String?
        let correctedCardLast4: String?
        let correctedCardBank: String?
        let learnedAt: Date
        let useCount: Int
    }

    struct GmailScanLog: Identifiable {
        let id = UUID()
        let title: String
        let message: String
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
        self.gmailDailyAgentEnabled = UserDefaults.standard.bool(forKey: gmailDailyAgentEnabledKey)
        self.gmailLastScanDate = UserDefaults.standard.object(forKey: gmailLastScanDateKey) as? Date
        self.defaultCurrencyCode = UserDefaults.standard.string(forKey: defaultCurrencyCodeKey) ?? Invoice.defaultCurrency
        self.supabaseSession = nil
        self.gmailScanner.onProgress = { [weak self] message in
            Task { @MainActor in
                AppSecurity.debugLog("Gmail agent progress updated.")
                self?.gmailScanSummary = message
                self?.statusMessage = message
            }
        }
    }

    var supabaseAuthTitle: String {
        supabaseSession == nil ? "Supabase Anon Mode" : "Supabase Connected"
    }

    var supabaseAuthSubtitle: String {
        if let email = supabaseSession?.email, !email.isEmpty {
            return "Signed in as \(email)"
        }
        if supabaseSession != nil {
            return "Signed in for RLS access"
        }
        return "Using single-user anon RLS policies"
    }

    var gmailAgentTitle: String {
        gmailAgentIsRunning ? "Stop Gmail Agent" : "Scan Gmail"
    }

    var gmailAgentSubtitle: String {
        if gmailAgentIsRunning {
            return gmailScanSummary ?? "Scanning read-only Gmail messages now"
        }
        if let gmailScanSummary {
            return gmailScanSummary
        }
        if let gmailLastScanDate {
            return "Last scan: \(DateFormatter.localizedString(from: gmailLastScanDate, dateStyle: .medium, timeStyle: .short))"
        }
        return "Read-only search, capped at the last 30 days"
    }

    var gmailScheduleSubtitle: String {
        if gmailAgentIsRunning {
            return "Scanning now"
        }
        return gmailDailyAgentEnabled ? "Auto daily scan is live" : "Auto daily scan is off"
    }

    var gmailAgentLiveStatusTitle: String {
        if gmailAgentIsRunning {
            return "Scanning now"
        }
        return gmailDailyAgentEnabled ? "Agent live" : "Agent off"
    }

    var gmailAgentScheduleDetail: String {
        gmailDailyAgentEnabled ? "iOS will run it daily when available" : "Enable Daily to run automatically"
    }

    var gmailLastScanInfo: String {
        guard let gmailLastScanDate else {
            return "No Gmail scan yet"
        }
        return DateFormatter.localizedString(from: gmailLastScanDate, dateStyle: .medium, timeStyle: .short)
    }

    func refreshSupabaseSession() async {
        _ = await supabaseService.currentAccessToken()
        supabaseSession = await supabaseService.currentSession()
        await paymentMappingService.setAuthAccessToken(supabaseSession?.accessToken)
    }

    func signInToSupabase(email: String, password: String) async throws {
        let session = try await supabaseService.signIn(email: email, password: password)
        supabaseSession = session
        await paymentMappingService.setAuthAccessToken(session.accessToken)
        statusMessage = "Supabase connected. Loading receipts..."
        await loadReceipts()
    }

    func signOutFromSupabase() async {
        await supabaseService.signOut()
        supabaseSession = nil
        await paymentMappingService.setAuthAccessToken(nil)
        statusMessage = "Using single-user anon access. Loading receipts..."
        await loadReceipts()
    }

    func setDefaultCurrency(_ currency: String) {
        let normalized = CurrencyConversionService.normalizedCurrency(currency) ?? Invoice.defaultCurrency
        guard normalized != defaultCurrencyCode else { return }
        defaultCurrencyCode = normalized
        UserDefaults.standard.set(normalized, forKey: defaultCurrencyCodeKey)
        statusMessage = "Default currency set to \(normalized). Updating saved receipt conversions..."
        Task { await reconvertSavedReceiptsToDefaultCurrency() }
    }

    private func reconvertSavedReceiptsToDefaultCurrency() async {
        guard !invoices.isEmpty else {
            statusMessage = "Default currency set to \(defaultCurrencyCode)."
            return
        }

        isProcessing = true
        defer { isProcessing = false }

        var updatedCount = 0
        for index in invoices.indices {
            var invoice = invoices[index]
            await applyCurrencyConversion(to: &invoice)
            do {
                try await supabaseService.updateReceipt(
                    id: invoice.id,
                    merchant: invoice.merchant,
                    date: invoice.date,
                    total: invoice.total,
                    receiptAmount: invoice.receiptAmount,
                    currency: invoice.currency,
                    defaultCurrency: invoice.defaultCurrency,
                    receiptCurrency: invoice.receiptCurrency ?? invoice.currency,
                    conversionRate: invoice.conversionRate,
                    convertedTotal: invoice.convertedTotal,
                    category: invoice.category,
                    cardLast4: invoice.cardLast4,
                    cardBank: invoice.cardBank,
                    rawText: invoice.rawText
                )
                invoices[index] = invoice
                updatedCount += 1
            } catch {
                AppSecurity.debugLog("Failed to update conversion for \(invoice.id): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            }
        }
        statusMessage = "Default currency set to \(defaultCurrencyCode). Updated \(updatedCount) receipt conversion\(updatedCount == 1 ? "" : "s")."
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
        invoices.compactMap { reportingAmount(for: $0) }.reduce(0, +)
    }

    var monthlySpend: Decimal {
        invoices
            .filter { invoice in
                guard let date = invoice.date else { return false }
                return calendar.isDate(date, equalTo: Date(), toGranularity: .month)
            }
            .compactMap { reportingAmount(for: $0) }
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
                amount: existing.amount + (reportingAmount(for: invoice) ?? 0),
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
                amount: existing.amount + (reportingAmount(for: invoice) ?? 0),
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
                amounts[day]? += reportingAmount(for: invoice) ?? 0
            }
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "E"

        return labels.map { date in
            (label: formatter.string(from: date), amount: amounts[date] ?? 0)
        }
    }

    func loadReceipts() async {
        await refreshSupabaseSession()

        isProcessing = true
        statusMessage = "Loading receipts..."

        do {
            invoices = try await supabaseService.fetchReceipts()
            await loadPaymentMethods()
            await reconcileLoadedReceiptCurrencies()
            statusMessage = "Loaded \(invoices.count) receipts"
        } catch {
            invoices = []
            await loadPaymentMethods()
            statusMessage = "Unable to load receipts. Check anon RLS policies and backend access."
            AppSecurity.debugLog("Fetch receipts failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }

        isProcessing = false
    }

    func loadPaymentMethods() async {
        do {
            paymentMethods = try await paymentMappingService.fetchPaymentMethods()
        } catch {
            paymentMethods = []
            AppSecurity.debugLog("Payment methods fetch failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    func configureGmailBackgroundSchedule() {
        if gmailDailyAgentEnabled {
            GmailBackgroundScheduler.scheduleDailyScan()
        } else {
            GmailBackgroundScheduler.cancelDailyScan()
        }
    }

    func toggleGmailAgent() {
        if gmailAgentIsRunning {
            gmailScanTask?.cancel()
            gmailScanTask = nil
            gmailAgentIsRunning = false
            gmailScanSummary = "Gmail scan stopped."
            statusMessage = "Gmail agent stopped."
            return
        }

        startManualGmailScan(lookbackDays: GmailOAuthConfiguration.maximumLookbackDays)
    }

    func startManualGmailScan(lookbackDays: Int) {
        let cappedDays = min(max(lookbackDays, 1), GmailOAuthConfiguration.maximumLookbackDays)
        if cappedDays != lookbackDays {
            statusMessage = "Gmail scan is capped at the last \(GmailOAuthConfiguration.maximumLookbackDays) days."
        }
        startGmailScan(allowInteractiveAuth: true, scheduled: false, lookbackDays: cappedDays, ignoreLastScanDate: true, presentLog: true)
    }

    func runGmailScanOnAppLoad() {
        startGmailScan(allowInteractiveAuth: false, scheduled: false, lookbackDays: nil, ignoreLastScanDate: false, presentLog: true)
    }

    func dismissGmailScanLog() {
        gmailScanLog = nil
        if pendingReceipt == nil {
            presentNextPendingReceipt()
        }
    }

    func setGmailDailyAgentEnabled(_ enabled: Bool) {
        gmailDailyAgentEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: gmailDailyAgentEnabledKey)
        gmailScanSummary = enabled ? "Daily Gmail scan enabled." : "Daily Gmail scan disabled."
        statusMessage = gmailScanSummary

        if enabled {
            GmailBackgroundScheduler.scheduleDailyScan()
            startGmailScan(allowInteractiveAuth: true, scheduled: true, lookbackDays: nil, ignoreLastScanDate: false, presentLog: false)
        } else {
            GmailBackgroundScheduler.cancelDailyScan()
        }
    }

    func runDailyGmailAgentIfNeeded() {
        guard gmailDailyAgentEnabled else {
            GmailBackgroundScheduler.cancelDailyScan()
            return
        }

        GmailBackgroundScheduler.scheduleDailyScan()
        guard !gmailAgentIsRunning else { return }

        if let lastRun = UserDefaults.standard.object(forKey: gmailLastDailyRunDateKey) as? Date,
           calendar.isDateInToday(lastRun) {
            return
        }

        startGmailScan(allowInteractiveAuth: false, scheduled: true, lookbackDays: nil, ignoreLastScanDate: false, presentLog: false)
    }

    func runAutonomousDailyGmailScanFromBackground() async -> Bool {
        guard gmailDailyAgentEnabled else { return false }
        guard !gmailAgentIsRunning else { return true }

        if let lastRun = UserDefaults.standard.object(forKey: gmailLastDailyRunDateKey) as? Date,
           calendar.isDateInToday(lastRun) {
            return true
        }

        return await performGmailScan(allowInteractiveAuth: false, scheduled: true, lookbackDays: nil, ignoreLastScanDate: false, presentLog: false)
    }

    private func startGmailScan(allowInteractiveAuth: Bool, scheduled: Bool, lookbackDays: Int?, ignoreLastScanDate: Bool, presentLog: Bool) {
        guard !gmailAgentIsRunning else { return }

        gmailScanTask = Task { [weak self] in
            guard let self else { return }
            _ = await self.performGmailScan(allowInteractiveAuth: allowInteractiveAuth, scheduled: scheduled, lookbackDays: lookbackDays, ignoreLastScanDate: ignoreLastScanDate, presentLog: presentLog)
        }
    }

    @discardableResult
    private func performGmailScan(allowInteractiveAuth: Bool, scheduled: Bool, lookbackDays: Int?, ignoreLastScanDate: Bool, presentLog: Bool) async -> Bool {
        guard !gmailAgentIsRunning else { return true }

        gmailAgentIsRunning = true
        isProcessing = true
        gmailScanSummary = scheduled ? "Daily Gmail scan is running..." : "Gmail scan is running..."
        statusMessage = gmailScanSummary

        defer {
            gmailAgentIsRunning = false
            isProcessing = false
            gmailScanTask = nil
            if gmailDailyAgentEnabled {
                GmailBackgroundScheduler.scheduleDailyScan()
            }
        }

        let requestedLastScanDate: Date?
        if ignoreLastScanDate {
            requestedLastScanDate = nil
        } else if scheduled {
            requestedLastScanDate = startDateForDailyGmailScan()
        } else {
            requestedLastScanDate = gmailLastScanDate
        }

        do {
            let result = try await gmailScanner.scanReceiptsSinceLastScan(
                lastScanDate: requestedLastScanDate,
                lookbackDays: lookbackDays,
                allowInteractiveAuth: allowInteractiveAuth
            )
            try Task.checkCancellation()
            var importedCount = 0
            var duplicateCount = 0
            var importedDuringScan: [Invoice] = []
            var logLines: [String] = [
                "Search window: \(DateFormatter.localizedString(from: result.searchedFrom, dateStyle: .medium, timeStyle: .short)) to \(DateFormatter.localizedString(from: result.searchedThrough, dateStyle: .medium, timeStyle: .short))",
                "Emails matched by Gmail search: \(result.scannedMessageCount)",
                "Eligible receipt-like emails: \(result.receiptCandidates.count)"
            ]

            for (index, candidate) in result.receiptCandidates.enumerated() {
                try Task.checkCancellation()
                let parseMessage = "Parsing Gmail receipt \(index + 1) of \(result.receiptCandidates.count)."
                AppSecurity.debugLog(parseMessage)
                gmailScanSummary = parseMessage
                statusMessage = parseMessage
                var invoice = try await invoiceFromExtractedText(candidate.rawText)
                if invoice.date == nil {
                    invoice.date = candidate.receivedDate
                }

                if hasLikelyDuplicate(for: invoice, comparedTo: importedDuringScan) {
                    duplicateCount += 1
                    let duplicateMessage = "Skipped likely duplicate Gmail receipt."
                    let duplicateDetail = "Already loaded one likely duplicate receipt."
                    AppSecurity.debugLog("Gmail duplicate skipped: messageID=\(candidate.messageID).")
                    logLines.append(duplicateDetail)
                    gmailScanSummary = duplicateMessage
                    statusMessage = duplicateMessage
                    continue
                }

                let importDetail = "New receipt queued for review."
                AppSecurity.debugLog("Gmail import queued: messageID=\(candidate.messageID).")
                logLines.append(importDetail)
                enqueuePendingReceipt(invoice: invoice, imageData: nil, presentImmediately: !presentLog)
                importedDuringScan.append(invoice)
                importedCount += 1
            }

            if let latestIdentifiedEmailDate = result.latestIdentifiedEmailDate {
                gmailLastScanDate = latestIdentifiedEmailDate
                UserDefaults.standard.set(latestIdentifiedEmailDate, forKey: gmailLastScanDateKey)
                AppSecurity.debugLog("Gmail last scan marker updated to latest identified email date: \(displayDateForDebug(latestIdentifiedEmailDate))")
            } else {
                AppSecurity.debugLog("Gmail last scan marker unchanged because no receipt-like email was identified.")
            }
            if scheduled {
                UserDefaults.standard.set(Date(), forKey: gmailLastDailyRunDateKey)
            }

            let duplicateSummary = duplicateCount > 0 ? " Skipped \(duplicateCount) likely duplicate\(duplicateCount == 1 ? "" : "s")." : ""
            let markerSummary = result.latestIdentifiedEmailDate.map { " Last identified email: \(DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .short))." } ?? " Last identified email marker unchanged."
            let summary = "Gmail scan found \(importedCount) new receipt\(importedCount == 1 ? "" : "s") from \(result.scannedMessageCount) email\(result.scannedMessageCount == 1 ? "" : "s").\(duplicateSummary)\(markerSummary)"
            if result.receiptCandidates.isEmpty {
                logLines.append("No eligible receipts found in this Gmail scan.")
            }
            logLines.append("Summary: \(summary)")
            gmailScanSummary = summary
            statusMessage = importedCount > 0 ? "\(summary) Review extracted receipts before saving." : summary
            if presentLog {
                let reviewMessage = importedCount > 0 ? "\nReview the new receipt\(importedCount == 1 ? "" : "s") before saving." : ""
                gmailScanLog = GmailScanLog(title: "Gmail Scan Summary", message: "\(summary)\(reviewMessage)")
            }
            return true
        } catch is CancellationError {
            gmailScanSummary = "Gmail scan stopped."
            statusMessage = "Gmail agent stopped."
            if presentLog {
                gmailScanLog = GmailScanLog(title: "Gmail Scan Stopped", message: "The Gmail scan was stopped before completion.")
            }
            return false
        } catch {
            let safeMessage = AppSecurity.safeUserMessage(for: error, fallback: "Gmail scan could not complete. Check Gmail sign-in and backend access.")
            gmailScanSummary = safeMessage
            statusMessage = safeMessage
            AppSecurity.debugLog("Gmail scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            if presentLog {
                gmailScanLog = GmailScanLog(title: "Gmail Scan Error", message: safeMessage)
            }
            return false
        }
    }

    private func startDateForDailyGmailScan() -> Date {
        let startOfToday = calendar.startOfDay(for: Date())
        guard let gmailLastScanDate else { return startOfToday }
        return max(gmailLastScanDate, startOfToday)
    }

    func processScannerResult(_ result: Result<[ScannerImage], Error>) async {
        showScanner = false
        AppSecurity.debugLog("Scanner result received.")
        
        switch result {
        case .success(let images):
            AppSecurity.debugLog("Scanner captured \(images.count) image(s).")
            // Small delay to ensure scanner sheet closes before pending receipt sheet opens
            try? await Task.sleep(nanoseconds: 300_000_000) // 0.3 seconds
            await processImages(images)
        case .failure(let error):
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Scanner failed.")
            AppSecurity.debugLog("Scanner failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    func processImages(_ images: [ScannerImage]) async {
        guard !images.isEmpty else {
            statusMessage = "No receipt pages found."
            return
        }

        isProcessing = true
        statusMessage = "Extracting receipt data..."
        AppSecurity.debugLog("Starting processing of \(images.count) scanned image(s).")

        for image in images {
            do {
                try await processImage(image)
            } catch {
                statusMessage = "Receipt processing failed. Please try again."
                AppSecurity.debugLog("Process image failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
                isProcessing = false
                return
            }
        }

        isProcessing = false
        statusMessage = "Receipt ready for review"
        AppSecurity.debugLog("Receipt ready for review.")
        
        // Ensure pending receipt is presented
        if pendingReceipt == nil {
            presentNextPendingReceipt()
        }
    }

    func importPhotoItem(_ item: PhotosPickerItem?) async {
        guard let item = item else { return }

        isProcessing = true
        statusMessage = "Importing image..."
        showPhotoPicker = false
        selectedPhoto = nil
        AppSecurity.debugLog("Photo item selected.")

        do {
            if let data = try await item.loadTransferable(type: Data.self), let uiImage = UIImage(data: data) {
                statusMessage = "Processing receipt..."
                try await processImage(uiImage)
                statusMessage = "Receipt ready for review"
                AppSecurity.debugLog("Photo import processed.")
                // Small delay to ensure any sheet transitions complete
                try? await Task.sleep(nanoseconds: 200_000_000) // 0.2 seconds
                if pendingReceipt == nil {
                    presentNextPendingReceipt()
                }
            } else {
                statusMessage = "Unable to load image from library."
                AppSecurity.debugLog("Failed to load photo item data.")
            }
        } catch {
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Import failed. Please try again.")
            AppSecurity.debugLog("Photo import error: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }

        isProcessing = false
    }

    func processImage(_ image: ScannerImage) async throws {
        let rawText = try await ocr.recognizeText(from: image)
        try await processExtractedText(rawText, imageData: image.jpegData(compressionQuality: 0.8))
    }

    func processExtractedText(_ rawText: String, imageData: Data?) async throws {
        let invoice = try await invoiceFromExtractedText(rawText)
        enqueuePendingReceipt(invoice: invoice, imageData: imageData)
        statusMessage = "Receipt extracted — review and approve before saving."
    }

    private func invoiceFromExtractedText(_ rawText: String) async throws -> Invoice {
        let parsed: ParsedReceipt
        let applicableRules = matchingCorrectionRules(for: rawText)

        do {
            parsed = try await supabaseService.parseReceiptWithEdge(rawText: rawText, learningHints: learningHints(from: applicableRules))
        } catch {
            let fallbackInvoice = InvoiceParser.parse(from: rawText)
            parsed = ParsedReceipt(
                merchant: fallbackInvoice.merchant,
                date: fallbackInvoice.date.map { ISO8601DateFormatter().string(from: $0) },
                total: fallbackInvoice.total,
                receipt_amount: fallbackInvoice.receiptAmount ?? fallbackInvoice.total,
                currency: fallbackInvoice.currency ?? Invoice.defaultCurrency,
                default_currency: defaultCurrencyCode,
                receipt_currency: fallbackInvoice.currency ?? Invoice.defaultCurrency,
                conversion_rate: nil,
                converted_total: nil,
                extracted_digits: fallbackInvoice.cardLast4,
                card_last4: fallbackInvoice.cardLast4,
                card_bank: nil,
                category: fallbackInvoice.category,
                line_items: nil
            )
            statusMessage = "Cloud parsing unavailable; using on-device extraction."
            AppSecurity.debugLog("Edge parse failed, using local parser: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }

        let storedRawText = AppSecurity.clippedSensitiveText(rawText)
        var invoice = Invoice(from: parsed, rawText: storedRawText)
        let parsedReceiptCurrency = CurrencyConversionService.normalizedCurrency(parsed.receipt_currency ?? parsed.currency) ?? Invoice.defaultCurrency
        invoice.currency = parsedReceiptCurrency
        invoice.receiptCurrency = parsedReceiptCurrency
        invoice.receiptAmount = parsed.receipt_amount ?? parsed.total ?? invoice.receiptAmount
        invoice.defaultCurrency = defaultCurrencyCode
        invoice.cardLast4 = invoice.cardLast4 ?? PaymentMappingService.extractCardLast4(from: rawText)
        invoice.merchant = refinedMerchant(for: invoice, rawText: rawText)
        invoice.category = refinedCategory(for: invoice, rawText: rawText)
        applyCorrectionRules(applicableRules, to: &invoice)
        await applyPaymentLookup(to: &invoice)
        await applyCurrencyConversion(to: &invoice)
        return invoice
    }

    private func refinedMerchant(for invoice: Invoice, rawText: String) -> String? {
        let current = invoice.merchant?.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentLooksGeneric = current == nil
            || current?.localizedCaseInsensitiveContains("email subject") == true
            || current?.localizedCaseInsensitiveContains("gmail receipt") == true
            || current?.localizedCaseInsensitiveContains("sms expense") == true
            || current?.localizedCaseInsensitiveContains("expense alert") == true

        if let smsMerchant = InvoiceParser.extractSMSMerchant(from: rawText)?.nilIfEmpty, currentLooksGeneric {
            return smsMerchant
        }

        if InvoiceParser.isPayNowTransfer(text: rawText.lowercased()),
           let recipient = InvoiceParser.extractPayNowRecipient(from: rawText)?.nilIfEmpty,
           currentLooksGeneric {
            return recipient
        }

        return invoice.merchant
    }

    private func refinedCategory(for invoice: Invoice, rawText: String) -> String {
        let inferred = InvoiceParser.inferCategory(from: rawText, merchant: invoice.merchant)
        if inferred == "Credit Card Bill Payment" || inferred == "Services" {
            return inferred
        }

        let current = invoice.category?.nilIfEmpty
        if current == nil || current == "Miscellaneous" {
            return inferred
        }

        return current ?? inferred
    }

    private func learnReceiptCorrection(from original: Invoice, corrected: Invoice) {
        guard receiptCorrectionChanged(from: original, to: corrected) else { return }
        guard let keyword = correctionKeyword(from: original.rawText, merchant: original.merchant) else { return }

        let rule = ReceiptCorrectionRule(
            id: UUID(),
            merchantKeyword: keyword,
            correctedMerchant: corrected.merchant?.nilIfEmpty,
            correctedCategory: corrected.category?.nilIfEmpty,
            correctedCurrency: CurrencyConversionService.normalizedCurrency(corrected.receiptCurrency ?? corrected.currency),
            correctedCardLast4: PaymentMappingService.normalizedLast4(from: corrected.cardLast4),
            correctedCardBank: corrected.cardBank?.nilIfEmpty,
            learnedAt: Date(),
            useCount: 0
        )

        var rules = loadReceiptCorrectionRules()
        rules.removeAll { $0.merchantKeyword == rule.merchantKeyword }
        rules.insert(rule, at: 0)
        if rules.count > maximumReceiptCorrectionRules {
            rules = Array(rules.prefix(maximumReceiptCorrectionRules))
        }
        saveReceiptCorrectionRules(rules)
        AppSecurity.debugLog("Learned receipt correction for merchant keyword: \(rule.merchantKeyword).")
    }

    private func receiptCorrectionChanged(from original: Invoice, to corrected: Invoice) -> Bool {
        normalizedComparable(original.merchant) != normalizedComparable(corrected.merchant)
            || normalizedComparable(original.category) != normalizedComparable(corrected.category)
            || CurrencyConversionService.normalizedCurrency(original.receiptCurrency ?? original.currency) != CurrencyConversionService.normalizedCurrency(corrected.receiptCurrency ?? corrected.currency)
            || PaymentMappingService.normalizedLast4(from: original.cardLast4) != PaymentMappingService.normalizedLast4(from: corrected.cardLast4)
            || normalizedComparable(original.cardBank) != normalizedComparable(corrected.cardBank)
    }

    private func normalizedComparable(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().nilIfEmpty
    }

    private func correctionKeyword(from rawText: String, merchant: String?) -> String? {
        if let merchantKey = normalizedMerchantKey(merchant), merchantKey.count >= 3 {
            return merchantKey
        }

        return rawText
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { $0.count >= 3 && $0.count <= 60 }
            .flatMap { normalizedMerchantKey($0) }
    }

    private func matchingCorrectionRules(for rawText: String) -> [ReceiptCorrectionRule] {
        let haystack = normalizedKey(rawText, stopWords: []) ?? rawText.lowercased()
        return loadReceiptCorrectionRules()
            .filter { haystack.contains($0.merchantKeyword) }
            .prefix(12)
            .map { $0 }
    }

    private func learningHints(from rules: [ReceiptCorrectionRule]) -> [ReceiptLearningHint] {
        rules.map { rule in
            ReceiptLearningHint(
                merchantKeyword: rule.merchantKeyword,
                correctedMerchant: rule.correctedMerchant,
                correctedCategory: rule.correctedCategory,
                correctedCurrency: rule.correctedCurrency,
                correctedCardLast4: rule.correctedCardLast4,
                correctedCardBank: rule.correctedCardBank
            )
        }
    }

    private func applyCorrectionRules(_ rules: [ReceiptCorrectionRule], to invoice: inout Invoice) {
        guard let rule = rules.first else { return }
        if let correctedMerchant = rule.correctedMerchant?.nilIfEmpty {
            invoice.merchant = correctedMerchant
        }
        if let correctedCategory = rule.correctedCategory?.nilIfEmpty {
            invoice.category = correctedCategory
        }
        if let correctedCurrency = CurrencyConversionService.normalizedCurrency(rule.correctedCurrency) {
            invoice.currency = correctedCurrency
            invoice.receiptCurrency = correctedCurrency
        }
        if let correctedLast4 = PaymentMappingService.normalizedLast4(from: rule.correctedCardLast4) {
            invoice.cardLast4 = correctedLast4
        }
        if let correctedBank = rule.correctedCardBank?.nilIfEmpty {
            invoice.cardBank = correctedBank
        }
        markReceiptCorrectionRuleUsed(rule)
    }

    private func markReceiptCorrectionRuleUsed(_ rule: ReceiptCorrectionRule) {
        var rules = loadReceiptCorrectionRules()
        guard let index = rules.firstIndex(where: { $0.id == rule.id }) else { return }
        let updated = ReceiptCorrectionRule(
            id: rule.id,
            merchantKeyword: rule.merchantKeyword,
            correctedMerchant: rule.correctedMerchant,
            correctedCategory: rule.correctedCategory,
            correctedCurrency: rule.correctedCurrency,
            correctedCardLast4: rule.correctedCardLast4,
            correctedCardBank: rule.correctedCardBank,
            learnedAt: rule.learnedAt,
            useCount: rule.useCount + 1
        )
        rules.remove(at: index)
        rules.insert(updated, at: 0)
        saveReceiptCorrectionRules(rules)
    }

    private func loadReceiptCorrectionRules() -> [ReceiptCorrectionRule] {
        guard let data = UserDefaults.standard.data(forKey: receiptCorrectionRulesKey) else {
            return []
        }
        do {
            return try JSONDecoder().decode([ReceiptCorrectionRule].self, from: data)
        } catch {
            AppSecurity.debugLog("Failed to read receipt correction rules: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            return []
        }
    }

    private func saveReceiptCorrectionRules(_ rules: [ReceiptCorrectionRule]) {
        do {
            let data = try JSONEncoder().encode(rules)
            UserDefaults.standard.set(data, forKey: receiptCorrectionRulesKey)
        } catch {
            AppSecurity.debugLog("Failed to persist receipt correction rules: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    private enum ReceiptDuplicateKind {
        case creditCardBillPayment
        case payNowTransfer
        case genericReceipt
    }

    private func hasLikelyDuplicate(for invoice: Invoice, comparedTo scanInvoices: [Invoice] = []) -> Bool {
        if reviewedReceiptFingerprintsContain(invoice) {
            return true
        }

        var existingInvoices = invoices
        if let pendingReceipt {
            existingInvoices.append(pendingReceipt.invoice)
        }
        existingInvoices.append(contentsOf: pendingReceiptQueue.map(\.invoice))
        existingInvoices.append(contentsOf: scanInvoices)
        return existingInvoices.contains { receiptsAreLikelyDuplicates(invoice, $0) }
    }

    private func hasSavedLikelyDuplicate(for invoice: Invoice) -> Bool {
        invoices.contains { receiptsAreLikelyDuplicates(invoice, $0) }
    }

    private func reviewedReceiptFingerprintsContain(_ invoice: Invoice) -> Bool {
        let candidateRawHash = reviewedRawTextHash(for: invoice.rawText)
        let candidateSemanticKey = reviewedSemanticKey(for: invoice)
        return loadReviewedReceiptFingerprints().contains { fingerprint in
            if let candidateRawHash,
               let reviewedRawHash = fingerprint.rawTextHash,
               candidateRawHash == reviewedRawHash {
                return true
            }
            return fingerprint.semanticKey == candidateSemanticKey
        }
    }

    private func rememberReviewedReceipt(_ invoice: Invoice, action: String) {
        let fingerprint = ReviewedReceiptFingerprint(
            rawTextHash: reviewedRawTextHash(for: invoice.rawText),
            semanticKey: reviewedSemanticKey(for: invoice),
            reviewedAt: Date(),
            action: action
        )
        var fingerprints = loadReviewedReceiptFingerprints()
        fingerprints.removeAll { existing in
            (fingerprint.rawTextHash != nil && existing.rawTextHash == fingerprint.rawTextHash) || existing.semanticKey == fingerprint.semanticKey
        }
        fingerprints.insert(fingerprint, at: 0)
        if fingerprints.count > maximumReviewedReceiptFingerprints {
            fingerprints = Array(fingerprints.prefix(maximumReviewedReceiptFingerprints))
        }

        do {
            let data = try JSONEncoder().encode(fingerprints)
            UserDefaults.standard.set(data, forKey: reviewedReceiptFingerprintsKey)
        } catch {
            AppSecurity.debugLog("Failed to persist reviewed receipt fingerprint: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    private func loadReviewedReceiptFingerprints() -> [ReviewedReceiptFingerprint] {
        guard let data = UserDefaults.standard.data(forKey: reviewedReceiptFingerprintsKey) else {
            return []
        }
        do {
            return try JSONDecoder().decode([ReviewedReceiptFingerprint].self, from: data)
        } catch {
            AppSecurity.debugLog("Failed to read reviewed receipt fingerprints: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            return []
        }
    }

    private func reviewedRawTextHash(for rawText: String) -> String? {
        let normalized = normalizedReviewedRawText(rawText)
        guard !normalized.isEmpty else { return nil }
        let digest = SHA256.hash(data: Data(normalized.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func normalizedReviewedRawText(_ rawText: String) -> String {
        rawText
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func reviewedSemanticKey(for invoice: Invoice) -> String {
        let kind = String(describing: duplicateKind(for: invoice))
        let merchant = normalizedMerchantKey(invoice.merchant) ?? "unknown-merchant"
        let category = normalizedKey(invoice.category, stopWords: []) ?? "unknown-category"
        let amount = amountKey(for: invoice.total).map(String.init) ?? "unknown-amount"
        let date = invoice.date.map { Self.reviewedDateFormatter.string(from: calendar.startOfDay(for: $0)) } ?? "unknown-date"
        let card = invoice.cardLast4?.nilIfEmpty ?? normalizedMerchantKey(invoice.cardBank) ?? "unknown-card"
        return [kind, merchant, category, amount, date, card].joined(separator: "|")
    }

    private static let reviewedDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private func receiptsAreLikelyDuplicates(_ candidate: Invoice, _ existing: Invoice) -> Bool {
        guard let candidateAmount = amountKey(for: candidate.total),
              let existingAmount = amountKey(for: existing.total),
              candidateAmount == existingAmount else {
            return false
        }

        let candidateKind = duplicateKind(for: candidate)
        let existingKind = duplicateKind(for: existing)
        guard candidateKind == existingKind else { return false }

        switch candidateKind {
        case .creditCardBillPayment:
            guard creditCardIdentityMatches(candidate, existing) else { return false }
            return datesAreWithinTolerance(candidate.date, existing.date, days: 35, allowMissingDates: true)
        case .payNowTransfer:
            guard merchantKeysMatch(candidate.merchant, existing.merchant) else { return false }
            return datesAreWithinTolerance(candidate.date, existing.date, days: 1, allowMissingDates: false)
        case .genericReceipt:
            guard merchantKeysMatch(candidate.merchant, existing.merchant), categoryKeysMatch(candidate.category, existing.category) else { return false }
            return datesAreWithinTolerance(candidate.date, existing.date, days: 0, allowMissingDates: false)
        }
    }

    private func duplicateKind(for invoice: Invoice) -> ReceiptDuplicateKind {
        let text = "\(invoice.category ?? "")\n\(invoice.rawText)".lowercased()
        if invoice.category == "Credit Card Bill Payment" || InvoiceParser.isCreditCardBillPayment(text: text) || isCreditCardBillRelated(text) {
            return .creditCardBillPayment
        }
        if InvoiceParser.isPayNowTransfer(text: text) {
            return .payNowTransfer
        }
        return .genericReceipt
    }

    private func isCreditCardBillRelated(_ text: String) -> Bool {
        let hasCard = text.contains("credit card") || text.contains("card bill") || text.contains("card statement") || text.contains("visa") || text.contains("mastercard") || text.contains("amex")
        let hasBillContext = text.contains("statement") || text.contains("amount due") || text.contains("minimum payment") || text.contains("payment due") || text.contains("outstanding") || text.contains("card account") || text.contains("payment to credit card") || text.contains("credit card payment") || text.contains("card bill payment") || text.contains("bill payment confirmation")
        return hasCard && hasBillContext
    }

    private func amountKey(for total: Decimal?) -> Int64? {
        guard let total else { return nil }
        let cents = NSDecimalNumber(decimal: total)
            .multiplying(by: 100)
            .rounding(accordingToBehavior: NSDecimalNumberHandler(
                roundingMode: .plain,
                scale: 0,
                raiseOnExactness: false,
                raiseOnOverflow: false,
                raiseOnUnderflow: false,
                raiseOnDivideByZero: false
            ))
        return cents.int64Value
    }

    private func creditCardIdentityMatches(_ lhs: Invoice, _ rhs: Invoice) -> Bool {
        if let lhsLast4 = lhs.cardLast4?.nilIfEmpty,
           let rhsLast4 = rhs.cardLast4?.nilIfEmpty,
           lhsLast4 == rhsLast4 {
            return true
        }

        if merchantKeysMatch(lhs.cardBank, rhs.cardBank) {
            return true
        }

        return merchantKeysMatch(lhs.merchant, rhs.merchant)
    }

    private func categoryKeysMatch(_ lhs: String?, _ rhs: String?) -> Bool {
        normalizedKey(lhs, stopWords: []) == normalizedKey(rhs, stopWords: [])
    }

    private func merchantKeysMatch(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let lhsKey = normalizedMerchantKey(lhs), let rhsKey = normalizedMerchantKey(rhs) else {
            return false
        }
        return lhsKey == rhsKey || lhsKey.contains(rhsKey) || rhsKey.contains(lhsKey)
    }

    private func normalizedMerchantKey(_ value: String?) -> String? {
        normalizedKey(value, stopWords: [
            "email", "subject", "from", "gmail", "receipt", "invoice", "bill", "payment", "confirmation", "statement", "alert", "notification", "card", "credit"
        ])
    }

    private func normalizedKey(_ value: String?, stopWords: Set<String>) -> String? {
        guard var normalized = value?.lowercased().nilIfEmpty else { return nil }
        normalized = normalized.replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
        let tokens = normalized
            .split(separator: " ")
            .map(String.init)
            .filter { !stopWords.contains($0) }
        let key = tokens.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty || key == "unknown bank" ? nil : key
    }

    private func datesAreWithinTolerance(_ lhs: Date?, _ rhs: Date?, days: Int, allowMissingDates: Bool) -> Bool {
        guard let lhs, let rhs else { return allowMissingDates }
        let lhsDay = calendar.startOfDay(for: lhs)
        let rhsDay = calendar.startOfDay(for: rhs)
        let distance = abs(calendar.dateComponents([.day], from: lhsDay, to: rhsDay).day ?? Int.max)
        return distance <= days
    }

    private func displayDateForDebug(_ date: Date?) -> String {
        guard let date else { return "unknown" }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }

    private func reportingAmount(for invoice: Invoice) -> Decimal? {
        invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode)
    }

    private func needsCurrencyReconciliation(_ invoice: Invoice) -> Bool {
        let targetCurrency = CurrencyConversionService.normalizedCurrency(defaultCurrencyCode) ?? Invoice.defaultCurrency
        let sourceCurrency = CurrencyConversionService.normalizedCurrency(invoice.receiptCurrency ?? invoice.currency) ?? targetCurrency
        let storedDefaultCurrency = CurrencyConversionService.normalizedCurrency(invoice.defaultCurrency)

        if storedDefaultCurrency != targetCurrency { return true }
        if invoice.receiptAmount == nil, invoice.total != nil { return true }
        if invoice.receiptCurrency != sourceCurrency || invoice.currency != sourceCurrency { return true }
        if invoice.total == nil, invoice.receiptAmount != nil { return true }
        if invoice.convertedTotal == nil, invoice.receiptAmount != nil { return true }
        if invoice.conversionRate == nil, invoice.receiptAmount != nil { return true }
        if invoice.convertedTotal != nil, invoice.convertedTotal != invoice.total { return true }
        return false
    }

    private func reconcileLoadedReceiptCurrencies() async {
        guard !invoices.isEmpty else { return }

        var updatedCount = 0
        for index in invoices.indices {
            guard needsCurrencyReconciliation(invoices[index]) else { continue }
            var invoice = invoices[index]
            await applyCurrencyConversion(to: &invoice)

            do {
                try await supabaseService.updateReceipt(
                    id: invoice.id,
                    merchant: invoice.merchant,
                    date: invoice.date,
                    total: invoice.total,
                    receiptAmount: invoice.receiptAmount,
                    currency: invoice.currency,
                    defaultCurrency: invoice.defaultCurrency,
                    receiptCurrency: invoice.receiptCurrency ?? invoice.currency,
                    conversionRate: invoice.conversionRate,
                    convertedTotal: invoice.convertedTotal,
                    category: invoice.category,
                    cardLast4: invoice.cardLast4,
                    cardBank: invoice.cardBank,
                    rawText: invoice.rawText
                )
                invoices[index] = invoice
                updatedCount += 1
            } catch {
                invoices[index] = invoice
                updatedCount += 1
                AppSecurity.debugLog("Reconciled receipt currency locally for \(invoice.id), but backend update failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            }
        }

        if updatedCount > 0 {
            statusMessage = "Updated currency conversion for \(updatedCount) receipt\(updatedCount == 1 ? "" : "s")."
        }
    }

    private func applyCurrencyConversion(to invoice: inout Invoice) async {
        let receiptCurrency = CurrencyConversionService.normalizedCurrency(invoice.receiptCurrency ?? invoice.currency) ?? defaultCurrencyCode
        let receiptAmount = invoice.receiptAmount ?? invoice.total
        invoice.receiptAmount = receiptAmount
        invoice.receiptCurrency = receiptCurrency
        invoice.currency = receiptCurrency
        invoice.defaultCurrency = defaultCurrencyCode

        guard let result = await currencyConversionService.convert(
            amount: receiptAmount,
            from: receiptCurrency,
            to: defaultCurrencyCode,
            on: invoice.date
        ) else {
            invoice.conversionRate = receiptAmount == nil ? nil : 1
            invoice.convertedTotal = receiptAmount
            invoice.total = receiptAmount
            return
        }

        invoice.defaultCurrency = result.defaultCurrency
        invoice.receiptCurrency = result.receiptCurrency
        invoice.currency = result.receiptCurrency
        invoice.conversionRate = result.conversionRate
        invoice.convertedTotal = result.convertedTotal
        invoice.total = result.convertedTotal
    }

    private func applyPaymentLookup(to invoice: inout Invoice) async {
        invoice.cardLast4 = PaymentMappingService.normalizedLast4(from: invoice.cardLast4)
        guard let last4 = invoice.cardLast4 else { return }

        do {
            if let paymentMethod = try await paymentMappingService.findPaymentMethod(lastDigits: last4) {
                invoice.cardBank = paymentMethod.bankName
            } else if invoice.cardBank == nil {
                invoice.cardBank = "Unknown Bank"
            }
        } catch {
            if invoice.cardBank == nil {
                invoice.cardBank = "Unknown Bank"
            }
            AppSecurity.debugLog("Payment lookup failed for card ending \(last4): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    func handleSharedSMSURL(_ url: URL) async {
        guard url.scheme == "expensemanager", url.host == "import-sms" else { return }

        AppSecurity.debugLog("Received shared SMS URL.")
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let sharedText = components?.queryItems?.first(where: { $0.name == "text" })?.value
        guard let sharedText, !sharedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "No SMS text found in shared message."
            return
        }

        await importSMSText(sharedText, source: "shared SMS")
    }

    func importSMSText(_ text: String, source: String = "pasted SMS") async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "Paste or share an SMS message first."
            return
        }

        isProcessing = true
        statusMessage = "Scanning \(source) messages..."
        AppSecurity.debugLog("SMS scan started from \(source).")

        let messages = Self.smsMessageChunks(from: AppSecurity.clippedSensitiveText(trimmed, limit: AppSecurity.maxSharedTextCharacters))
        var importedCount = 0
        var skippedCount = 0

        for (index, message) in messages.enumerated() {
            let smsText = message.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !smsText.isEmpty else { continue }

            AppSecurity.debugLog("SMS scanned #\(index + 1).")

            guard InvoiceParser.looksLikeExpenseSMS(text: smsText) else {
                skippedCount += 1
                AppSecurity.debugLog("SMS skipped #\(index + 1), reason=not an expense alert.")
                continue
            }

            do {
                var invoice = try await invoiceFromExtractedText("SMS Expense Alert:\n\(smsText)")
                if invoice.date == nil {
                    invoice.date = Date()
                }

                if hasLikelyDuplicate(for: invoice) {
                    skippedCount += 1
                    AppSecurity.debugLog("SMS duplicate skipped #\(index + 1).")
                    continue
                }

                enqueuePendingReceipt(invoice: invoice, imageData: nil)
                importedCount += 1
                AppSecurity.debugLog("SMS identified #\(index + 1).")
            } catch {
                skippedCount += 1
                AppSecurity.debugLog("SMS parse failed #\(index + 1): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            }
        }

        if importedCount > 0 {
            statusMessage = "SMS scan found \(importedCount) expense\(importedCount == 1 ? "" : "s") for review.\(skippedCount > 0 ? " Skipped \(skippedCount)." : "")"
        } else {
            statusMessage = skippedCount > 0 ? "No new SMS expenses found. Skipped \(skippedCount) message\(skippedCount == 1 ? "" : "s")." : "No SMS expenses found."
        }

        isProcessing = false
    }

    private static func smsMessageChunks(from text: String) -> [String] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let blankLineChunks = normalized
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        if blankLineChunks.count > 1 {
            return blankLineChunks
        }

        let delimiter = "\n---\n"
        if normalized.contains(delimiter) {
            return normalized
                .components(separatedBy: delimiter)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }

        return [trimmedSMSBody(normalized)]
    }

    private static func trimmedSMSBody(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
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
                statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Sample trial failed. Please try again.")
                AppSecurity.debugLog("Sample trial failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            }
        }

        isProcessing = false
    }

    func enqueuePendingReceipt(invoice: Invoice, imageData: Data?) {
        enqueuePendingReceipt(invoice: invoice, imageData: imageData, presentImmediately: true)
    }

    private func enqueuePendingReceipt(invoice: Invoice, imageData: Data?, presentImmediately: Bool) {
        let pending = PendingReceipt(id: invoice.id, invoice: invoice, imageData: imageData)
        pendingReceiptQueue.append(pending)
        AppSecurity.debugLog("Pending receipt queued, queue size = \(pendingReceiptQueue.count).")
        if presentImmediately, pendingReceipt == nil {
            presentNextPendingReceipt()
        }
    }

    func presentNextPendingReceipt() {
        pendingReceipt = pendingReceiptQueue.isEmpty ? nil : pendingReceiptQueue.removeFirst()
    }

    func confirmPendingReceipt(_ invoice: Invoice) async {
        guard let currentPending = pendingReceipt else { return }
        var invoiceToSave = invoice
        if invoiceToSave.rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            invoiceToSave.rawText = currentPending.invoice.rawText
        }
        if hasSavedLikelyDuplicate(for: invoiceToSave) {
            rememberReviewedReceipt(currentPending.invoice, action: "duplicate-save-skip")
            statusMessage = "Skipped likely duplicate receipt for \(invoiceToSave.merchant ?? "unknown merchant")."
            pendingReceipt = nil
            presentNextPendingReceipt()
            return
        }

        isProcessing = true
        statusMessage = "Saving receipt..."
        await applyPaymentLookup(to: &invoiceToSave)
        await applyCurrencyConversion(to: &invoiceToSave)

        do {
            var fileUrl: String?
            var uploadWarning: String?
            if let imageData = currentPending.imageData {
                do {
                    let filename = "receipt-\(UUID().uuidString).jpg"
                    fileUrl = try await supabaseService.uploadReceiptImage(data: imageData, filename: filename)
                } catch {
                    uploadWarning = " Image upload skipped."
                    AppSecurity.debugLog("Receipt image upload failed, continuing with DB insert: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
                }
            }

            let receiptId = try await supabaseService.insertReceiptToDB(parsed: ParsedReceipt(
                merchant: invoiceToSave.merchant,
                date: invoiceToSave.date.map { ISO8601DateFormatter().string(from: $0) },
                total: invoiceToSave.total,
                receipt_amount: invoiceToSave.receiptAmount,
                currency: invoiceToSave.currency,
                default_currency: invoiceToSave.defaultCurrency,
                receipt_currency: invoiceToSave.receiptCurrency ?? invoiceToSave.currency,
                conversion_rate: invoiceToSave.conversionRate,
                converted_total: invoiceToSave.convertedTotal,
                extracted_digits: invoiceToSave.cardLast4,
                card_last4: invoiceToSave.cardLast4,
                card_bank: invoiceToSave.cardBank,
                category: invoiceToSave.category,
                line_items: nil
            ), rawText: invoiceToSave.rawText, fileUrl: fileUrl)

            var savedInvoice = invoiceToSave
            savedInvoice.id = receiptId
            savedInvoice.fileUrl = fileUrl
            invoices.insert(savedInvoice, at: 0)
            rememberReviewedReceipt(currentPending.invoice, action: "saved")
            rememberReviewedReceipt(savedInvoice, action: "saved-edited")
            learnReceiptCorrection(from: currentPending.invoice, corrected: savedInvoice)
            statusMessage = "Saved receipt for \(invoiceToSave.merchant ?? "unknown merchant").\(uploadWarning ?? "")"
        } catch {
            let message = AppSecurity.safeUserMessage(for: error, fallback: "Save failed. Check Supabase RLS/backend access.")
            AppSecurity.debugLog("Receipt save failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            statusMessage = message
        }

        isProcessing = false
        pendingReceipt = nil
        presentNextPendingReceipt()
    }

    func discardPendingReceipt() {
        if let pendingReceipt {
            rememberReviewedReceipt(pendingReceipt.invoice, action: "rejected")
            statusMessage = "Rejected receipt will be skipped in future scans."
        }
        pendingReceipt = nil
        presentNextPendingReceipt()
    }

    func updateInvoice(_ invoice: Invoice) async {
        isProcessing = true
        statusMessage = "Saving changes..."
        var updatedInvoice = invoice
        await applyPaymentLookup(to: &updatedInvoice)
        await applyCurrencyConversion(to: &updatedInvoice)

        do {
            try await supabaseService.updateReceipt(
                id: updatedInvoice.id,
                merchant: updatedInvoice.merchant,
                date: updatedInvoice.date,
                total: updatedInvoice.total,
                receiptAmount: updatedInvoice.receiptAmount,
                currency: updatedInvoice.currency,
                defaultCurrency: updatedInvoice.defaultCurrency,
                receiptCurrency: updatedInvoice.receiptCurrency ?? updatedInvoice.currency,
                conversionRate: updatedInvoice.conversionRate,
                convertedTotal: updatedInvoice.convertedTotal,
                category: updatedInvoice.category,
                cardLast4: updatedInvoice.cardLast4,
                cardBank: updatedInvoice.cardBank,
                rawText: updatedInvoice.rawText
            )
            if let index = invoices.firstIndex(where: { $0.id == updatedInvoice.id }) {
                learnReceiptCorrection(from: invoices[index], corrected: updatedInvoice)
                invoices[index] = updatedInvoice
            }
            statusMessage = "Receipt updated. Future similar receipts will use this correction."
        } catch {
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Update failed. Check Supabase RLS/backend access.")
            AppSecurity.debugLog("Receipt update failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
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
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Delete failed. Check Supabase RLS/backend access.")
            AppSecurity.debugLog("Receipt delete failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }

        isProcessing = false
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
