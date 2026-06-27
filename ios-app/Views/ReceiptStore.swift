import Foundation
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

    let supabaseService: SupabaseService
    private let ocr = OCRService()
    private let calendar = Calendar.current
    private var pendingReceiptQueue: [PendingReceipt] = []

    struct PendingReceipt: Identifiable {
        let id: UUID
        var invoice: Invoice
        var imageData: Data?
    }

    enum ReceiptFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case last30Days = "Last 30 Days"
        case noDate = "No Date"

        var id: String { rawValue }
    }

    init(supabaseService: SupabaseService) {
        self.supabaseService = supabaseService
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
            statusMessage = "Loaded \(invoices.count) receipts"
        } catch {
            invoices = []
            statusMessage = "Receipts will save after backend access is configured."
            print("DEBUG: fetch receipts failed: \(error.localizedDescription)")
        }

        isProcessing = false
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
                currency: fallbackInvoice.currency ?? "USD",
                extracted_digits: nil,
                category: nil,
                line_items: nil
            )
            statusMessage = "Cloud parsing unavailable; using on-device extraction."
            print("DEBUG: edge parse failed, using local parser: \(error.localizedDescription)")
        }

        var invoice = Invoice(from: parsed, rawText: rawText)
        invoice.currency = parsed.currency ?? "USD"

        enqueuePendingReceipt(invoice: invoice, imageData: imageData)
        statusMessage = "Receipt extracted — review and approve before saving."
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
                extracted_digits: nil,
                category: nil,
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

        do {
            try await supabaseService.updateReceipt(
                id: invoice.id,
                merchant: invoice.merchant,
                date: invoice.date,
                total: invoice.total,
                currency: invoice.currency
            )
            if let index = invoices.firstIndex(where: { $0.id == invoice.id }) {
                invoices[index] = invoice
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
