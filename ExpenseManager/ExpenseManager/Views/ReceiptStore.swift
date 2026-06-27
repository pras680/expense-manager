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
    @Published var pendingReceipt: PendingReceipt? = nil
    @Published var editingInvoice: Invoice? = nil
    @Published var searchText = ""
    @Published var selectedFilter: ReceiptFilter = .all
    @Published var paymentMethods: [PaymentMethod] = []

    let supabaseService: SupabaseService
    private let paymentMappingService: PaymentMappingService
    private let ocr = OCRService()
    private let calendar = Calendar.current
    private var pendingReceiptQueue: [PendingReceipt] = []

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

    func loadReceipts() async {
        isProcessing = true
        statusMessage = "Loading receipts..."

        do {
            invoices = try await supabaseService.fetchReceipts()
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
        print("DEBUG: photo item selected")

        do {
            if let data = try await item.loadTransferable(type: Data.self), let uiImage = UIImage(data: data) {
                statusMessage = "Processing receipt..."
                try await processImage(uiImage)
                statusMessage = "Receipt ready for review"
                print("DEBUG: photo import processed")
                // Small delay to ensure any sheet transitions complete
                try? await Task.sleep(nanoseconds: 200_000_000) // 0.2 seconds
                if pendingReceipt == nil {
                    presentNextPendingReceipt()
                }
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

    func processExtractedText(_ rawText: String, imageData: Data?) async throws {
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
        await applyPaymentLookup(to: &invoice)

        enqueuePendingReceipt(invoice: invoice, imageData: imageData)
        statusMessage = "Receipt extracted — review and approve before saving."
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
            print("DEBUG: payment lookup failed for card ending \(last4): \(error.localizedDescription)")
        }
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

    func enqueuePendingReceipt(invoice: Invoice, imageData: Data?) {
        let pending = PendingReceipt(id: invoice.id, invoice: invoice, imageData: imageData)
        pendingReceiptQueue.append(pending)
        print("DEBUG: enqueuePendingReceipt, queue size = \(pendingReceiptQueue.count)")
        if pendingReceipt == nil {
            presentNextPendingReceipt()
        }
    }

    func presentNextPendingReceipt() {
        pendingReceipt = pendingReceiptQueue.isEmpty ? nil : pendingReceiptQueue.removeFirst()
    }

    func confirmPendingReceipt(_ invoice: Invoice) async {
        guard let currentPending = pendingReceipt else { return }
        isProcessing = true
        statusMessage = "Saving receipt..."

        do {
            var fileUrl: String?
            var uploadWarning: String?
            if let imageData = currentPending.imageData {
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
            invoices.insert(savedInvoice, at: 0)
            statusMessage = "Saved receipt for \(invoice.merchant ?? "unknown merchant").\(uploadWarning ?? "")"
        } catch {
            statusMessage = "Save failed: \(error.localizedDescription)"
        }

        isProcessing = false
        pendingReceipt = nil
        presentNextPendingReceipt()
    }

    func discardPendingReceipt() {
        pendingReceipt = nil
        presentNextPendingReceipt()
    }

    func updateInvoice(_ invoice: Invoice) async {
        isProcessing = true
        statusMessage = "Saving changes..."
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
            statusMessage = "Receipt updated"
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
