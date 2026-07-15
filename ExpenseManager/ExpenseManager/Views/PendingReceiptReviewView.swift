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
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    header
                    extractedSummary
                    topActionButtons
                    fieldsCard
                    rawTextCard
                    actionButtons
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Review Receipt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onDiscard()
                    }
                }
            }
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
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Verify extracted values", systemImage: "checkmark.seal.fill")
                .font(.largeTitle.weight(.black))
                .foregroundStyle(.white)
            Text("Confirm the fields below. Approve saves the receipt to Supabase and uploads the receipt image when available.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.82))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(LinearGradient(colors: [.indigo, .blue, .cyan], startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
        .shadow(color: .blue.opacity(0.22), radius: 18, y: 12)
    }

    private var extractedSummary: some View {
        HStack(spacing: 12) {
            summaryPill(title: "Merchant", value: merchant.isEmpty ? "Missing" : merchant, tint: .blue)
            summaryPill(title: "Receipt Amount", value: total.isEmpty ? "Missing" : "\(currency) \(total)", tint: .green)
            summaryPill(title: "Card", value: cardSummary, tint: .orange)
        }
    }

    private func summaryPill(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.systemBackground).opacity(0.94))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var topActionButtons: some View {
        HStack(spacing: 12) {
            Button(role: .destructive, action: onDiscard) {
                Label("Reject", systemImage: "xmark.circle.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.bordered)

            Button(action: approve) {
                Label("Save", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .disabled(!canApprove)
        }
        .padding(12)
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 10, y: 5)
    }

    private var fieldsCard: some View {
        VStack(spacing: 14) {
            styledTextField("Merchant", text: $merchant, icon: "storefront")

            DatePicker("Date", selection: $date, displayedComponents: .date)
                .padding(14)
                .background(Color(.systemBackground).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            HStack(spacing: 12) {
                styledTextField("Receipt Amount", text: $total, icon: "dollarsign.circle")
                    .keyboardType(.decimalPad)
                Picker("Receipt Currency", selection: $currency) {
                    ForEach(Invoice.commonCurrencies, id: \.self) { currency in
                        Text(currency).tag(currency)
                    }
                }
                .pickerStyle(.menu)
                .padding(14)
                .frame(width: 128, alignment: .leading)
                .background(Color(.systemBackground).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }

            Picker("Category", selection: $category) {
                ForEach(Invoice.expenseCategories, id: \.self) { category in
                    Text(category).tag(category)
                }
            }
            .pickerStyle(.menu)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground).opacity(0.94))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            HStack(spacing: 12) {
                menuPicker(title: "Card last 4", selection: $cardLast4, options: store.availableCardLast4Options, icon: "creditcard")
                menuPicker(title: "Card bank", selection: $cardBank, options: store.availableCardBankOptions, icon: "building.columns")
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var rawTextCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Raw OCR text", systemImage: "doc.text.magnifyingglass")
                .font(.headline)
            TextEditor(text: $rawText)
                .font(.callout.monospaced())
                .focused($focusedField, equals: .rawText)
                .frame(minHeight: 190)
                .padding(10)
                .background(Color(.systemBackground).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button(action: approve) {
                Label("Approve and Save", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .disabled(!canApprove)

            Button(role: .destructive, action: onDiscard) {
                Label("Discard Receipt", systemImage: "trash")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.bordered)
        }
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

    private func styledTextField(_ title: String, text: Binding<String>, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(.blue)
            TextField(title, text: text)
                .focused($focusedField, equals: title == "Total" ? .total : .merchant)
                .submitLabel(.done)
        }
        .padding(14)
        .background(Color(.systemBackground).opacity(0.94))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func menuPicker(title: String, selection: Binding<String>, options: [String], icon: String) -> some View {
        let allOptions = Array(Set(options + (selection.wrappedValue.nilIfEmpty.map { [$0] } ?? []))).sorted()

        return HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(.blue)
            Picker(title, selection: selection) {
                Text("Not selected").tag("")
                ForEach(allOptions, id: \.self) { option in
                    Text(option).tag(option)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(Color(.systemBackground).opacity(0.94))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
