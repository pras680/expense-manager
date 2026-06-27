import SwiftUI

struct ReceiptEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var merchant: String
    @State private var date: Date
    @State private var totalText: String
    @State private var currency: String
    @State private var rawText: String

    let invoice: Invoice
    let onSave: (Invoice) -> Void
    let onCancel: () -> Void

    init(invoice: Invoice, onSave: @escaping (Invoice) -> Void, onCancel: @escaping () -> Void) {
        self.invoice = invoice
        self.onSave = onSave
        self.onCancel = onCancel
        _merchant = State(initialValue: invoice.merchant ?? "")
        _date = State(initialValue: invoice.date ?? Date())
        _totalText = State(initialValue: invoice.total.map { NSDecimalNumber(decimal: $0).stringValue } ?? "")
        _currency = State(initialValue: invoice.currency ?? "USD")
        _rawText = State(initialValue: invoice.rawText)
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    headerCard
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
                styledTextField("Total", text: $totalText, icon: "dollarsign.circle")
                    .keyboardType(.decimalPad)
                styledTextField("USD", text: $currency, icon: "globe")
                    .frame(width: 130)
                    .textInputAutocapitalization(.characters)
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
            var updated = invoice
            updated.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
            updated.date = date
            updated.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
            updated.rawText = rawText
            updated.total = Decimal(string: totalText.replacingOccurrences(of: ",", with: "")) ?? updated.total
            onSave(updated)
            dismiss()
        } label: {
            Label("Save Changes", systemImage: "checkmark.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .tint(.blue)
        .disabled(merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || Decimal(string: totalText.replacingOccurrences(of: ",", with: "")) == nil)
    }

    private func styledTextField(_ title: String, text: Binding<String>, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(.blue)
            TextField(title, text: text)
        }
        .padding(14)
        .background(Color(.systemBackground).opacity(0.94))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
