import SwiftUI

struct ReceiptEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ReceiptStore
    @State private var merchant: String
    @State private var date: Date
    @State private var totalText: String
    @State private var currency: String
    @State private var category: String
    @State private var cardLast4: String
    @State private var cardBank: String
    @State private var rawText: String
    @State private var showingDeleteConfirmation = false

    let invoice: Invoice
    let onSave: (Invoice) -> Void
    let onCancel: () -> Void
    let onDelete: (Invoice) -> Void

    init(store: ReceiptStore, invoice: Invoice, onSave: @escaping (Invoice) -> Void, onCancel: @escaping () -> Void, onDelete: @escaping (Invoice) -> Void) {
        self.store = store
        self.invoice = invoice
        self.onSave = onSave
        self.onCancel = onCancel
        self.onDelete = onDelete
        _merchant = State(initialValue: invoice.merchant ?? "")
        _date = State(initialValue: invoice.date ?? Date())
        _totalText = State(initialValue: invoice.total.map { NSDecimalNumber(decimal: $0).stringValue } ?? "")
        _currency = State(initialValue: invoice.currency ?? Invoice.defaultCurrency)
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
                    }
                    FlatField(label: "Date") {
                        DatePicker("", selection: $date, displayedComponents: .date)
                            .labelsHidden()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    HStack(spacing: AppTheme.space3) {
                        FlatField(label: "Amount") {
                            TextField("0.00", text: $totalText)
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
                    FlatField(label: "Raw OCR Text") {
                        TextEditor(text: $rawText)
                            .font(.system(size: 11, design: .monospaced))
                            .frame(minHeight: 110)
                            .scrollContentBackground(.hidden)
                    }
                    Button("Delete Receipt") {
                        showingDeleteConfirmation = true
                    }
                    .buttonStyle(FlatSecondaryButtonStyle(tint: AppTheme.accent700))
                }
                .padding(AppTheme.space4)
            }
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .alert("Delete receipt?", isPresented: $showingDeleteConfirmation, actions: {
            Button("Delete", role: .destructive) {
                onDelete(invoice)
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        }, message: {
            Text("This action cannot be undone.")
        })
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
                save()
            }
            .font(AppFont.headline)
            .foregroundStyle(AppTheme.accent)
            .disabled(merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || Decimal(string: totalText.replacingOccurrences(of: ",", with: "")) == nil)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space6 + AppTheme.space2)
        .padding(.bottom, AppTheme.space3)
    }

    private func save() {
        var updated = invoice
        updated.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.date = date
        updated.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.category = category.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.cardLast4 = PaymentMappingService.normalizedLast4(from: cardLast4)
        updated.cardBank = cardBank.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        updated.rawText = rawText
        updated.total = Decimal(string: totalText.replacingOccurrences(of: ",", with: "")) ?? updated.total
        onSave(updated)
        dismiss()
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
