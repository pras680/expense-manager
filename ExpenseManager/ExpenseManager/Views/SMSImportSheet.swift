import SwiftUI

struct SMSImportSheet: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var smsText = ""
    @State private var telegramToken = ""
    @State private var showTokenField = false

    var body: some View {
        VStack(spacing: 0) {
            header
            RuleLine()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    smsInboxCard
                    telegramCard
                    pasteCard
                    guidanceCard
                }
                .padding(AppTheme.space4)
            }
            RuleLine()
            bottomActions
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .onAppear {
            store.refreshTelegramConfiguration()
            showTokenField = !store.telegramConfigured
            Task { await store.refreshSMSInboxCounts() }
        }
    }

    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.accent700)
            Spacer()
            Text("Scan SMS")
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
            Spacer()
            Color.clear.frame(width: 56, height: 1)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space6 + AppTheme.space2)
        .padding(.bottom, AppTheme.space3)
    }

    private var smsInboxCard: some View {
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            SectionLabel(text: "SMS Inbox")
            Text("Forwarded automatically from your iPhone Shortcuts automation")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)

            if store.smsInboxPendingCount != nil || store.smsInboxFailedCount != nil {
                HStack(spacing: AppTheme.space2) {
                    Text("\(store.smsInboxPendingCount ?? 0) pending")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                    if let failedCount = store.smsInboxFailedCount, failedCount > 0 {
                        Text("· \(failedCount) failed, will retry on next scan")
                            .font(AppFont.subhead)
                            .foregroundStyle(AppTheme.accent700)
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
                        .tint(AppTheme.bg)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Scan SMS Inbox")
                }
            }
            .buttonStyle(FlatPrimaryButtonStyle())
            .disabled(store.isProcessing)

            if let smsInboxFetchLog = store.smsInboxFetchLog ?? store.statusMessage {
                Text(smsInboxFetchLog)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(AppTheme.space3)
                    .background(AppTheme.bg)
                    .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
            }
        }
        .padding(AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private var telegramCard: some View {
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    SectionLabel(text: "Telegram Bot")
                    Text(store.telegramConfigured ? "Connected" : "Not connected")
                        .font(AppFont.subhead)
                        .foregroundStyle(store.telegramConfigured ? AppTheme.accent700 : AppTheme.textMuted)
                }
                Spacer()
                Button(showTokenField ? "Hide" : (store.telegramConfigured ? "Edit Token" : "Add Token")) {
                    withAnimation { showTokenField.toggle() }
                }
                .buttonStyle(FlatSecondaryButtonStyle(fullWidth: false, tint: AppTheme.accent700))
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
                        .tint(AppTheme.bg)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Fetch from Telegram")
                }
            }
            .buttonStyle(FlatPrimaryButtonStyle())
            .disabled(!store.telegramConfigured || store.isProcessing)

            if let telegramFetchLog = store.telegramFetchLog ?? store.statusMessage {
                Text(telegramFetchLog)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(AppTheme.space3)
                    .background(AppTheme.bg)
                    .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
            }

            if showTokenField {
                VStack(alignment: .leading, spacing: AppTheme.space3) {
                    FlatField(label: "Bot Token") {
                        SecureField("Bot token from @BotFather", text: $telegramToken)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                    }

                    HStack(spacing: AppTheme.space3) {
                        Button("Save Token") {
                            Task {
                                await store.saveTelegramBotToken(telegramToken)
                                telegramToken = ""
                                withAnimation { showTokenField = false }
                            }
                        }
                        .buttonStyle(FlatSecondaryButtonStyle(fullWidth: false, tint: AppTheme.accent700))
                        .disabled(telegramToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        if store.telegramConfigured {
                            Button("Remove") {
                                Task { await store.clearTelegramBotToken() }
                            }
                            .buttonStyle(FlatSecondaryButtonStyle(fullWidth: false, tint: AppTheme.accent700))
                        }
                    }

                    Text("Your token is stored securely in the device Keychain and only used to read messages relayed to your bot.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                }
            }
        }
        .padding(AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private var pasteCard: some View {
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            HStack {
                SectionLabel(text: "Or Paste SMS Text")
                Spacer()
                Text("Separate multiple SMS with a blank line")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .multilineTextAlignment(.trailing)
            }

            TextEditor(text: $smsText)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(AppTheme.text)
                .frame(minHeight: 200)
                .padding(AppTheme.space2 + 2)
                .scrollContentBackground(.hidden)
                .background(AppTheme.bg)
                .onChange(of: smsText) { _, newValue in
                    if newValue.count > AppSecurity.maxSharedTextCharacters {
                        smsText = String(newValue.prefix(AppSecurity.maxSharedTextCharacters))
                    }
                }
                .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))

            if smsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Example: Your card ending 1234 was used at FairPrice for SGD 24.50 on 12 Jan 2026.")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
        .padding(AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private var guidanceCard: some View {
        VStack(alignment: .leading, spacing: AppTheme.space2) {
            SectionLabel(text: "What Gets Imported")
            Text("The app looks for amounts, card/payment words, PayNow/PayLah transfers, ATM withdrawals, merchant names, and credit card payment confirmations. Duplicates are skipped before the review queue.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
        .padding(AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private var bottomActions: some View {
        HStack(spacing: AppTheme.space3) {
            Button("Clear") {
                smsText = ""
            }
            .buttonStyle(FlatSecondaryButtonStyle())
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
                        .tint(AppTheme.bg)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Parse SMS")
                }
            }
            .buttonStyle(FlatPrimaryButtonStyle())
            .disabled(smsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isProcessing)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space3)
        .padding(.bottom, AppTheme.space2)
        .background(AppTheme.bg)
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
