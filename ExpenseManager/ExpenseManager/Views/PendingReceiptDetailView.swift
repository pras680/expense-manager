import SwiftUI

/// Full single-receipt editor for one line in the pending review queue. Opened via the
/// "Detail" action on a `PendingReceiptQueueView` row so the extracted fields can be corrected
/// before approving, or the full receipt message can be read before deciding.
struct PendingReceiptDetailView: View {
    @ObservedObject var store: ReceiptStore
    let pending: ReceiptStore.PendingReceipt
    let onApprove: (Invoice) async -> Void
    let onReject: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var merchant: String
    @State private var date: Date
    @State private var total: String
    @State private var currency: String
    @State private var category: String
    @State private var cardLast4: String
    @State private var cardBank: String
    @State private var rawText: String
    @State private var isSaving = false

    init(store: ReceiptStore, pending: ReceiptStore.PendingReceipt, onApprove: @escaping (Invoice) async -> Void, onReject: @escaping () -> Void) {
        self.store = store
        self.pending = pending
        self.onApprove = onApprove
        self.onReject = onReject
        _merchant = State(initialValue: pending.invoice.merchant ?? "")
        _date = State(initialValue: pending.invoice.date ?? Date())
        _total = State(initialValue: pending.invoice.total.map { NSDecimalNumber(decimal: $0).stringValue } ?? "")
        _currency = State(initialValue: pending.invoice.currency ?? Invoice.defaultCurrency)
        _category = State(initialValue: pending.invoice.category ?? "Miscellaneous")
        _cardLast4 = State(initialValue: pending.invoice.cardLast4 ?? "")
        _cardBank = State(initialValue: pending.invoice.cardBank ?? "")
        _rawText = State(initialValue: pending.invoice.rawText)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            RuleLine()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    Text("Verify the extracted values before saving.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)

                    extractedSummary

                    FlatField(label: "Merchant") {
                        TextField("Merchant", text: $merchant)
                    }
                    FlatField(label: "Date") {
                        DatePicker("", selection: $date, displayedComponents: .date)
                            .labelsHidden()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    HStack(spacing: AppTheme.space3) {
                        FlatField(label: "Amount") {
                            TextField("0.00", text: $total)
                                .keyboardType(.decimalPad)
                        }
                        FlatField(label: "Currency") {
                            Picker("", selection: $currency) {
                                ForEach(Invoice.commonCurrencies, id: \.self) { Text($0).tag($0) }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(width: 100)
                    }
                    FlatField(label: "Category") {
                        Picker("", selection: $category) {
                            ForEach(Invoice.expenseCategories, id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    HStack(spacing: AppTheme.space3) {
                        menuField(title: "Card Bank", selection: $cardBank, options: store.availableCardBankOptions)
                        FlatField(label: "Last 4") {
                            TextField("0000", text: $cardLast4)
                                .keyboardType(.numberPad)
                        }
                        .frame(width: 90)
                    }
                    FlatField(label: "Full Receipt Message") {
                        ZStack(alignment: .topLeading) {
                            if rawText.isEmpty {
                                Text("No raw text was captured for this receipt.")
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(AppTheme.textMuted)
                                    .padding(.top, 8)
                                    .padding(.leading, 5)
                                    .allowsHitTesting(false)
                            }
                            TextEditor(text: $rawText)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(AppTheme.text)
                                .frame(minHeight: 220)
                                .scrollContentBackground(.hidden)
                        }
                    }
                }
                .padding(AppTheme.space4)
            }
        }
        .background(AppTheme.bg.ignoresSafeArea())
    }

    // Reject and Approve & Save both live in the header (not below the scrollable fields) so
    // approving never requires scrolling past the full receipt message first.
    private var header: some View {
        HStack {
            Button("Reject") {
                onReject()
                dismiss()
            }
            .font(AppFont.headline)
            .foregroundStyle(AppTheme.accent700)
            .disabled(isSaving)
            Spacer()
            Text("Receipt Detail")
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
            Spacer()
            Button {
                approve()
            } label: {
                if isSaving {
                    ProgressView()
                } else {
                    Text("Approve & Save")
                }
            }
            .font(AppFont.headline)
            .foregroundStyle(AppTheme.accent)
            .disabled(isSaving || merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || Decimal(string: total.replacingOccurrences(of: ",", with: "")) == nil)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space6 + AppTheme.space2)
        .padding(.bottom, AppTheme.space3)
    }

    private var extractedSummary: some View {
        HStack(spacing: 1) {
            StatCell(title: "Merchant", value: merchant.isEmpty ? "Missing" : merchant, valueSize: 14)
            StatCell(title: "Total", value: total.isEmpty ? "Missing" : total, valueSize: 14)
            StatCell(title: "Card", value: cardSummary, valueSize: 14)
        }
        .background(AppTheme.divider)
    }

    private func approve() {
        var invoice = pending.invoice
        invoice.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.date = date
        invoice.total = Decimal(string: total.replacingOccurrences(of: ",", with: ""))
        invoice.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.category = category.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.cardLast4 = PaymentMappingService.normalizedLast4(from: cardLast4)
        invoice.cardBank = cardBank.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        invoice.rawText = rawText
        isSaving = true
        Task {
            await onApprove(invoice)
            isSaving = false
            dismiss()
        }
    }

    private var cardSummary: String {
        if !cardBank.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !cardLast4.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "\(cardBank) •••• \(cardLast4)"
        }
        if !cardLast4.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "•••• \(cardLast4)"
        }
        return "Missing"
    }

    private func menuField(title: String, selection: Binding<String>, options: [String]) -> some View {
        let allOptions = Array(Set(options + (selection.wrappedValue.nilIfEmpty.map { [$0] } ?? []))).sorted()
        return FlatField(label: title) {
            Picker("", selection: selection) {
                Text("Not selected").tag("")
                ForEach(allOptions, id: \.self) { option in
                    Text(option).tag(option)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
