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
        .tint(Color(red: 0.16, green: 0.36, blue: 0.92))
        .task {
            await store.refreshSupabaseSession()
            await store.loadReceipts()
            store.configureGmailBackgroundSchedule()
            store.runGmailScanOnAppLoad()
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
            VStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Scanner Lab", systemImage: "wand.and.stars")
                        .font(.largeTitle.weight(.black))
                    Text("Test OCR, scan receipts, import from Photos, and validate your Supabase save flow from one place.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(22)
                .background(
                    LinearGradient(colors: [Color.cyan.opacity(0.26), Color.indigo.opacity(0.18), Color.pink.opacity(0.14)], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))

                if store.isProcessing || store.statusMessage != nil {
                    HStack(spacing: 12) {
                        if store.isProcessing {
                            ProgressView()
                        }
                        Text(store.statusMessage ?? "Ready")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding()
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                }

                currencySettingsCard

                VStack(spacing: 14) {
                    toolButton(title: "Scan with Camera", subtitle: "Capture a real receipt", icon: "camera.viewfinder", tint: .green) {
                        store.showScanner = true
                    }
                    toolButton(title: "Import from Photos", subtitle: "Use an existing receipt image", icon: "photo.on.rectangle.angled", tint: .blue) {
                        store.showPhotoPicker = true
                    }
                    toolButton(title: "Run Sample OCR Trial", subtitle: "Generate a sample receipt image and extract text", icon: "doc.text.viewfinder", tint: .purple) {
                        Task { await store.runSampleReceiptTrial() }
                    }
                    toolButton(title: store.gmailAgentTitle, subtitle: store.gmailAgentSubtitle, icon: "envelope.badge.shield.half.filled", tint: store.gmailAgentIsRunning ? .red : .blue) {
                        store.toggleGmailAgent()
                    }
                    Toggle(isOn: Binding(
                        get: { store.gmailDailyAgentEnabled },
                        set: { store.setGmailDailyAgentEnabled($0) }
                    )) {
                        Label("Daily Gmail Agent", systemImage: "calendar.badge.clock")
                            .font(.headline)
                        Text(store.gmailScheduleSubtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(Color(.systemBackground).opacity(0.92))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    toolButton(title: store.supabaseAuthTitle, subtitle: store.supabaseAuthSubtitle, icon: store.supabaseSession == nil ? "lock.open.display" : "person.crop.circle.badge.checkmark", tint: store.supabaseSession == nil ? .blue : .green) {
                        if store.supabaseSession == nil {
                            store.showSupabaseSignIn = true
                        } else {
                            Task { await store.signOutFromSupabase() }
                        }
                    }
                    toolButton(title: "Reload Supabase Receipts", subtitle: "Refresh saved receipt rows", icon: "arrow.clockwise.circle.fill", tint: .orange) {
                        Task { await store.loadReceipts() }
                    }
                    toolButton(title: "View Spending Report", subtitle: "Open totals, weekly trend, and insights", icon: "chart.xyaxis.line", tint: .pink) {
                        onShowReport()
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Backend checklist")
                        .font(.headline)
                    checklistRow("Edge Function deployed", detail: "/functions/v1/parse-receipt")
                    checklistRow("Receipts table policies", detail: "Allow anon insert/select or add app auth")
                    checklistRow("Storage bucket policy", detail: "Allow uploads to receipt-documents")
                    checklistRow("Google OAuth configured", detail: "iOS client ID + Gmail read-only scope")
                }
                .padding()
                .background(Color(.systemBackground).opacity(0.92))
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Tools")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var currencySettingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "dollarsign.arrow.circlepath")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(Color.teal.gradient)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Default Currency")
                        .font(.headline)
                    Text("Reports use converted \(store.defaultCurrencyCode) amounts.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Picker("Default currency", selection: Binding(
                get: { store.defaultCurrencyCode },
                set: { store.setDefaultCurrency($0) }
            )) {
                ForEach(Invoice.commonCurrencies, id: \.self) { currency in
                    Text(currency).tag(currency)
                }
            }
            .pickerStyle(.menu)

            Text("Non-default receipt currencies are converted using the receipt date and stored with the exchange rate.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func toolButton(title: String, subtitle: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 50, height: 50)
                    .background(tint.gradient)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }
            .padding()
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func checklistRow(_ title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}
