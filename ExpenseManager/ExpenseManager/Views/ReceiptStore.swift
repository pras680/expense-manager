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
    @Published var telegramConfigured = false
    @Published var telegramFetchLog: String? = nil
    @Published var smsInboxFetchLog: String? = nil
    @Published var smsInboxPendingCount: Int? = nil
    @Published var smsInboxFailedCount: Int? = nil
    let supabaseService: SupabaseService
    private let paymentMappingService: PaymentMappingService
    private let currencyConversionService = CurrencyConversionService()
    private let ocr = OCRService()
    private let gmailScanner = GmailReceiptScanner()
    private let telegramService = TelegramService()
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
        self.telegramConfigured = telegramService.isConfigured()
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
        gmailAgentIsRunning ? "Stop Agent" : "Scan Gmail + Telegram"
    }

    var gmailAgentSubtitle: String {
        if gmailAgentIsRunning {
            return gmailScanSummary ?? "Scanning Gmail and Telegram now"
        }
        if let gmailScanSummary {
            return gmailScanSummary
        }
        if let gmailLastScanDate {
            return "Last scan: \(DateFormatter.localizedString(from: gmailLastScanDate, dateStyle: .medium, timeStyle: .short))"
        }
        return "Reads Gmail receipts and Telegram SMS alerts"
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
            return "No scan yet"
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
            gmailScanSummary = "Scan stopped."
            statusMessage = "Agent stopped."
            return
        }

        startManualGmailScan(lookbackDays: GmailOAuthConfiguration.maximumLookbackDays)
    }

    func startManualGmailScan(lookbackDays: Int) {
        let cappedDays = min(max(lookbackDays, 1), GmailOAuthConfiguration.maximumLookbackDays)
        if cappedDays != lookbackDays {
            statusMessage = "Gmail scan is capped at the last \(GmailOAuthConfiguration.maximumLookbackDays) days."
        }
        startGmailScan(allowInteractiveAuth: true, scheduled: false, lookbackDays: cappedDays, ignoreLastScanDate: true, presentLog: true, scanTelegram: true)
    }

    /// Manual "Scan Gmail" tap: scans Gmail only (Telegram is handled separately via
    /// Scan SMS) since the last check, allowing interactive sign-in when needed.
    func startManualGmailScanSinceLastCheck() {
        startGmailScan(allowInteractiveAuth: true, scheduled: false, lookbackDays: nil, ignoreLastScanDate: false, presentLog: true, scanTelegram: false)
    }

    func runGmailScanOnAppLoad() {
        startGmailScan(allowInteractiveAuth: false, scheduled: false, lookbackDays: nil, ignoreLastScanDate: false, presentLog: true, scanTelegram: true)
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
        gmailScanSummary = enabled ? "Daily Gmail + Telegram scan enabled." : "Daily Gmail + Telegram scan disabled."
        statusMessage = gmailScanSummary

        if enabled {
            GmailBackgroundScheduler.scheduleDailyScan()
            // Only run an immediate scan if today's daily scan hasn't happened yet, so
            // toggling the agent on doesn't repeatedly consume CPU/power for the same day.
            runDailyGmailAgentIfNeeded()
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

        startGmailScan(allowInteractiveAuth: false, scheduled: true, lookbackDays: nil, ignoreLastScanDate: false, presentLog: false, scanTelegram: true)
    }

    func runAutonomousDailyGmailScanFromBackground() async -> Bool {
        guard gmailDailyAgentEnabled else { return false }
        guard !gmailAgentIsRunning else { return true }

        if let lastRun = UserDefaults.standard.object(forKey: gmailLastDailyRunDateKey) as? Date,
           calendar.isDateInToday(lastRun) {
            return true
        }

        return await performGmailScan(allowInteractiveAuth: false, scheduled: true, lookbackDays: nil, ignoreLastScanDate: false, presentLog: false, scanTelegram: true)
    }

    private func startGmailScan(allowInteractiveAuth: Bool, scheduled: Bool, lookbackDays: Int?, ignoreLastScanDate: Bool, presentLog: Bool, scanTelegram: Bool) {
        guard !gmailAgentIsRunning else { return }

        gmailScanTask = Task { [weak self] in
            guard let self else { return }
            _ = await self.performGmailScan(allowInteractiveAuth: allowInteractiveAuth, scheduled: scheduled, lookbackDays: lookbackDays, ignoreLastScanDate: ignoreLastScanDate, presentLog: presentLog, scanTelegram: scanTelegram)
        }
    }

    @discardableResult
    private func performGmailScan(allowInteractiveAuth: Bool, scheduled: Bool, lookbackDays: Int?, ignoreLastScanDate: Bool, presentLog: Bool, scanTelegram: Bool) async -> Bool {
        guard !gmailAgentIsRunning else { return true }

        gmailAgentIsRunning = true
        isProcessing = true
        gmailScanSummary = scheduled ? "Daily scan is running..." : "Scan is running..."
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
            var reversalCount = 0
            var reversalMatchedCount = 0
            var importedDuringScan: [Invoice] = []
            var lastImportedInvoice: Invoice? = nil
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

                // Reversal/refund emails cancel out a matching original charge.
                let reversal = await applyReversalIfPresent(for: invoice, source: "Gmail")
                if reversal.isReversal {
                    let reversalDetail = reversal.removedOriginal
                        ? "Reversal matched and removed the original charge."
                        : "Reversal found but no matching original charge."
                    AppSecurity.debugLog("Gmail reversal handled: messageID=\(candidate.messageID), removedOriginal=\(reversal.removedOriginal).")
                    logLines.append(reversalDetail)
                    rememberReviewedReceipt(invoice, action: "reversal-processed")
                    reversalCount += 1
                    if reversal.removedOriginal {
                        reversalMatchedCount += 1
                    }
                    continue
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
                lastImportedInvoice = invoice
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

            // Agent runs also read Telegram (notification mirror) and the Supabase SMS inbox
            // (source of truth, populated by the iOS Shortcuts automation) in the same run.
            // A manual "Scan Gmail" tap keeps Gmail separate from these (scanTelegram=false).
            var telegram = AgentTelegramResult()
            var smsInbox = AgentSMSInboxResult()
            if scanTelegram {
                try Task.checkCancellation()
                let smsInboxProgress = "Checking SMS inbox for new messages..."
                gmailScanSummary = smsInboxProgress
                statusMessage = smsInboxProgress
                smsInbox = await scanSMSInboxForAgent(presentImmediately: !presentLog)
                importedCount += smsInbox.imported
                duplicateCount += smsInbox.skipped
                if let smsInboxLast = smsInbox.lastImported {
                    lastImportedInvoice = smsInboxLast
                }
                reversalCount += smsInbox.reversals
                reversalMatchedCount += smsInbox.reversalsMatched
                logLines.append(contentsOf: smsInbox.logLines)

                try Task.checkCancellation()
                let telegramProgress = "Checking Telegram for new messages..."
                gmailScanSummary = telegramProgress
                statusMessage = telegramProgress
                telegram = await scanTelegramForAgent(presentImmediately: !presentLog)
                importedCount += telegram.imported
                duplicateCount += telegram.skipped
                if let telegramLast = telegram.lastImported {
                    lastImportedInvoice = telegramLast
                }
                reversalCount += telegram.reversals
                reversalMatchedCount += telegram.reversalsMatched
                logLines.append(contentsOf: telegram.logLines)
            }

            let duplicateSummary = duplicateCount > 0 ? " Skipped \(duplicateCount) likely duplicate\(duplicateCount == 1 ? "" : "s")." : ""
            let reversalSummary = reversalCount > 0
                ? " Processed \(reversalCount) reversal\(reversalCount == 1 ? "" : "s")\(reversalMatchedCount > 0 ? ", removed \(reversalMatchedCount) original charge\(reversalMatchedCount == 1 ? "" : "s")" : "")."
                : ""
            let markerSummary = result.latestIdentifiedEmailDate.map { " Last identified email: \(DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .short))." } ?? " Last identified email marker unchanged."
            let smsInboxSummary: String
            if smsInbox.attempted {
                smsInboxSummary = smsInbox.errorMessage.map { " SMS inbox: \($0)" }
                    ?? " SMS inbox added \(smsInbox.imported) new receipt\(smsInbox.imported == 1 ? "" : "s") from \(smsInbox.messagesRead) message\(smsInbox.messagesRead == 1 ? "" : "s")."
            } else {
                smsInboxSummary = ""
            }
            let telegramSummary: String
            if telegram.attempted {
                telegramSummary = telegram.errorMessage.map { " Telegram: \($0)" }
                    ?? " Telegram added \(telegram.imported) new receipt\(telegram.imported == 1 ? "" : "s") from \(telegram.messagesRead) message\(telegram.messagesRead == 1 ? "" : "s")."
            } else {
                telegramSummary = ""
            }
            let sourceLabel = scanTelegram ? "Gmail, SMS inbox, and Telegram" : "Gmail"
            let lastReceiptSummary = importedCount > 0
                ? (lastReceiptDetail(for: lastImportedInvoice).map { " Last receipt: \($0)." } ?? "")
                : ""
            let summary = "Scan found \(importedCount) new receipt\(importedCount == 1 ? "" : "s") from \(sourceLabel) (\(result.scannedMessageCount) email\(result.scannedMessageCount == 1 ? "" : "s") checked).\(duplicateSummary)\(reversalSummary)\(smsInboxSummary)\(telegramSummary)\(lastReceiptSummary)\(markerSummary)"
            if result.receiptCandidates.isEmpty {
                logLines.append("No eligible receipts found in this Gmail scan.")
            }
            logLines.append("Summary: \(summary)")
            gmailScanSummary = summary
            statusMessage = importedCount > 0 ? "\(summary) Review extracted receipts before saving." : summary
            if presentLog {
                let reviewMessage = importedCount > 0 ? "\nReview the new receipt\(importedCount == 1 ? "" : "s") before saving." : ""
                gmailScanLog = GmailScanLog(title: "Scan Summary", message: "\(summary)\(reviewMessage)")
            }
            return true
        } catch is CancellationError {
            gmailScanSummary = "Scan stopped."
            statusMessage = "Agent stopped."
            if presentLog {
                gmailScanLog = GmailScanLog(title: "Scan Stopped", message: "The scan was stopped before completion.")
            }
            return false
        } catch {
            // Gmail failed (e.g. not signed in). Still try the SMS inbox and Telegram so agent
            // runs stay useful. A Gmail-only manual scan (scanTelegram=false) reports the Gmail
            // error directly.
            let gmailSafeMessage = AppSecurity.safeUserMessage(for: error, fallback: "Gmail scan could not complete. Check Gmail sign-in and backend access.")
            AppSecurity.debugLog("Gmail scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")

            if scanTelegram {
                let smsInbox = await scanSMSInboxForAgent(presentImmediately: !presentLog)
                let telegram = await scanTelegramForAgent(presentImmediately: !presentLog)
                if (smsInbox.attempted && smsInbox.errorMessage == nil) || (telegram.attempted && telegram.errorMessage == nil) {
                    let importedCount = smsInbox.imported + telegram.imported
                    let lastImported = telegram.lastImported ?? smsInbox.lastImported
                    let lastReceiptSummary = importedCount > 0
                        ? (lastReceiptDetail(for: lastImported).map { " Last receipt: \($0)." } ?? "")
                        : ""
                    let messagesRead = smsInbox.messagesRead + telegram.messagesRead
                    let fallbackSummary = "Gmail unavailable (\(gmailSafeMessage)) SMS inbox and Telegram added \(importedCount) new receipt\(importedCount == 1 ? "" : "s") from \(messagesRead) message\(messagesRead == 1 ? "" : "s").\(lastReceiptSummary)"
                    gmailScanSummary = fallbackSummary
                    statusMessage = importedCount > 0 ? "\(fallbackSummary) Review extracted receipts before saving." : fallbackSummary
                    if presentLog {
                        gmailScanLog = GmailScanLog(title: "Scan Summary", message: fallbackSummary)
                    }
                    return importedCount > 0
                }
            }

            gmailScanSummary = gmailSafeMessage
            statusMessage = gmailSafeMessage
            if presentLog {
                gmailScanLog = GmailScanLog(title: "Scan Error", message: gmailSafeMessage)
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

        // Same expense delivered through different channels (email vs SMS/Telegram) can
        // be classified differently because the wording differs. When the kinds don't
        // match, fall back to a cross-source comparison based on amount + identity + date.
        guard candidateKind == existingKind else {
            return crossSourceDuplicateMatches(candidate, existing)
        }

        switch candidateKind {
        case .creditCardBillPayment:
            guard creditCardIdentityMatches(candidate, existing) else { return false }
            return datesAreWithinTolerance(candidate.date, existing.date, days: 35, allowMissingDates: true)
        case .payNowTransfer:
            guard merchantKeysMatch(candidate.merchant, existing.merchant) else { return false }
            return datesAreWithinTolerance(candidate.date, existing.date, days: 0, allowMissingDates: true)
        case .genericReceipt:
            guard merchantKeysMatch(candidate.merchant, existing.merchant), categoryKeysMatch(candidate.category, existing.category) else {
                // Merchant/category wording often differs between an emailed receipt and
                // an SMS alert for the same purchase. Try the cross-source rule before giving up.
                return crossSourceDuplicateMatches(candidate, existing)
            }
            return datesAreWithinTolerance(candidate.date, existing.date, days: 0, allowMissingDates: true)
        }
    }

    /// Detects the same expense arriving from different sources (e.g. a Gmail receipt and a
    /// Telegram/SMS bank alert) where the text, classification, and even the extracted date
    /// may differ. Requires a matching amount (already confirmed by the caller) plus a
    /// matching merchant or card identity and an exact-day date match.
    private func crossSourceDuplicateMatches(_ candidate: Invoice, _ existing: Invoice) -> Bool {
        let identityMatches = merchantKeysMatch(candidate.merchant, existing.merchant)
            || creditCardIdentityMatches(candidate, existing)
        guard identityMatches else { return false }
        return datesAreWithinTolerance(candidate.date, existing.date, days: 0, allowMissingDates: true)
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
        let result = await importSMSMessages(messages, source: source)

        applySMSImportStatus(result, source: source, noMessagesFallback: "No SMS expenses found.")
        isProcessing = false
    }

    // MARK: - Telegram SMS ingestion

    /// True when a Telegram bot token has been saved to the Keychain.
    func refreshTelegramConfiguration() {
        telegramConfigured = telegramService.isConfigured()
    }

    func saveTelegramBotToken(_ token: String) async {
        await telegramService.saveToken(token)
        telegramConfigured = telegramService.isConfigured()
        statusMessage = telegramConfigured
            ? "Telegram bot connected. Tap Fetch from Telegram to import."
            : "Telegram bot token cleared."
    }

    func clearTelegramBotToken() async {
        await telegramService.clearToken()
        telegramConfigured = telegramService.isConfigured()
        statusMessage = "Telegram bot token removed."
    }

    /// Pulls new messages from the Telegram bot and routes each one through the
    /// same expense pipeline as pasted SMS (filtering, duplicate check, error handling).
    func importSMSFromTelegram() async {
        guard !isProcessing else {
            telegramFetchLog = "Telegram fetch ignored because another scan is already running."
            AppSecurity.debugLog(telegramFetchLog ?? "Telegram fetch ignored.")
            return
        }

        isProcessing = true
        statusMessage = "Reading messages from Telegram..."
        telegramFetchLog = "Starting Telegram fetch..."
        AppSecurity.debugLog("Telegram SMS scan started. configured=\(telegramConfigured)")

        defer {
            isProcessing = false
            AppSecurity.debugLog("Telegram SMS scan finished. status=\(statusMessage ?? "none")")
        }

        do {
            AppSecurity.debugLog("Telegram fetch: verifying active bot identity.")
            let identity = try await telegramService.fetchBotIdentity()
            telegramFetchLog = "Using Telegram bot \(identity.displayName). Reading messages..."
            AppSecurity.debugLog("Telegram fetch: requesting updates from Bot API.")
            let telegramMessages = try await telegramService.fetchNewMessages()
            let fetchedMessage = "Telegram returned \(telegramMessages.count) new message\(telegramMessages.count == 1 ? "" : "s")."
            telegramFetchLog = fetchedMessage
            AppSecurity.debugLog(fetchedMessage)
            guard !telegramMessages.isEmpty else {
                statusMessage = "No new Telegram messages to import. If you expected messages, send a new message to the bot and try again."
                telegramFetchLog = statusMessage
                return
            }

            let clippedMessages = telegramMessages.map {
                AppSecurity.clippedSensitiveText($0.text, limit: AppSecurity.maxSharedTextCharacters)
            }
            let eligibleCount = clippedMessages.filter { InvoiceParser.looksLikeExpenseSMS(text: $0) }.count
            telegramFetchLog = "Parsing \(clippedMessages.count) Telegram message\(clippedMessages.count == 1 ? "" : "s"); \(eligibleCount) eligible for Expense Manager..."
            AppSecurity.debugLog("Telegram Expense Manager eligibility: newSms=\(clippedMessages.count), eligibleForExpenseParsing=\(eligibleCount), ineligible=\(clippedMessages.count - eligibleCount)")
            let result = await importSMSMessages(clippedMessages, source: "Telegram")
            AppSecurity.debugLog("Telegram Expense Manager processing summary: eligible=\(result.eligible), imported=\(result.imported), skipped=\(result.skipped), reversals=\(result.reversals), reversalsMatched=\(result.reversalsMatched)")
            applySMSImportStatus(result, source: "Telegram", noMessagesFallback: "No Telegram expenses found.")
            telegramFetchLog = statusMessage
        } catch {
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Could not read Telegram messages. Please try again.")
            telegramFetchLog = statusMessage
            AppSecurity.debugLog("Telegram scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    // MARK: - SMS inbox ingestion (iOS Shortcuts automation via Supabase)

    /// Pulls pending rows from the Supabase `sms_inbox` table (populated by the `receive-sms`
    /// Edge Function via an iOS Shortcuts automation), routes each through the same expense
    /// pipeline as pasted/Telegram SMS, and marks each row processed/skipped/failed.
    /// Refreshes the pending/failed row counts so the Scan SMS sheet can show inbox health
    /// without needing to open the Supabase SQL editor.
    func refreshSMSInboxCounts() async {
        do {
            let counts = try await supabaseService.fetchSMSInboxCounts()
            smsInboxPendingCount = counts.pending
            smsInboxFailedCount = counts.failed
        } catch {
            AppSecurity.debugLog("SMS inbox count refresh failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    func importSMSFromInbox() async {
        guard !isProcessing else {
            smsInboxFetchLog = "SMS inbox scan ignored because another scan is already running."
            AppSecurity.debugLog(smsInboxFetchLog ?? "SMS inbox scan ignored.")
            return
        }

        isProcessing = true
        statusMessage = "Checking SMS inbox..."
        smsInboxFetchLog = "Checking SMS inbox..."
        AppSecurity.debugLog("SMS inbox scan started.")

        defer {
            isProcessing = false
            AppSecurity.debugLog("SMS inbox scan finished. status=\(statusMessage ?? "none")")
        }

        do {
            let rows = try await supabaseService.fetchPendingSMSInbox()
            smsInboxFetchLog = "SMS inbox returned \(rows.count) pending message\(rows.count == 1 ? "" : "s")."
            AppSecurity.debugLog(smsInboxFetchLog ?? "")
            guard !rows.isEmpty else {
                statusMessage = "No new SMS inbox messages to import."
                smsInboxFetchLog = statusMessage
                return
            }

            let result = await processSMSInboxRows(rows)
            applySMSImportStatus(result, source: "SMS inbox", noMessagesFallback: "No SMS inbox expenses found.")
            smsInboxFetchLog = statusMessage
        } catch {
            statusMessage = AppSecurity.safeUserMessage(for: error, fallback: "Could not read the SMS inbox. Please try again.")
            smsInboxFetchLog = statusMessage
            AppSecurity.debugLog("SMS inbox scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
        await refreshSMSInboxCounts()
    }

    /// Runs each pending inbox row through the expense pipeline and marks it processed/skipped/failed
    /// so a re-scan never imports the same SMS twice.
    private func processSMSInboxRows(_ rows: [SupabaseService.SMSInboxRow], presentImmediately: Bool = true) async -> SMSImportResult {
        var result = SMSImportResult()

        for (index, row) in rows.enumerated() {
            let smsText = AppSecurity.clippedSensitiveText(row.body, limit: AppSecurity.maxSharedTextCharacters)
            guard !smsText.isEmpty else {
                await markSMSInboxSafely(row.id, status: "skipped", errorMessage: "Empty body")
                result.skipped += 1
                continue
            }

            AppSecurity.debugLog("SMS inbox message scanned #\(index + 1).")

            guard InvoiceParser.looksLikeExpenseSMS(text: smsText) else {
                await markSMSInboxSafely(row.id, status: "skipped", errorMessage: nil)
                result.skipped += 1
                AppSecurity.debugLog("SMS inbox skipped #\(index + 1), reason=not an expense alert.")
                continue
            }
            result.eligible += 1

            do {
                var invoice = try await invoiceFromExtractedText("SMS Expense Alert:\n\(smsText)")
                if invoice.date == nil {
                    invoice.date = row.receivedAt ?? Date()
                }

                let reversal = await applyReversalIfPresent(for: invoice, source: "SMS inbox")
                if reversal.isReversal {
                    result.reversals += 1
                    if reversal.removedOriginal {
                        result.reversalsMatched += 1
                    }
                    rememberReviewedReceipt(invoice, action: "reversal-processed")
                    await markSMSInboxSafely(row.id, status: "processed", errorMessage: nil)
                    AppSecurity.debugLog("SMS inbox reversal handled #\(index + 1), removedOriginal=\(reversal.removedOriginal).")
                    continue
                }

                if hasLikelyDuplicate(for: invoice) {
                    result.skipped += 1
                    await markSMSInboxSafely(row.id, status: "skipped", errorMessage: "Likely duplicate")
                    AppSecurity.debugLog("SMS inbox duplicate skipped #\(index + 1).")
                    continue
                }

                enqueuePendingReceipt(invoice: invoice, imageData: nil, presentImmediately: presentImmediately)
                result.imported += 1
                result.lastImported = invoice
                await markSMSInboxSafely(row.id, status: "processed", errorMessage: nil)
                AppSecurity.debugLog("SMS inbox identified #\(index + 1).")
            } catch {
                result.skipped += 1
                await markSMSInboxSafely(row.id, status: "failed", errorMessage: AppSecurity.redactedDiagnostic(error.localizedDescription))
                AppSecurity.debugLog("SMS inbox parse failed #\(index + 1): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            }
        }

        return result
    }

    private func markSMSInboxSafely(_ id: UUID, status: String, errorMessage: String?) async {
        do {
            try await supabaseService.markSMSInbox(id: id, status: status, receiptId: nil, errorMessage: errorMessage)
        } catch {
            AppSecurity.debugLog("Failed to update sms_inbox row \(id): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
        }
    }

    private struct AgentSMSInboxResult {
        var attempted = false
        var messagesRead = 0
        var imported = 0
        var skipped = 0
        var reversals = 0
        var reversalsMatched = 0
        var logLines: [String] = []
        var errorMessage: String? = nil
        var lastImported: Invoice? = nil
    }

    /// Reads pending SMS inbox rows as part of an agent scan run. Silent and non-throwing:
    /// returns counts and log lines so the caller can fold them into its summary.
    private func scanSMSInboxForAgent(presentImmediately: Bool) async -> AgentSMSInboxResult {
        var out = AgentSMSInboxResult()
        out.attempted = true
        do {
            let rows = try await supabaseService.fetchPendingSMSInbox()
            out.messagesRead = rows.count
            guard !rows.isEmpty else {
                out.logLines.append("No new SMS inbox messages found.")
                return out
            }

            let result = await processSMSInboxRows(rows, presentImmediately: presentImmediately)
            out.imported = result.imported
            out.skipped = result.skipped
            out.reversals = result.reversals
            out.reversalsMatched = result.reversalsMatched
            out.lastImported = result.lastImported
            out.logLines.append("SMS inbox messages read: \(rows.count)")
            out.logLines.append("New SMS inbox receipts queued: \(result.imported)\(result.skipped > 0 ? ", skipped \(result.skipped)" : "").")
            if result.reversals > 0 {
                out.logLines.append("SMS inbox reversals: \(result.reversals) (matched \(result.reversalsMatched) original charge\(result.reversalsMatched == 1 ? "" : "s")).")
            }
        } catch {
            out.errorMessage = AppSecurity.safeUserMessage(for: error, fallback: "SMS inbox scan could not complete.")
            AppSecurity.debugLog("Agent SMS inbox scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            out.logLines.append("SMS inbox scan error: \(out.errorMessage ?? "unknown")")
        }
        return out
    }

    private struct SMSImportResult {
        var eligible = 0
        var imported = 0
        var skipped = 0
        var reversals = 0
        var reversalsMatched = 0
        var lastImported: Invoice? = nil
    }

    private func importSMSMessages(_ messages: [String], source: String, presentImmediately: Bool = true) async -> SMSImportResult {
        var result = SMSImportResult()

        for (index, message) in messages.enumerated() {
            let smsText = message.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !smsText.isEmpty else { continue }

            AppSecurity.debugLog("\(source) message scanned #\(index + 1).")

            guard InvoiceParser.looksLikeExpenseSMS(text: smsText) else {
                result.skipped += 1
                AppSecurity.debugLog("\(source) skipped #\(index + 1), reason=not an expense alert.")
                continue
            }
            result.eligible += 1

            do {
                var invoice = try await invoiceFromExtractedText("SMS Expense Alert:\n\(smsText)")
                if invoice.date == nil {
                    invoice.date = Date()
                }

                // Reversal/refund alerts cancel out the matching original charge instead
                // of being recorded as a new expense.
                let reversal = await applyReversalIfPresent(for: invoice, source: source)
                if reversal.isReversal {
                    result.reversals += 1
                    if reversal.removedOriginal {
                        result.reversalsMatched += 1
                    }
                    rememberReviewedReceipt(invoice, action: "reversal-processed")
                    AppSecurity.debugLog("\(source) reversal handled #\(index + 1), removedOriginal=\(reversal.removedOriginal).")
                    continue
                }

                if hasLikelyDuplicate(for: invoice) {
                    result.skipped += 1
                    AppSecurity.debugLog("\(source) duplicate skipped #\(index + 1).")
                    continue
                }

                enqueuePendingReceipt(invoice: invoice, imageData: nil, presentImmediately: presentImmediately)
                result.imported += 1
                result.lastImported = invoice
                AppSecurity.debugLog("\(source) identified #\(index + 1).")
            } catch {
                result.skipped += 1
                AppSecurity.debugLog("\(source) parse failed #\(index + 1): \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            }
        }

        return result
    }

    private struct AgentTelegramResult {
        var attempted = false
        var messagesRead = 0
        var imported = 0
        var skipped = 0
        var reversals = 0
        var reversalsMatched = 0
        var logLines: [String] = []
        var errorMessage: String? = nil
        var lastImported: Invoice? = nil
    }

    /// Reads new Telegram messages as part of an agent scan run. Silent and non-throwing:
    /// returns counts and log lines so the caller can fold them into its summary. Does not
    /// touch `isProcessing`/`gmailAgentIsRunning` (the caller owns those).
    private func scanTelegramForAgent(presentImmediately: Bool) async -> AgentTelegramResult {
        var out = AgentTelegramResult()
        guard telegramService.isConfigured() else {
            out.logLines.append("Telegram not connected — skipped.")
            return out
        }

        out.attempted = true
        do {
            let telegramMessages = try await telegramService.fetchNewMessages()
            out.messagesRead = telegramMessages.count
            guard !telegramMessages.isEmpty else {
                out.logLines.append("No new Telegram messages found.")
                return out
            }

            let clippedMessages = telegramMessages.map {
                AppSecurity.clippedSensitiveText($0.text, limit: AppSecurity.maxSharedTextCharacters)
            }
            let result = await importSMSMessages(clippedMessages, source: "Telegram", presentImmediately: presentImmediately)
            out.imported = result.imported
            out.skipped = result.skipped
            out.reversals = result.reversals
            out.reversalsMatched = result.reversalsMatched
            out.lastImported = result.lastImported
            out.logLines.append("Telegram messages read: \(telegramMessages.count)")
            out.logLines.append("New Telegram receipts queued: \(result.imported)\(result.skipped > 0 ? ", skipped \(result.skipped)" : "").")
            if result.reversals > 0 {
                out.logLines.append("Telegram reversals: \(result.reversals) (matched \(result.reversalsMatched) original charge\(result.reversalsMatched == 1 ? "" : "s")).")
            }
        } catch {
            out.errorMessage = AppSecurity.safeUserMessage(for: error, fallback: "Telegram scan could not complete.")
            AppSecurity.debugLog("Agent Telegram scan failed: \(AppSecurity.redactedDiagnostic(error.localizedDescription))")
            out.logLines.append("Telegram scan error: \(out.errorMessage ?? "unknown")")
        }
        return out
    }

    private func applySMSImportStatus(_ result: SMSImportResult, source: String, noMessagesFallback: String) {
        let reversalDetail = result.reversals > 0
            ? " Processed \(result.reversals) reversal\(result.reversals == 1 ? "" : "s")\(result.reversalsMatched > 0 ? ", removed \(result.reversalsMatched) original charge\(result.reversalsMatched == 1 ? "" : "s")" : "")."
            : ""
        if result.imported > 0 {
            let lastDetail = lastReceiptDetail(for: result.lastImported).map { " Last: \($0)." } ?? ""
            statusMessage = "\(source) scan found \(result.imported) expense\(result.imported == 1 ? "" : "s") for review.\(result.skipped > 0 ? " Skipped \(result.skipped)." : "")\(reversalDetail)\(lastDetail)"
        } else if result.reversals > 0 {
            statusMessage = "No new expenses found.\(reversalDetail)"
        } else {
            statusMessage = result.skipped > 0
                ? "No new expenses found. Skipped \(result.skipped) message\(result.skipped == 1 ? "" : "s")."
                : noMessagesFallback
        }
    }

    /// Short "amount • date" description of the most recently imported receipt for scan popups.
    private func lastReceiptDetail(for invoice: Invoice?) -> String? {
        guard let invoice else { return nil }
        let amountText = invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode)
            .map { $0.formatted(.currency(code: defaultCurrencyCode)) }
            ?? invoice.total.map { $0.formatted(.currency(code: invoice.currency ?? defaultCurrencyCode)) }
            ?? "amount pending"
        let dateText = invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "no date"
        return "\(amountText) on \(dateText)"
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

    // MARK: - Reversal / refund handling

    struct ReversalOutcome {
        var isReversal = false
        var removedOriginal = false
    }

    /// If `invoice` is a reversal/refund alert, cancel out the matching original charge
    /// (same amount + business entity) instead of recording it as a new expense.
    /// Searches the pending review queue and saved receipts. Returns whether the invoice
    /// was a reversal (so callers can skip enqueuing it) and whether an original was removed.
    @discardableResult
    private func applyReversalIfPresent(for invoice: Invoice, source: String) async -> ReversalOutcome {
        var outcome = ReversalOutcome()
        let text = "\(invoice.category ?? "")\n\(invoice.rawText)"
        guard InvoiceParser.isReversalTransaction(text: text) else {
            return outcome
        }
        outcome.isReversal = true
        AppSecurity.debugLog("\(source) reversal alert detected; searching for original charge to cancel.")

        // 1. Remove a matching not-yet-presented pending receipt.
        if let queueIndex = pendingReceiptQueue.firstIndex(where: { reversalMatchesOriginal(reversal: invoice, original: $0.invoice) }) {
            let removed = pendingReceiptQueue.remove(at: queueIndex)
            rememberReviewedReceipt(removed.invoice, action: "reversal-cancelled-pending")
            outcome.removedOriginal = true
            AppSecurity.debugLog("\(source) reversal cancelled a queued pending receipt.")
            return outcome
        }

        // 2. Cancel the receipt currently presented for review.
        if let currentPending = pendingReceipt, reversalMatchesOriginal(reversal: invoice, original: currentPending.invoice) {
            rememberReviewedReceipt(currentPending.invoice, action: "reversal-cancelled-pending")
            pendingReceipt = nil
            presentNextPendingReceipt()
            outcome.removedOriginal = true
            AppSecurity.debugLog("\(source) reversal cancelled the receipt under review.")
            return outcome
        }

        // 3. Delete a matching already-saved receipt. Prefer the most recent match.
        if let saved = invoices
            .filter({ reversalMatchesOriginal(reversal: invoice, original: $0) })
            .sorted(by: { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) })
            .first {
            await deleteInvoice(saved)
            outcome.removedOriginal = true
            AppSecurity.debugLog("\(source) reversal deleted a previously saved receipt.")
        }

        return outcome
    }

    /// A reversal matches an original charge when the amounts are equal and the business
    /// entity (merchant or card identity) lines up. Dates are not required because a
    /// reversal can post days after the original charge.
    private func reversalMatchesOriginal(reversal: Invoice, original: Invoice) -> Bool {
        guard let reversalAmount = amountKey(for: reversal.total),
              let originalAmount = amountKey(for: original.total),
              reversalAmount == originalAmount else {
            return false
        }
        return merchantKeysMatch(reversal.merchant, original.merchant)
            || creditCardIdentityMatches(reversal, original)
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
