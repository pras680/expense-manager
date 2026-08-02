import SwiftUI

struct ReceiptEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ReceiptStore
    @FocusState private var focusedField: EditorField?
    @State private var merchant: String
    @State private var date: Date
    @State private var totalText: String
    @State private var currency: String
    @State private var category: String
    @State private var cardLast4: String
    @State private var cardBank: String
    @State private var rawText: String

    private enum EditorField: Hashable {
        case merchant
        case total
        case rawText
    }

    let invoice: Invoice
    let onSave: (Invoice) -> Void
    let onCancel: () -> Void

    init(store: ReceiptStore, invoice: Invoice, onSave: @escaping (Invoice) -> Void, onCancel: @escaping () -> Void) {
        self.store = store
        self.invoice = invoice
        self.onSave = onSave
        self.onCancel = onCancel
        _merchant = State(initialValue: invoice.merchant ?? "")
        _date = State(initialValue: invoice.date ?? Date())
        _totalText = State(initialValue: invoice.displayReceiptAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? "")
        _currency = State(initialValue: invoice.displayReceiptCurrency)
        _category = State(initialValue: invoice.category ?? "Miscellaneous")
        _cardLast4 = State(initialValue: invoice.cardLast4 ?? "")
        _cardBank = State(initialValue: invoice.cardBank ?? "")
        _rawText = State(initialValue: invoice.rawText)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            RuleLine()
            ScrollView(showsIndicators: false) {
                VStack(spacing: AppTheme.space4) {
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
                            TextField("0.00", text: $totalText)
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
                }
                .padding(AppTheme.space4)
            }
        }
        .background(AppTheme.bg.ignoresSafeArea())
    }

    private var header: some View {
        HStack {
            Button("Cancel") {
                onCancel()
                dismiss()
            }
            .font(AppFont.headline)
            .foregroundStyle(AppTheme.accent700)

            Spacer()

            Text("Edit Receipt")
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)

            Spacer()

            Button("Save") {
                saveChanges()
            }
            .font(AppFont.headline)
            .foregroundStyle(AppTheme.accent700)
            .disabled(!canSave)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space6 + AppTheme.space2)
        .padding(.bottom, AppTheme.space3)
    }

    private var canSave: Bool {
        !merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Decimal(string: totalText.replacingOccurrences(of: ",", with: "")) != nil
    }

    private func saveChanges() {
        guard canSave else { return }
        focusedField = nil
        dismissKeyboard()
        var updated = invoice
        updated.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.date = date
        let selectedCurrency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.currency = selectedCurrency
        updated.receiptCurrency = selectedCurrency
        updated.defaultCurrency = store.defaultCurrencyCode
        updated.conversionRate = nil
        updated.convertedTotal = nil
        updated.category = category.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.cardLast4 = PaymentMappingService.normalizedLast4(from: cardLast4)
        updated.cardBank = cardBank.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        updated.rawText = rawText
        updated.receiptAmount = Decimal(string: totalText.replacingOccurrences(of: ",", with: "")) ?? updated.receiptAmount
        updated.total = nil
        onSave(updated)
        dismiss()
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
