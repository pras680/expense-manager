import SwiftUI

struct PendingReceiptReviewView: View {
    @ObservedObject var store: ReceiptStore
    @Binding var pending: ReceiptStore.PendingReceipt?
    let onConfirm: (Invoice) async -> Void
    let onDiscard: () -> Void

    @FocusState private var focusedField: ReviewField?
    @State private var merchant: String = ""
    @State private var date: Date = Date()
    @State private var total: String = ""
    @State private var currency: String = Invoice.defaultCurrency
    @State private var category: String = "Miscellaneous"
    @State private var cardLast4: String = ""
    @State private var cardBank: String = ""
    @State private var rawText: String = ""

    private enum ReviewField: Hashable {
        case merchant
        case total
        case rawText
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            RuleLine()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    Text("Confirm the fields below. Approve saves the receipt to Supabase and uploads the receipt image when available.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)

                    extractedSummary
                    topActionButtons

                    FlatField(label: "Merchant") {
                        TextField("Merchant", text: $merchant)
                            .focused($focusedField, equals: .merchant)
                            .submitLabel(.done)
                    }
                    FlatField(label: "Date") {
                        DatePicker("", selection: $date, displayedComponents: .date)
                            .labelsHidden()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    HStack(spacing: AppTheme.space3) {
                        FlatField(label: "Receipt Amount") {
                            TextField("0.00", text: $total)
                                .focused($focusedField, equals: .total)
                                .keyboardType(.decimalPad)
                                .submitLabel(.done)
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
                        menuField(title: "Card Last 4", selection: $cardLast4, options: store.availableCardLast4Options)
                        menuField(title: "Card Bank", selection: $cardBank, options: store.availableCardBankOptions)
                    }
                    FlatField(label: "Raw OCR Text") {
                        TextEditor(text: $rawText)
                            .focused($focusedField, equals: .rawText)
                            .font(.system(size: 11, design: .monospaced))
                            .frame(minHeight: 150)
                            .scrollContentBackground(.hidden)
                    }

                    actionButtons
                }
                .padding(AppTheme.space4)
            }
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .task {
            guard let pending = pending else { return }
            merchant = pending.invoice.merchant ?? ""
            date = pending.invoice.date ?? Date()
            total = pending.invoice.displayReceiptAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""
            currency = pending.invoice.displayReceiptCurrency
            category = pending.invoice.category ?? "Miscellaneous"
            cardLast4 = pending.invoice.cardLast4 ?? ""
            cardBank = pending.invoice.cardBank ?? ""
            rawText = pending.invoice.rawText
        }
    }

    private var header: some View {
        HStack {
            Button("Cancel") { onDiscard() }
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.accent700)
            Spacer()
            Text("Review Receipt")
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
            Spacer()
            Color.clear.frame(width: 56, height: 1)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space6 + AppTheme.space2)
        .padding(.bottom, AppTheme.space3)
    }

    private var extractedSummary: some View {
        HStack(spacing: 1) {
            StatCell(title: "Merchant", value: merchant.isEmpty ? "Missing" : merchant, valueSize: 14)
            StatCell(title: "Receipt Amount", value: total.isEmpty ? "Missing" : "\(currency) \(total)", valueSize: 14)
            StatCell(title: "Card", value: cardSummary, valueSize: 14)
        }
        .background(AppTheme.divider)
    }

    private var topActionButtons: some View {
        HStack(spacing: AppTheme.space3) {
            Button("Reject", action: onDiscard)
                .buttonStyle(FlatSecondaryButtonStyle(tint: AppTheme.accent700))
            Button("Save", action: approve)
                .buttonStyle(FlatPrimaryButtonStyle())
                .disabled(!canApprove)
        }
    }

    private var actionButtons: some View {
        VStack(spacing: AppTheme.space3) {
            Button("Approve & Save", action: approve)
                .buttonStyle(FlatPrimaryButtonStyle())
                .disabled(!canApprove)

            Button("Discard Receipt", action: onDiscard)
                .buttonStyle(FlatSecondaryButtonStyle(tint: AppTheme.accent700))
        }
        .padding(.top, AppTheme.space2)
    }

    private var canApprove: Bool {
        !merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Decimal(string: total.replacingOccurrences(of: ",", with: "")) != nil
    }

    private func approve() {
        focusedField = nil
        dismissKeyboard()
        guard var invoice = pending?.invoice else { return }
        invoice.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.date = date
        invoice.receiptAmount = Decimal(string: total.replacingOccurrences(of: ",", with: ""))
        invoice.total = nil
        let selectedCurrency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.currency = selectedCurrency
        invoice.receiptCurrency = selectedCurrency
        invoice.defaultCurrency = store.defaultCurrencyCode
        invoice.conversionRate = nil
        invoice.convertedTotal = nil
        invoice.category = category.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.cardLast4 = PaymentMappingService.normalizedLast4(from: cardLast4)
        invoice.cardBank = cardBank.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        invoice.rawText = rawText
        Task {
            await onConfirm(invoice)
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

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
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
