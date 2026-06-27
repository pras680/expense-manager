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
            await store.loadReceipts()
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
