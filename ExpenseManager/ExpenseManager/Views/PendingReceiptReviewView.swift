import SwiftUI

struct PendingReceiptReviewView: View {
    @Binding var pending: ReceiptStore.PendingReceipt?
    let onConfirm: (Invoice) async -> Void
    let onDiscard: () -> Void

    @State private var merchant: String = ""
    @State private var date: Date = Date()
    @State private var total: String = ""
    @State private var currency: String = "USD"
    @State private var rawText: String = ""

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    header
                    extractedSummary
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
                total = pending.invoice.total.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""
                currency = pending.invoice.currency ?? "USD"
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
            summaryPill(title: "Total", value: total.isEmpty ? "Missing" : total, tint: .green)
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

    private var fieldsCard: some View {
        VStack(spacing: 14) {
            styledTextField("Merchant", text: $merchant, icon: "storefront")

            DatePicker("Date", selection: $date, displayedComponents: .date)
                .padding(14)
                .background(Color(.systemBackground).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            HStack(spacing: 12) {
                styledTextField("Total", text: $total, icon: "dollarsign.circle")
                    .keyboardType(.decimalPad)
                styledTextField("USD", text: $currency, icon: "globe")
                    .frame(width: 128)
                    .textInputAutocapitalization(.characters)
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
            .disabled(merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || Decimal(string: total.replacingOccurrences(of: ",", with: "")) == nil)

            Button(role: .destructive, action: onDiscard) {
                Label("Discard Receipt", systemImage: "trash")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.bordered)
        }
    }

    private func approve() {
        guard var invoice = pending?.invoice else { return }
        invoice.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.date = date
        invoice.total = Decimal(string: total.replacingOccurrences(of: ",", with: ""))
        invoice.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
        invoice.rawText = rawText
        Task {
            await onConfirm(invoice)
        }
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
