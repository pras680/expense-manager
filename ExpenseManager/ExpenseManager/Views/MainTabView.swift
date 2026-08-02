import SwiftUI
import PhotosUI

struct MainTabView: View {
    @StateObject var store: ReceiptStore
    @State private var selectedTab: AppTab = .receipts

    enum AppTab: Hashable {
        case receipts
        case reports
        case tools
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            ReceiptsDashboardView(store: store, onShowReport: {
                selectedTab = .reports
            })
            .tabItem {
                Label("Receipts", systemImage: "doc.text.magnifyingglass")
            }
            .tag(AppTab.receipts)

            NavigationStack {
                ReportDashboardView(store: store)
            }
            .tabItem {
                Label("Report", systemImage: "chart.line.uptrend.xyaxis")
            }
            .tag(AppTab.reports)

            NavigationStack {
                ToolsView(store: store, onShowReport: {
                    selectedTab = .reports
                })
            }
            .tabItem {
                Label("Tools", systemImage: "wand.and.stars")
            }
            .tag(AppTab.tools)
        }
        .tint(AppTheme.accent)
        .task {
            await store.refreshSupabaseSession()
            await store.loadReceipts()
            store.configureGmailBackgroundSchedule()
        }
        .fullScreenCover(isPresented: $store.showScanner) {
            DocumentScanner { result in
                Task { await store.processScannerResult(result) }
            }
            .ignoresSafeArea()
        }
        .photosPicker(isPresented: $store.showPhotoPicker, selection: $store.selectedPhoto, matching: .images)
        .onChange(of: store.selectedPhoto) {
            Task { await store.importPhotoItem(store.selectedPhoto) }
        }
        .sheet(item: $store.editingInvoice) { invoice in
            ReceiptEditorView(store: store, invoice: invoice, onSave: { invoice in
                Task { await store.updateInvoice(invoice) }
            }, onCancel: {
                store.editingInvoice = nil
            })
        }
        .sheet(item: $store.pendingReceipt) { _ in
            PendingReceiptReviewView(store: store, pending: $store.pendingReceipt, onConfirm: { invoice in
                await store.confirmPendingReceipt(invoice)
            }, onDiscard: {
                store.discardPendingReceipt()
            })
        }
        .sheet(isPresented: $store.showSupabaseSignIn) {
            SupabaseSignInView(store: store)
        }
    }
}

private struct ToolsView: View {
    @ObservedObject var store: ReceiptStore
    let onShowReport: () -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                VStack(alignment: .leading, spacing: AppTheme.space1) {
                    Text("Tools")
                        .font(AppFont.largeTitle)
                        .foregroundStyle(AppTheme.text)
                    Text("Scanning, imports, currency, and account settings.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                }
                RuleLine()

                SectionLabel(text: "Default Currency")
                RuledStack {
                    RuledRow {
                        VStack(alignment: .leading, spacing: AppTheme.space2) {
                            Picker("Default currency", selection: Binding(
                                get: { store.defaultCurrencyCode },
                                set: { store.setDefaultCurrency($0) }
                            )) {
                                ForEach(Invoice.commonCurrencies, id: \.self) { currency in
                                    Text(currency).tag(currency)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(AppTheme.accent700)
                            Text("Non-default receipt currencies are converted using the receipt date and stored with the exchange rate.")
                                .font(AppFont.subhead)
                                .foregroundStyle(AppTheme.textMuted)
                        }
                        .padding(.vertical, AppTheme.space3)
                        .padding(.horizontal, AppTheme.space3)
                    }
                }

                SectionLabel(text: "Import Receipts")
                RuledStack {
                    RuledRow {
                        toolRow(title: "Scan with Camera", icon: "camera.viewfinder") {
                            store.showScanner = true
                        }
                    }
                    RuledRow {
                        toolRow(title: "Import from Photos", icon: "photo.on.rectangle") {
                            store.showPhotoPicker = true
                        }
                    }
                    RuledRow {
                        toolRow(title: "Run Sample OCR Trial", icon: "doc.text.viewfinder") {
                            Task { await store.runSampleReceiptTrial() }
                        }
                    }
                    RuledRow {
                        toolRow(title: store.gmailAgentTitle, subtitle: store.gmailAgentSubtitle, icon: "envelope.badge") {
                            store.toggleGmailAgent()
                        }
                    }
                    RuledRow { dailyAgentRow }
                }

                SectionLabel(text: "Account")
                RuledStack {
                    RuledRow {
                        toolRow(title: store.supabaseAuthTitle, subtitle: store.supabaseAuthSubtitle, icon: store.supabaseSession == nil ? "lock" : "person.crop.circle.badge.checkmark") {
                            if store.supabaseSession == nil {
                                store.showSupabaseSignIn = true
                            } else {
                                Task { await store.signOutFromSupabase() }
                            }
                        }
                    }
                    RuledRow {
                        toolRow(title: "Reload Supabase Receipts", icon: "arrow.clockwise") {
                            Task { await store.loadReceipts() }
                        }
                    }
                    RuledRow {
                        toolRow(title: "View Spending Report", icon: "chart.xyaxis.line", action: onShowReport)
                    }
                }

                SectionLabel(text: "Backend Checklist")
                RuledStack {
                    RuledRow { checklistRow("Edge Function deployed", detail: "/functions/v1/parse-receipt") }
                    RuledRow { checklistRow("Receipts table policies", detail: "Allow anon insert/select or add app auth") }
                    RuledRow { checklistRow("Storage bucket policy", detail: "Allow uploads to receipt-documents") }
                    RuledRow { checklistRow("Google OAuth configured", detail: "iOS client ID + Gmail read-only scope") }
                }

                HStack(spacing: AppTheme.space2) {
                    if store.isProcessing {
                        ProgressView()
                    }
                    Text(store.statusMessage ?? "Ready")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                }
                .padding(.top, AppTheme.space1)
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var dailyAgentRow: some View {
        Toggle(isOn: Binding(
            get: { store.gmailDailyAgentEnabled },
            set: { store.setGmailDailyAgentEnabled($0) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Daily Gmail + Telegram Agent")
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                Text(store.gmailScheduleSubtitle)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
        .tint(AppTheme.accent)
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
    }

    private func toolRow(title: String, subtitle: String? = nil, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: AppTheme.space3) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.accent700)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(AppFont.headline)
                        .foregroundStyle(AppTheme.text)
                    if let subtitle {
                        Text(subtitle)
                            .font(AppFont.subhead)
                            .foregroundStyle(AppTheme.textMuted)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.neutral600)
            }
            .padding(.vertical, AppTheme.space3)
            .padding(.horizontal, AppTheme.space3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func checklistRow(_ title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: AppTheme.space3) {
            Image(systemName: "checkmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.accent700)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                Text(detail)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
            }
            Spacer()
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
    }
}
