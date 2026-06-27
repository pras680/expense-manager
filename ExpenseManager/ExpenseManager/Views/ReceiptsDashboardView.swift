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
            Color(red: 0.98, green: 0.96, blue: 0.92)
            LinearGradient(colors: [Color.orange.opacity(0.13), Color.purple.opacity(0.07), Color.blue.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .ignoresSafeArea()
    }

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Smart receipt command center")
                        .font(.system(size: 34, weight: .semibold, design: .serif))
                        .foregroundStyle(Color(red: 0.18, green: 0.13, blue: 0.09))
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Capture receipts, review extracted details, and keep spending organized with a calmer workflow.")
                        .font(.system(.subheadline, design: .rounded).weight(.medium))
                        .foregroundStyle(Color(red: 0.38, green: 0.31, blue: 0.25))
                        .lineSpacing(3)
                }
                Spacer(minLength: 14)
                Image(systemName: "receipt.fill")
                    .font(.title.weight(.semibold))
                    .foregroundStyle(Color(red: 0.53, green: 0.28, blue: 0.13))
                    .frame(width: 58, height: 58)
                    .background(Color.white.opacity(0.68))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: .brown.opacity(0.10), radius: 12, y: 7)
            }

            HStack(spacing: 8) {
                Label("OCR ready", systemImage: "text.viewfinder")
                Label("SGD default", systemImage: "dollarsign.circle")
                Label("Card mapping", systemImage: "creditcard")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color(red: 0.48, green: 0.30, blue: 0.18))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
        }
        .padding(24)
        .background(
            ZStack(alignment: .bottomTrailing) {
                LinearGradient(colors: [Color(red: 1.00, green: 0.92, blue: 0.78), Color(red: 0.94, green: 0.83, blue: 0.70), Color(red: 0.88, green: 0.81, blue: 0.96)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle()
                    .fill(Color.white.opacity(0.35))
                    .frame(width: 190, height: 190)
                    .offset(x: 74, y: 82)
                Circle()
                    .stroke(Color.white.opacity(0.42), lineWidth: 1)
                    .frame(width: 120, height: 120)
                    .offset(x: -210, y: -54)
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(Color.white.opacity(0.54), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .shadow(color: .brown.opacity(0.14), radius: 24, x: 0, y: 14)
    }

    private var statusBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: store.isProcessing ? "hourglass" : "checkmark.seal.fill")
                .font(.headline)
                .foregroundStyle(store.isProcessing ? Color(red: 0.74, green: 0.42, blue: 0.18) : Color(red: 0.28, green: 0.54, blue: 0.38))
            if store.isProcessing {
                ProgressView()
                    .controlSize(.small)
            }
            Text(store.statusMessage ?? "Ready to scan, import, review, and save receipts.")
                .font(.system(.subheadline, design: .rounded).weight(.medium))
                .foregroundStyle(Color(red: 0.39, green: 0.33, blue: 0.28))
                .lineLimit(2)
            Spacer()
        }
        .padding(15)
        .background(Color(.systemBackground).opacity(0.74))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.62), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var actionRail: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
            actionTile(title: "Scan", subtitle: "Open camera", icon: "camera.viewfinder", tint: Color(red: 0.28, green: 0.54, blue: 0.38)) {
                store.showScanner = true
            }
            actionTile(title: "Import", subtitle: "Choose image", icon: "photo.on.rectangle.angled", tint: Color(red: 0.24, green: 0.43, blue: 0.68)) {
                store.showPhotoPicker = true
            }
            actionTile(title: "Report", subtitle: "View insights", icon: "chart.line.uptrend.xyaxis", tint: Color(red: 0.48, green: 0.35, blue: 0.70)) {
                onShowReport()
            }
            actionTile(title: "Manage", subtitle: "Edit latest", icon: "square.and.pencil", tint: Color(red: 0.72, green: 0.39, blue: 0.20)) {
                if let first = store.recentInvoices.first {
                    store.editingInvoice = first
                } else {
                    searchFocused = true
                    store.statusMessage = "Scan or import a receipt first, then Manage opens editing."
                }
            }
        }
    }

    private func actionTile(title: String, subtitle: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(tint.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(.headline, design: .rounded).weight(.semibold))
                        .foregroundStyle(Color(red: 0.17, green: 0.13, blue: 0.10))
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 6)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(Color(.systemBackground).opacity(0.78))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(tint.opacity(0.16), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: tint.opacity(0.08), radius: 12, y: 8)
        }
        .buttonStyle(.plain)
    }

    private var metricsStrip: some View {
        HStack(spacing: 12) {
            metricPill(title: "Total", value: store.totalSpend.formatted(.currency(code: Invoice.defaultCurrency)), icon: "creditcard.fill", tint: .blue)
            metricPill(title: "Month", value: store.monthlySpend.formatted(.currency(code: Invoice.defaultCurrency)), icon: "calendar.badge.clock", tint: .purple)
            metricPill(title: "Count", value: "\(store.receiptCount)", icon: "tray.full.fill", tint: .orange)
        }
    }

    private func metricPill(title: String, value: String, icon: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(value)
                .font(.system(.headline, design: .rounded).weight(.bold))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .monospacedDigit()
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.systemBackground).opacity(0.78))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(tint.opacity(0.12), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .brown.opacity(0.05), radius: 10, y: 6)
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
            .background(Color(.systemBackground).opacity(0.78))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(0.66), lineWidth: 1)
            )
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
                                .background(store.selectedFilter == filter ? Color(red: 0.53, green: 0.28, blue: 0.13).gradient : Color(.systemBackground).opacity(0.74).gradient)
                                .foregroundStyle(store.selectedFilter == filter ? .white : Color(red: 0.24, green: 0.18, blue: 0.14))
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
        .background(Color(.systemBackground).opacity(0.72))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(Color.white.opacity(0.62), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: .brown.opacity(0.07), radius: 14, y: 10)
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
                    Label(invoice.category ?? "Miscellaneous", systemImage: "tag.fill")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Color.purple.opacity(0.12))
                        .foregroundStyle(.purple)
                        .clipShape(Capsule())
                    if let cardLabel {
                        Label(cardLabel, systemImage: "creditcard.fill")
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(Color.orange.opacity(0.12))
                            .foregroundStyle(.orange)
                            .clipShape(Capsule())
                    }
                }
                Spacer()
                Text(invoice.total.map { $0.formatted(.currency(code: invoice.currency ?? Invoice.defaultCurrency)) } ?? "—")
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

    private var cardLabel: String? {
        guard let last4 = invoice.cardLast4?.nilIfEmpty else { return nil }
        return "\(invoice.cardBank?.nilIfEmpty ?? "Unknown Bank") •••• \(last4)"
    }
}
