import SwiftUI

struct ReceiptsDashboardView: View {
    @ObservedObject var store: ReceiptStore
    let onShowReport: () -> Void
    @State private var activeInvoice: Invoice?
    @State private var showingDeleteConfirmation = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    heroSection
                    statusBanner
                    actionRail
                    metricsStrip
                    searchAndFilters
                    recentSection
                }
                .padding()
            }
            .background(appBackground)
            .navigationTitle("Bill Skills")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.showScanner = true
                    } label: {
                        Image(systemName: "camera.fill")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .clipShape(Circle())
                            .shadow(color: .blue.opacity(0.28), radius: 10, y: 6)
                    }
                    .accessibilityLabel("Scan receipt")
                }
            }
            .alert("Delete receipt?", isPresented: $showingDeleteConfirmation, actions: {
                Button("Delete", role: .destructive) {
                    guard let invoice = activeInvoice else { return }
                    Task { await store.deleteInvoice(invoice) }
                }
                Button("Cancel", role: .cancel) {}
            }, message: {
                Text("This action cannot be undone.")
            })
        }
    }

    private var appBackground: some View {
        ZStack {
            Color(.systemGroupedBackground)
            LinearGradient(colors: [Color.blue.opacity(0.10), Color.purple.opacity(0.08), Color.orange.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .ignoresSafeArea()
    }

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Smart receipt command center")
                        .font(.largeTitle.weight(.black))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Scan bills, verify extracted totals, and keep spending cleanly organized in Supabase.")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white.opacity(0.82))
                }
                Spacer(minLength: 14)
                Image(systemName: "receipt.fill")
                    .font(.title.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(.white.opacity(0.18))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }

            HStack(spacing: 12) {
                Button {
                    store.showScanner = true
                } label: {
                    Label("Scan now", systemImage: "viewfinder")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.white)
                .foregroundStyle(.blue)

                Button {
                    store.showPhotoPicker = true
                } label: {
                    Label("Import", systemImage: "photo")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.bordered)
                .tint(.white)
                .foregroundStyle(.white)
            }
        }
        .padding(22)
        .background(
            ZStack(alignment: .bottomTrailing) {
                LinearGradient(colors: [Color(red: 0.05, green: 0.35, blue: 0.95), Color(red: 0.52, green: 0.22, blue: 0.96), Color(red: 0.96, green: 0.40, blue: 0.46)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle()
                    .fill(.white.opacity(0.16))
                    .frame(width: 180, height: 180)
                    .offset(x: 70, y: 75)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .shadow(color: .purple.opacity(0.28), radius: 22, x: 0, y: 14)
    }

    private var statusBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: store.isProcessing ? "hourglass" : "checkmark.seal.fill")
                .font(.headline)
                .foregroundStyle(store.isProcessing ? .orange : .green)
            if store.isProcessing {
                ProgressView()
                    .controlSize(.small)
            }
            Text(store.statusMessage ?? "Ready to scan, import, review, and save receipts.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer()
        }
        .padding(14)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var actionRail: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
            actionTile(title: "Scan", subtitle: "Open camera", icon: "camera.viewfinder", colors: [.green, .mint]) {
                store.showScanner = true
            }
            actionTile(title: "Import", subtitle: "Choose image", icon: "photo.on.rectangle.angled", colors: [.blue, .cyan]) {
                store.showPhotoPicker = true
            }
            actionTile(title: "Report", subtitle: "View insights", icon: "chart.line.uptrend.xyaxis", colors: [.purple, .indigo]) {
                onShowReport()
            }
            actionTile(title: "Manage", subtitle: "Edit latest", icon: "square.and.pencil", colors: [.orange, .pink]) {
                if let first = store.recentInvoices.first {
                    store.editingInvoice = first
                } else {
                    searchFocused = true
                    store.statusMessage = "Scan or import a receipt first, then Manage opens editing."
                }
            }
        }
    }

    private func actionTile(title: String, subtitle: String, icon: String, colors: [Color], action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 11) {
                Image(systemName: icon)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(.white.opacity(0.18))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .opacity(0.86)
                }
                .foregroundStyle(.white)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .shadow(color: colors.first?.opacity(0.18) ?? .clear, radius: 12, y: 8)
        }
        .buttonStyle(.plain)
    }

    private var metricsStrip: some View {
        HStack(spacing: 12) {
            metricPill(title: "Total", value: store.totalSpend.formatted(.currency(code: "USD")), icon: "creditcard.fill", tint: .blue)
            metricPill(title: "Month", value: store.monthlySpend.formatted(.currency(code: "USD")), icon: "calendar.badge.clock", tint: .purple)
            metricPill(title: "Count", value: "\(store.receiptCount)", icon: "tray.full.fill", tint: .orange)
        }
    }

    private func metricPill(title: String, value: String, icon: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(value)
                .font(.headline.weight(.bold))
                .minimumScaleFactor(0.65)
                .lineLimit(1)
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.systemBackground).opacity(0.94))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 10, y: 6)
    }

    private var searchAndFilters: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search merchant, amount, or date", text: $store.searchText)
                    .focused($searchFocused)
                    .textInputAutocapitalization(.never)
                if !store.searchText.isEmpty {
                    Button {
                        store.searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .padding(14)
            .background(Color(.systemBackground).opacity(0.94))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(ReceiptStore.ReceiptFilter.allCases) { filter in
                        Button {
                            store.selectedFilter = filter
                        } label: {
                            Text(filter.rawValue)
                                .font(.caption.weight(.bold))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(store.selectedFilter == filter ? Color.blue.gradient : Color(.systemBackground).opacity(0.9).gradient)
                                .foregroundStyle(store.selectedFilter == filter ? .white : .primary)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Receipt inbox")
                        .font(.title2.weight(.bold))
                    Text("Review, edit, and delete saved receipts.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if store.pendingReceipt != nil {
                    Label("Review", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.red.opacity(0.12))
                        .foregroundStyle(.red)
                        .clipShape(Capsule())
                }
            }

            if store.filteredInvoices.isEmpty {
                emptyState
            } else {
                VStack(spacing: 12) {
                    ForEach(store.filteredInvoices) { invoice in
                        ReceiptRow(invoice: invoice,
                                   onEdit: { store.editingInvoice = invoice },
                                   onDelete: {
                                       activeInvoice = invoice
                                       showingDeleteConfirmation = true
                                   })
                    }
                }
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 14, y: 10)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.text.viewfinder")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(LinearGradient(colors: [.blue, .purple], startPoint: .top, endPoint: .bottom))
                .frame(width: 78, height: 78)
                .background(.white.opacity(0.75))
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            Text(store.searchText.isEmpty ? "No receipts yet" : "No matching receipts")
                .font(.headline)
            Text(store.searchText.isEmpty ? "Tap Scan or Import to extract receipt text, then approve the review sheet to save it." : "Try another search term or switch the filter back to All.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("Scan") { store.showScanner = true }
                    .buttonStyle(.borderedProminent)
                Button("Sample Trial") { Task { await store.runSampleReceiptTrial() } }
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding()
        .background(Color(.systemBackground).opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

private struct ReceiptRow: View {
    let invoice: Invoice
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(LinearGradient(colors: [.blue.opacity(0.18), .purple.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 48, height: 48)
                    .overlay(Text(initial).font(.headline.weight(.bold)).foregroundStyle(.blue))

                VStack(alignment: .leading, spacing: 6) {
                    Text(invoice.merchant ?? "Unknown merchant")
                        .font(.headline)
                        .lineLimit(1)
                    Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(invoice.total.map { $0.formatted(.currency(code: invoice.currency ?? "USD")) } ?? "—")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }

            HStack(spacing: 10) {
                Button(action: onEdit) {
                    Label("Edit", systemImage: "pencil")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)

                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.035), radius: 10, y: 6)
    }

    private var initial: String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }
}
