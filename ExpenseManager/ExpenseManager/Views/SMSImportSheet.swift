import SwiftUI

struct SMSImportSheet: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var smsText = ""

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    pasteCard
                    guidanceCard
                }
                .padding(18)
            }
            .background(sheetBackground)
            .navigationTitle("Scan SMS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                bottomActions
            }
        }
    }

    private var sheetBackground: some View {
        LinearGradient(
            colors: [
                Color(red: 0.97, green: 0.98, blue: 1.00),
                Color(red: 0.92, green: 0.95, blue: 1.00)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Paste bank SMS alerts", systemImage: "message.badge.waveform.fill")
                .font(.title2.weight(.bold))
                .foregroundStyle(Color(red: 0.12, green: 0.16, blue: 0.25))
            Text("iOS does not let apps read your SMS inbox directly. Paste one or more bank/payment SMS messages here, then review extracted expenses before saving.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.59, green: 0.50, blue: 0.94).opacity(0.22),
                    Color(red: 0.38, green: 0.82, blue: 0.68).opacity(0.18)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var pasteCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("SMS text")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Color(red: 0.12, green: 0.16, blue: 0.25))
                Spacer()
                Text("Separate multiple SMS with a blank line")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                    .multilineTextAlignment(.trailing)
            }

            TextEditor(text: $smsText)
                .font(.body.monospaced())
                .foregroundStyle(Color(red: 0.12, green: 0.16, blue: 0.25))
                .frame(minHeight: 230)
                .padding(12)
                .scrollContentBackground(.hidden)
                .background(Color.white.opacity(0.86))
                .onChange(of: smsText) { _, newValue in
                    if newValue.count > AppSecurity.maxSharedTextCharacters {
                        smsText = String(newValue.prefix(AppSecurity.maxSharedTextCharacters))
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color(red: 0.78, green: 0.84, blue: 0.93).opacity(0.45), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            if smsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Example: Your card ending 1234 was used at FairPrice for SGD 24.50 on 12 Jan 2026.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .background(Color.white.opacity(0.74))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var guidanceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("What gets imported", systemImage: "checkmark.seal.fill")
                .font(.headline.weight(.semibold))
                .foregroundStyle(Color(red: 0.10, green: 0.66, blue: 0.52))
            Text("The app looks for amounts, card/payment words, PayNow/PayLah transfers, merchant names, and credit card payment confirmations. Duplicates are skipped before the review queue.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white.opacity(0.68))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var bottomActions: some View {
        HStack(spacing: 12) {
            Button("Clear") {
                smsText = ""
            }
            .font(.headline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .buttonStyle(.bordered)
            .tint(Color(red: 0.20, green: 0.24, blue: 0.34))
            .disabled(smsText.isEmpty || store.isProcessing)

            Button {
                Task {
                    await store.importSMSText(smsText)
                    if store.pendingReceipt != nil {
                        dismiss()
                    }
                }
            } label: {
                if store.isProcessing {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                } else {
                    Label("Parse SMS", systemImage: "text.viewfinder")
                        .frame(maxWidth: .infinity)
                }
            }
            .font(.headline.weight(.semibold))
            .padding(.vertical, 14)
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.52, green: 0.36, blue: 0.86))
            .disabled(smsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isProcessing)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.ultraThinMaterial)
    }
}

#Preview {
    SMSImportSheet(
        store: ReceiptStore(
            supabaseService: SupabaseService(
                supabaseUrl: "https://example.supabase.co",
                supabaseAnonKey: "anon",
                edgeFunctionBaseUrl: "https://example.supabase.co"
            )
        )
    )
}
