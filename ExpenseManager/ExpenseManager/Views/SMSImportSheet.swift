import SwiftUI

struct SMSImportSheet: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var smsText = ""
    @State private var telegramToken = ""
    @State private var showTokenField = false

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    smsInboxCard
                    telegramCard
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
            .onAppear {
                store.refreshTelegramConfiguration()
                showTokenField = !store.telegramConfigured
                Task { await store.refreshSMSInboxCounts() }
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
            Label("Import bank SMS alerts", systemImage: "message.badge.waveform.fill")
                .font(.title2.weight(.bold))
                .foregroundStyle(Color(red: 0.12, green: 0.16, blue: 0.25))
            Text("Fetch SMS alerts forwarded to your Telegram bot, or paste them manually. Extracted expenses are de-duplicated and queued for review before saving.")
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

    private var smsInboxCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "tray.and.arrow.down.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color(red: 0.10, green: 0.66, blue: 0.52))
                VStack(alignment: .leading, spacing: 2) {
                    Text("SMS inbox")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(Color(red: 0.12, green: 0.16, blue: 0.25))
                    Text("Forwarded automatically from your iPhone Shortcuts automation")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                }
                Spacer()
            }

            if store.smsInboxPendingCount != nil || store.smsInboxFailedCount != nil {
                HStack(spacing: 8) {
                    Text("\(store.smsInboxPendingCount ?? 0) pending")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                    if let failedCount = store.smsInboxFailedCount, failedCount > 0 {
                        Text("• \(failedCount) failed, will retry on next scan")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color(red: 0.80, green: 0.30, blue: 0.30))
                    }
                }
            }

            Button {
                store.smsInboxFetchLog = "Checking SMS inbox..."
                AppSecurity.debugLog("Scan SMS: Scan SMS inbox button tapped. processing=\(store.isProcessing)")
                Task {
                    await store.importSMSFromInbox()
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
                    Label("Scan SMS Inbox", systemImage: "arrow.down.circle.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .font(.headline.weight(.semibold))
            .padding(.vertical, 12)
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.10, green: 0.66, blue: 0.52))
            .disabled(store.isProcessing)

            if let smsInboxFetchLog = store.smsInboxFetchLog ?? store.statusMessage {
                Label(smsInboxFetchLog, systemImage: store.isProcessing ? "arrow.triangle.2.circlepath" : "info.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(red: 0.20, green: 0.24, blue: 0.34))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color.white.opacity(0.78))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .padding(16)
        .background(Color.white.opacity(0.74))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var telegramCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "paperplane.circle.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color(red: 0.15, green: 0.55, blue: 0.86))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Telegram bot")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(Color(red: 0.12, green: 0.16, blue: 0.25))
                    Text(store.telegramConfigured ? "Connected" : "Not connected")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(store.telegramConfigured
                                         ? Color(red: 0.10, green: 0.66, blue: 0.52)
                                         : Color(red: 0.39, green: 0.45, blue: 0.56))
                }
                Spacer()
                Button(showTokenField ? "Hide" : (store.telegramConfigured ? "Edit token" : "Add token")) {
                    withAnimation { showTokenField.toggle() }
                }
                .font(.caption.weight(.semibold))
                .buttonStyle(.bordered)
                .tint(Color(red: 0.15, green: 0.55, blue: 0.86))
            }

            Button {
                store.telegramFetchLog = "Fetch from Telegram tapped."
                AppSecurity.debugLog("Scan SMS: Fetch from Telegram button tapped. configured=\(store.telegramConfigured), processing=\(store.isProcessing)")
                Task {
                    await store.importSMSFromTelegram()
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
                    Label("Fetch from Telegram", systemImage: "arrow.down.circle.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .font(.headline.weight(.semibold))
            .padding(.vertical, 12)
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.15, green: 0.55, blue: 0.86))
            .disabled(!store.telegramConfigured || store.isProcessing)

            if let telegramFetchLog = store.telegramFetchLog ?? store.statusMessage {
                Label(telegramFetchLog, systemImage: store.isProcessing ? "arrow.triangle.2.circlepath" : "info.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(red: 0.20, green: 0.24, blue: 0.34))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color.white.opacity(0.78))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            if showTokenField {
                VStack(alignment: .leading, spacing: 10) {
                    SecureField("Bot token from @BotFather", text: $telegramToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .padding(12)
                        .background(Color.white.opacity(0.86))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color(red: 0.78, green: 0.84, blue: 0.93).opacity(0.6), lineWidth: 1)
                        )

                    HStack(spacing: 12) {
                        Button("Save token") {
                            Task {
                                await store.saveTelegramBotToken(telegramToken)
                                telegramToken = ""
                                withAnimation { showTokenField = false }
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.15, green: 0.55, blue: 0.86))
                        .disabled(telegramToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        if store.telegramConfigured {
                            Button("Remove") {
                                Task { await store.clearTelegramBotToken() }
                            }
                            .font(.subheadline.weight(.semibold))
                            .buttonStyle(.bordered)
                            .tint(Color(red: 0.80, green: 0.30, blue: 0.30))
                        }
                    }

                    Text("Your token is stored securely in the device Keychain and only used to read messages relayed to your bot.")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color(red: 0.39, green: 0.45, blue: 0.56))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16)
        .background(Color.white.opacity(0.74))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var pasteCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Or paste SMS text")
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
