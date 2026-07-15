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
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    headerCard
                    saveButton
                    detailsCard
                    rawTextCard
                    saveButton
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Edit Receipt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save Changes") {
                        saveChanges()
                    }
                    .disabled(!canSave)
                }
            }
        }
    }

    private var headerCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "square.and.pencil")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 54, height: 54)
                .background(LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                Text("Clean up receipt data")
                    .font(.title2.weight(.bold))
                Text("Adjust the extracted values before they update Supabase.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var detailsCard: some View {
        VStack(spacing: 14) {
            styledTextField("Merchant", text: $merchant, icon: "storefront")
            DatePicker("Date", selection: $date, displayedComponents: .date)
                .padding(14)
                .background(Color(.systemBackground).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            HStack(spacing: 12) {
                styledTextField("Receipt Amount", text: $totalText, icon: "dollarsign.circle")
                    .keyboardType(.decimalPad)
                Picker("Receipt Currency", selection: $currency) {
                    ForEach(Invoice.commonCurrencies, id: \.self) { currency in
                        Text(currency).tag(currency)
                    }
                }
                .pickerStyle(.menu)
                .padding(14)
                .frame(width: 130, alignment: .leading)
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
            Label("Raw OCR text", systemImage: "doc.plaintext")
                .font(.headline)
            TextEditor(text: $rawText)
                .focused($focusedField, equals: .rawText)
                .frame(minHeight: 180)
                .padding(10)
                .background(Color(.systemBackground).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var saveButton: some View {
        Button {
            saveChanges()
        } label: {
            Label("Save Changes", systemImage: "checkmark.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .tint(.blue)
        .disabled(!canSave)
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
