import SwiftUI

struct SMSImportSheet: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var smsText = ""

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    header
                    smsInboxCard
                    pasteCard
                    guidanceCard
                }
                .padding(AppTheme.space4)
            }
            .background(AppTheme.bg.ignoresSafeArea())
            .navigationTitle("Scan SMS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(AppTheme.accent700)
                }
            }
            .safeAreaInset(edge: .bottom) {
                bottomActions
            }
            .onAppear {
                Task { await store.refreshSMSInboxCounts() }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            Text("Import Bank SMS Alerts")
                .font(AppFont.title)
                .foregroundStyle(AppTheme.text)
            Text("Scans messages forwarded to Supabase by your iPhone Shortcuts automation, or parse SMS text pasted below. Extracted expenses are queued for review before saving.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
    }

    private var smsInboxCard: some View {
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            SectionLabel(text: "SMS Inbox")
            Text("Messages received by the receive-sms Edge Function, not yet processed")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)

            if store.smsInboxPendingCount != nil || store.smsInboxFailedCount != nil {
                HStack(spacing: AppTheme.space2) {
                    Text("\(store.smsInboxPendingCount ?? 0) pending")
                        .font(AppFont.caption)
                        .foregroundStyle(AppTheme.textMuted)
                    if let failedCount = store.smsInboxFailedCount, failedCount > 0 {
                        Text("· \(failedCount) failed, will retry")
                            .font(AppFont.caption)
                            .foregroundStyle(AppTheme.accent700)
                    }
                }
            }

            Button {
                Task {
                    await store.importSMSFromInbox()
                    if !store.pendingReceipts.isEmpty {
                        dismiss()
                    }
                }
            } label: {
                if store.isProcessing {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Scan SMS Inbox")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(FlatPrimaryButtonStyle())
            .disabled(store.isProcessing)

            if let log = store.smsInboxFetchLog {
                Text(log)
                    .font(AppFont.caption)
                    .foregroundStyle(AppTheme.textMuted)
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
                Text("Blank line between messages")
                    .font(AppFont.caption)
                    .foregroundStyle(AppTheme.textMuted)
            }

            TextEditor(text: $smsText)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(AppTheme.text)
                .frame(minHeight: 200)
                .scrollContentBackground(.hidden)
                .padding(AppTheme.space2)
                .background(AppTheme.bg)
                .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))

            if smsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Example: Your card ending 1234 was used at FairPrice for SGD 24.50 on 12 Jan 2026.")
                    .font(AppFont.caption)
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
            Text("The app looks for amounts, card/payment words, PayNow/PayLah transfers, and merchant names. OTPs and balance-only alerts are skipped automatically.")
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
                    smsText = ""
                    if !store.pendingReceipts.isEmpty {
                        dismiss()
                    }
                }
            } label: {
                if store.isProcessing {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Parse SMS")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(FlatPrimaryButtonStyle())
            .disabled(smsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isProcessing)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space3)
        .padding(.bottom, AppTheme.space2)
        .background(AppTheme.bg)
        .overlay(alignment: .top) { RuleLine() }
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
