import SwiftUI

private enum MellowPalette {
    static let backgroundBase = Color(red: 0.97, green: 0.98, blue: 1.00)
    static let warmGlow = Color(red: 1.00, green: 0.74, blue: 0.46)
    static let sageGlow = Color(red: 0.38, green: 0.82, blue: 0.68)
    static let lavenderGlow = Color(red: 0.59, green: 0.50, blue: 0.94)
    static let card = Color(red: 1.00, green: 1.00, blue: 0.98)
    static let cardSoft = Color(red: 0.91, green: 0.95, blue: 1.00)
    static let text = Color(red: 0.12, green: 0.16, blue: 0.25)
    static let secondaryText = Color(red: 0.39, green: 0.45, blue: 0.56)
    static let sage = Color(red: 0.10, green: 0.66, blue: 0.52)
    static let dustyBlue = Color(red: 0.16, green: 0.49, blue: 0.86)
    static let mauve = Color(red: 0.52, green: 0.36, blue: 0.86)
    static let clay = Color(red: 0.91, green: 0.39, blue: 0.25)
    static let cocoa = Color(red: 0.20, green: 0.24, blue: 0.34)
    static let softBorder = Color(red: 0.78, green: 0.84, blue: 0.93)
    static let accountingBackground = Color(red: 0.95, green: 0.97, blue: 0.98)
    static let accountingCard = Color(red: 1.00, green: 1.00, blue: 1.00)
    static let accountingInk = Color(red: 0.08, green: 0.13, blue: 0.20)
    static let accountingMuted = Color(red: 0.36, green: 0.43, blue: 0.52)
    static let accountingNavy = Color(red: 0.08, green: 0.24, blue: 0.40)
}

struct ReceiptsDashboardView: View {
    @ObservedObject var store: ReceiptStore
    let onShowReport: () -> Void
    @State private var activeInvoice: Invoice?
    @State private var showingDeleteConfirmation = false
    @State private var showingSMSImport = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 14) {
                    heroSection
                    actionRail
                    metricsStrip
                    statusBanner
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .background(appBackground)
            .navigationTitle("Bill Skills")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.showScanner = true
                    } label: {
                        Image(systemName: "camera.fill")
                            .font(.headline)
                            .foregroundStyle(MellowPalette.cocoa)
                            .frame(width: 38, height: 38)
                            .background(MellowPalette.card.opacity(0.92))
                            .overlay(Circle().stroke(MellowPalette.softBorder.opacity(0.34), lineWidth: 1))
                            .clipShape(Circle())
                            .shadow(color: MellowPalette.cocoa.opacity(0.08), radius: 8, y: 4)
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
            .alert(item: $store.gmailScanLog) { log in
                Alert(
                    title: Text(log.title),
                    message: Text(log.message),
                    dismissButton: .default(Text("OK")) {
                        store.dismissGmailScanLog()
                    }
                )
            }
            .sheet(isPresented: $showingSMSImport) {
                SMSImportSheet(store: store)
            }
        }
    }

    private var appBackground: some View {
        ZStack {
            MellowPalette.backgroundBase
            LinearGradient(colors: [MellowPalette.warmGlow.opacity(0.13), MellowPalette.sageGlow.opacity(0.11), MellowPalette.lavenderGlow.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .ignoresSafeArea()
    }

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: "building.columns.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(MellowPalette.cocoa)
                    .frame(width: 54, height: 54)
                    .background(MellowPalette.card.opacity(0.74))
                    .overlay(
                        RoundedRectangle(cornerRadius: 17, style: .continuous)
                            .stroke(MellowPalette.softBorder.opacity(0.30), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Bill Skills")
                        .font(.system(size: 32, weight: .bold, design: .serif))
                        .foregroundStyle(MellowPalette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("Expense & Receipt Manager")
                        .font(.system(.subheadline, design: .rounded).weight(.semibold))
                        .foregroundStyle(MellowPalette.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 8)
                Label(store.defaultCurrencyCode, systemImage: "dollarsign.circle")
                    .labelStyle(.titleAndIcon)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(MellowPalette.cocoa)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .background(MellowPalette.card.opacity(0.60))
                    .overlay(Capsule().stroke(MellowPalette.softBorder.opacity(0.30), lineWidth: 1))
                    .clipShape(Capsule())
            }

            Divider()
                .overlay(MellowPalette.softBorder.opacity(0.35))

            Text("Scan, review, and track your spending with clarity and confidence.")
                .font(.system(.subheadline, design: .rounded).weight(.medium))
                .foregroundStyle(MellowPalette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(18)
        .background(
            LinearGradient(colors: [MellowPalette.warmGlow.opacity(0.34), MellowPalette.lavenderGlow.opacity(0.30), MellowPalette.cardSoft.opacity(0.55)], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(MellowPalette.card.opacity(0.66), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: MellowPalette.cocoa.opacity(0.08), radius: 12, x: 0, y: 6)
    }

    private var statusBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: store.isProcessing ? "hourglass" : "checkmark.seal.fill")
                .font(.subheadline)
                .foregroundStyle(store.isProcessing ? MellowPalette.clay : MellowPalette.sage)
            if store.isProcessing {
                ProgressView()
                    .controlSize(.small)
                    .tint(MellowPalette.clay)
            }
            Text(store.statusMessage ?? "Ready")
                .font(.system(.caption, design: .rounded).weight(.medium))
                .foregroundStyle(MellowPalette.secondaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
            Spacer()
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(MellowPalette.card.opacity(0.70))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.24), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var actionRail: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                actionTile(title: "Scan", icon: "camera.viewfinder", tint: MellowPalette.sage) {
                    store.showScanner = true
                }
                actionTile(title: "Import", icon: "photo.on.rectangle.angled", tint: MellowPalette.dustyBlue) {
                    store.showPhotoPicker = true
                }
                actionTile(title: "Report", icon: "chart.line.uptrend.xyaxis", tint: MellowPalette.mauve) {
                    onShowReport()
                }
                actionTile(title: "Manage", icon: "square.and.pencil", tint: MellowPalette.clay) {
                    if let first = store.recentInvoices.first {
                        store.editingInvoice = first
                    } else {
                        store.statusMessage = "Scan or import a receipt first, then Manage opens editing."
                    }
                }
            }
            sourceImportControls
        }
    }

    private func actionTile(title: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.13))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(tint.opacity(0.14), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(title)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(MellowPalette.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                    .allowsTightening(true)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 5)
            .frame(maxWidth: .infinity, minHeight: 74)
            .background(
                LinearGradient(colors: [tint.opacity(0.20), MellowPalette.card.opacity(0.86)], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(tint.opacity(0.18), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: tint.opacity(0.10), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
    }

    private var sourceImportControls: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                sourceButton(
                    title: store.gmailAgentIsRunning ? "Stop Agent" : "Scan Gmail",
                    detail: store.gmailAgentIsRunning ? "Scanning now" : "Gmail only",
                    icon: store.gmailAgentIsRunning ? "stop.circle.fill" : "envelope.badge.shield.half.filled",
                    tint: store.gmailAgentIsRunning ? MellowPalette.clay : MellowPalette.dustyBlue
                ) {
                    if store.gmailAgentIsRunning {
                        store.toggleGmailAgent()
                    } else {
                        store.startManualGmailScanSinceLastCheck()
                    }
                }

                sourceButton(
                    title: "Scan SMS",
                    detail: "Paste bank alert",
                    icon: "message.badge.waveform.fill",
                    tint: MellowPalette.mauve
                ) {
                    showingSMSImport = true
                }
            }

            Toggle(isOn: Binding(
                get: { store.gmailDailyAgentEnabled },
                set: { store.setGmailDailyAgentEnabled($0) }
            )) {
                HStack(spacing: 10) {
                    Image(systemName: store.gmailDailyAgentEnabled ? "antenna.radiowaves.left.and.right.circle.fill" : "power.circle")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(store.gmailDailyAgentEnabled ? MellowPalette.sage : MellowPalette.secondaryText)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(store.gmailAgentLiveStatusTitle)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(store.gmailDailyAgentEnabled ? MellowPalette.sage : MellowPalette.text)
                        Text("Last scan: \(store.gmailLastScanInfo)")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(MellowPalette.secondaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.78)
                    }
                }
            }
            .toggleStyle(.switch)
            .tint(MellowPalette.sage)
        }
        .padding(13)
        .background(
            LinearGradient(colors: [MellowPalette.card.opacity(0.94), MellowPalette.cardSoft.opacity(0.80)], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(MellowPalette.dustyBlue.opacity(0.16), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: MellowPalette.dustyBlue.opacity(0.08), radius: 9, y: 4)
    }

    private func sourceButton(title: String, detail: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(tint.gradient)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(MellowPalette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                    Text(detail)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(MellowPalette.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(tint.opacity(0.10))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(tint.opacity(0.14), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func agentStatusPill(title: String, detail: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 24, height: 24)
                .background(tint.opacity(0.11))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(MellowPalette.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                Text(detail)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(MellowPalette.secondaryText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.78)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(MellowPalette.cardSoft.opacity(0.42))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(0.12), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var metricsStrip: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Financial Snapshot")
                .font(.title3.weight(.bold))
                .foregroundStyle(MellowPalette.text)
            metricLink(
                title: "Total Spend",
                value: store.totalSpend.formatted(.currency(code: store.defaultCurrencyCode)),
                icon: "creditcard.fill",
                tint: MellowPalette.dustyBlue,
                destinationTitle: "Total Spend",
                destinationSubtitle: "All saved receipts",
                amount: store.totalSpend,
                receipts: allReceipts,
                prominent: true
            )
            HStack(spacing: 12) {
                metricLink(
                    title: "This Month",
                    value: store.monthlySpend.formatted(.currency(code: store.defaultCurrencyCode)),
                    icon: "calendar.badge.clock",
                    tint: MellowPalette.mauve,
                    destinationTitle: "This Month",
                    destinationSubtitle: "Current calendar month receipts",
                    amount: store.monthlySpend,
                    receipts: currentMonthReceipts
                )
                metricLink(
                    title: "Receipts",
                    value: "\(store.receiptCount)",
                    icon: "tray.full.fill",
                    tint: MellowPalette.clay,
                    destinationTitle: "All Receipts",
                    destinationSubtitle: "Every saved receipt",
                    amount: store.totalSpend,
                    receipts: allReceipts
                )
            }
        }
        .padding(16)
        .background(MellowPalette.card.opacity(0.84))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.30), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func metricLink(title: String, value: String, icon: String, tint: Color, destinationTitle: String, destinationSubtitle: String, amount: Decimal, receipts: [Invoice], prominent: Bool = false) -> some View {
        NavigationLink {
            DashboardReceiptDrillDownView(
                store: store,
                title: destinationTitle,
                subtitle: destinationSubtitle,
                amount: amount,
                receipts: receipts,
                tint: tint,
                onEdit: { invoice in store.editingInvoice = invoice },
                onDelete: { invoice in
                    activeInvoice = invoice
                    showingDeleteConfirmation = true
                }
            )
        } label: {
            metricPill(title: title, value: value, icon: icon, tint: tint, prominent: prominent)
        }
        .buttonStyle(.plain)
    }

    private func metricPill(title: String, value: String, icon: String, tint: Color, prominent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: prominent ? 14 : 10) {
            HStack {
                Image(systemName: icon)
                    .font((prominent ? Font.title3 : Font.subheadline).weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: prominent ? 42 : 34, height: prominent ? 42 : 34)
                    .background(tint.gradient)
                    .clipShape(RoundedRectangle(cornerRadius: prominent ? 14 : 11, style: .continuous))
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(tint.opacity(0.85))
            }
            Text(value)
                .font(.system(size: prominent ? 34 : 25, weight: .bold, design: .rounded))
                .foregroundStyle(MellowPalette.text)
                .minimumScaleFactor(0.45)
                .lineLimit(1)
                .monospacedDigit()
            Text(title)
                .font(.system(size: prominent ? 15 : 13, weight: .semibold, design: .rounded))
                .foregroundStyle(MellowPalette.secondaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: prominent ? 154 : 126, alignment: .leading)
        .padding(prominent ? 16 : 13)
        .background(
            LinearGradient(colors: [tint.opacity(prominent ? 0.18 : 0.14), MellowPalette.accountingCard.opacity(0.98)], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .overlay(
            RoundedRectangle(cornerRadius: prominent ? 22 : 20, style: .continuous)
                .stroke(tint.opacity(0.20), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: prominent ? 22 : 20, style: .continuous))
        .shadow(color: tint.opacity(0.09), radius: 8, y: 4)
    }

    private var allReceipts: [Invoice] {
        store.invoices.sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
    }

    private var currentMonthReceipts: [Invoice] {
        store.invoices
            .filter { invoice in
                guard let date = invoice.date else { return false }
                return Calendar.current.isDate(date, equalTo: Date(), toGranularity: .month)
            }
            .sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
    }

    private var searchAndFilters: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(MellowPalette.secondaryText)
                TextField("Search merchant, amount, or date", text: $store.searchText)
                    .focused($searchFocused)
                    .textInputAutocapitalization(.never)
                    .foregroundStyle(MellowPalette.text)
                if !store.searchText.isEmpty {
                    Button {
                        store.searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(MellowPalette.secondaryText.opacity(0.7))
                    }
                }
            }
            .padding(14)
            .background(MellowPalette.card.opacity(0.70))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(MellowPalette.softBorder.opacity(0.22), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(ReceiptStore.ReceiptFilter.allCases) { filter in
                        Button {
                            store.selectedFilter = filter
                        } label: {
                            Text(filter.rawValue)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(store.selectedFilter == filter ? MellowPalette.clay.opacity(0.16).gradient : MellowPalette.card.opacity(0.68).gradient)
                                .foregroundStyle(store.selectedFilter == filter ? MellowPalette.cocoa : MellowPalette.secondaryText)
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
                    Text("Receipts Inbox")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(MellowPalette.text)
                    Text("View, edit, and delete saved receipts.")
                        .font(.caption)
                        .foregroundStyle(MellowPalette.secondaryText)
                }
                Spacer()
                if store.pendingReceipt != nil {
                    Label("Review", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(MellowPalette.clay.opacity(0.13))
                        .foregroundStyle(MellowPalette.clay)
                        .clipShape(Capsule())
                }
            }

            if store.filteredInvoices.isEmpty {
                emptyState
            } else {
                VStack(spacing: 12) {
                    ForEach(store.filteredInvoices) { invoice in
                        ReceiptRow(invoice: invoice,
                                   defaultCurrencyCode: store.defaultCurrencyCode,
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
        .background(MellowPalette.card.opacity(0.66))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.20), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: MellowPalette.cocoa.opacity(0.045), radius: 11, y: 7)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.text.viewfinder")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(MellowPalette.dustyBlue)
                .frame(width: 78, height: 78)
                .background(MellowPalette.dustyBlue.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            Text(store.searchText.isEmpty ? "No receipts yet" : "No matching receipts")
                .font(.headline.weight(.semibold))
                .foregroundStyle(MellowPalette.text)
            Text(store.searchText.isEmpty ? "Tap Scan or Import to extract receipt text, then approve the review sheet to save it." : "Try another search term or switch the filter back to All.")
                .font(.subheadline)
                .foregroundStyle(MellowPalette.secondaryText)
                .multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("Scan") { store.showScanner = true }
                    .buttonStyle(.borderedProminent)
                    .tint(MellowPalette.sage)
                Button("Sample Trial") { Task { await store.runSampleReceiptTrial() } }
                    .buttonStyle(.bordered)
                    .tint(MellowPalette.cocoa)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding()
        .background(MellowPalette.card.opacity(0.66))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

private struct DashboardReceiptDrillDownView: View {
    @ObservedObject var store: ReceiptStore
    let title: String
    let subtitle: String
    let amount: Decimal
    let receipts: [Invoice]
    let tint: Color
    let onEdit: (Invoice) -> Void
    let onDelete: (Invoice) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                header
                if receipts.isEmpty {
                    emptyState
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(receipts) { invoice in
                            NavigationLink {
                                DashboardReceiptDetailView(
                                    invoice: invoice,
                                    defaultCurrencyCode: store.defaultCurrencyCode,
                                    tint: tint,
                                    onEdit: { onEdit(invoice) },
                                    onDelete: { onDelete(invoice) }
                                )
                            } label: {
                                DashboardDrillDownReceiptRow(invoice: invoice, defaultCurrencyCode: store.defaultCurrencyCode, tint: tint)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding()
        }
        .background(MellowPalette.accountingBackground.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title2.weight(.bold))
                .foregroundStyle(MellowPalette.accountingInk)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(MellowPalette.accountingMuted)
            HStack(spacing: 12) {
                Label("\(receipts.count) receipt\(receipts.count == 1 ? "" : "s")", systemImage: "tray.full.fill")
                Spacer()
                Text(amount.formatted(.currency(code: store.defaultCurrencyCode)))
                    .font(.title3.weight(.bold))
                    .monospacedDigit()
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(MellowPalette.accountingNavy)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(MellowPalette.accountingCard)
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.52), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var emptyState: some View {
        Text("No receipts found for this metric.")
            .font(.subheadline)
            .foregroundStyle(MellowPalette.accountingMuted)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MellowPalette.accountingCard)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct DashboardDrillDownReceiptRow: View {
    let invoice: Invoice
    let defaultCurrencyCode: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(tint.opacity(0.14))
                .frame(width: 44, height: 44)
                .overlay(Text(initial).font(.headline.weight(.semibold)).foregroundStyle(tint))

            VStack(alignment: .leading, spacing: 6) {
                Text(invoice.merchant ?? "Unknown merchant")
                    .font(.headline)
                    .foregroundStyle(MellowPalette.accountingInk)
                    .lineLimit(1)
                Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date")
                    .font(.caption)
                    .foregroundStyle(MellowPalette.accountingMuted)
                HStack(spacing: 8) {
                    Label(invoice.category ?? "Miscellaneous", systemImage: "tag.fill")
                    if let cardLabel {
                        Label(cardLabel, systemImage: "creditcard.fill")
                    }
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(MellowPalette.accountingMuted)
                .lineLimit(1)
            }

            Spacer(minLength: 10)

            VStack(alignment: .trailing, spacing: 4) {
                Text(invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD pending")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(MellowPalette.accountingNavy)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .monospacedDigit()
                if let original = invoice.displayReceiptAmount {
                    Text("Receipt: \(original.formatted(.currency(code: invoice.displayReceiptCurrency)))")
                        .font(.caption2)
                        .foregroundStyle(MellowPalette.accountingMuted)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(MellowPalette.accountingMuted)
            }
        }
        .padding()
        .background(MellowPalette.accountingCard)
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.40), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var initial: String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }

    private var cardLabel: String? {
        guard let last4 = invoice.cardLast4?.nilIfEmpty else { return nil }
        return "\(invoice.cardBank?.nilIfEmpty ?? "Unknown Bank") •••• \(last4)"
    }
}

private struct DashboardReceiptDetailView: View {
    let invoice: Invoice
    let defaultCurrencyCode: String
    let tint: Color
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                detailHeader
                actionButtons
                detailSection("Receipt", rows: receiptRows)
                detailSection("Currency", rows: currencyRows)
                detailSection("Payment", rows: paymentRows)
                if !invoice.rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    rawTextSection
                }
                actionButtons
            }
            .padding()
        }
        .background(MellowPalette.accountingBackground.ignoresSafeArea())
        .navigationTitle(invoice.merchant ?? "Receipt")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: onEdit) {
                    Label("Edit", systemImage: "pencil")
                }
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Circle()
                    .fill(tint.opacity(0.16))
                    .frame(width: 52, height: 52)
                    .overlay(Text(initial).font(.title3.weight(.bold)).foregroundStyle(tint))
                VStack(alignment: .leading, spacing: 4) {
                    Text(invoice.merchant ?? "Unknown merchant")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(MellowPalette.accountingInk)
                    Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .full, timeStyle: .none) } ?? "No date")
                        .font(.subheadline)
                        .foregroundStyle(MellowPalette.accountingMuted)
                }
            }
            Text(invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD conversion pending")
                .font(.largeTitle.weight(.black))
                .foregroundStyle(MellowPalette.accountingNavy)
                .monospacedDigit()
            if let original = invoice.displayReceiptAmount {
                Text("Receipt amount: \(original.formatted(.currency(code: invoice.displayReceiptCurrency)))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MellowPalette.accountingMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(MellowPalette.accountingCard)
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.50), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var receiptRows: [(String, String)] {
        [
            ("Merchant", invoice.merchant ?? "Unknown"),
            ("Date", invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date"),
            ("Category", invoice.category ?? "Miscellaneous"),
            ("File URL", invoice.fileUrl?.nilIfEmpty ?? "Not saved")
        ]
    }

    private var currencyRows: [(String, String)] {
        [
            ("Total Amount", invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD conversion pending"),
            ("Receipt Amount", invoice.displayReceiptAmount.map { $0.formatted(.currency(code: invoice.displayReceiptCurrency)) } ?? "—"),
            ("Receipt Currency", invoice.displayReceiptCurrency),
            ("Conversion Rate", invoice.conversionRate?.description ?? "Not stored")
        ]
    }

    private var paymentRows: [(String, String)] {
        [
            ("Bank", invoice.cardBank?.nilIfEmpty ?? "Unknown Bank"),
            ("Card", invoice.cardLast4?.nilIfEmpty.map { "•••• \($0)" } ?? "Unknown"),
            ("Receipt ID", invoice.id.uuidString)
        ]
    }

    private func detailSection(_ title: String, rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundStyle(MellowPalette.accountingInk)
            ForEach(rows, id: \.0) { label, value in
                HStack(alignment: .top, spacing: 12) {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(MellowPalette.accountingMuted)
                        .frame(width: 120, alignment: .leading)
                    Text(value)
                        .font(.subheadline)
                        .foregroundStyle(MellowPalette.accountingInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
        }
        .padding()
        .background(MellowPalette.accountingCard)
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.42), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var rawTextSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Raw OCR Text")
                .font(.headline)
                .foregroundStyle(MellowPalette.accountingInk)
            Text(invoice.rawText)
                .font(.caption.monospaced())
                .foregroundStyle(MellowPalette.accountingMuted)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(MellowPalette.accountingCard)
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(MellowPalette.softBorder.opacity(0.42), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var actionButtons: some View {
        HStack(spacing: 12) {
            Button(action: onEdit) {
                Label("Edit", systemImage: "pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(tint)

            Button(role: .destructive, action: onDelete) {
                Label("Delete", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .font(.subheadline.weight(.semibold))
    }

    private var initial: String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }
}

private struct ReceiptRow: View {
    let invoice: Invoice
    let defaultCurrencyCode: String
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(LinearGradient(colors: [MellowPalette.dustyBlue.opacity(0.14), MellowPalette.mauve.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 48, height: 48)
                    .overlay(Text(initial).font(.headline.weight(.semibold)).foregroundStyle(MellowPalette.dustyBlue))

                VStack(alignment: .leading, spacing: 6) {
                    Text(invoice.merchant ?? "Unknown merchant")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(MellowPalette.text)
                        .lineLimit(1)
                    Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date")
                        .font(.caption)
                        .foregroundStyle(MellowPalette.secondaryText)
                    Label(invoice.category ?? "Miscellaneous", systemImage: "tag.fill")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(MellowPalette.mauve.opacity(0.11))
                        .foregroundStyle(MellowPalette.mauve)
                        .clipShape(Capsule())
                    if let cardLabel {
                        Label(cardLabel, systemImage: "creditcard.fill")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(MellowPalette.clay.opacity(0.11))
                            .foregroundStyle(MellowPalette.clay)
                            .clipShape(Capsule())
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD pending")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(MellowPalette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    if let original = invoice.displayReceiptAmount {
                        Text("Receipt: \(original.formatted(.currency(code: invoice.displayReceiptCurrency)))")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(MellowPalette.secondaryText)
                            .lineLimit(1)
                    }
                }
            }

            HStack(spacing: 10) {
                NavigationLink {
                    DashboardReceiptDetailView(
                        invoice: invoice,
                        defaultCurrencyCode: defaultCurrencyCode,
                        tint: MellowPalette.dustyBlue,
                        onEdit: onEdit,
                        onDelete: onDelete
                    )
                } label: {
                    Label("View", systemImage: "eye")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(MellowPalette.sage)

                Button(action: onEdit) {
                    Label("Edit", systemImage: "pencil")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(MellowPalette.dustyBlue)

                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(MellowPalette.clay)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .background(MellowPalette.card.opacity(0.82))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: MellowPalette.cocoa.opacity(0.035), radius: 8, y: 4)
    }

    private var initial: String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }

    private var cardLabel: String? {
        guard let last4 = invoice.cardLast4?.nilIfEmpty else { return nil }
        return "\(invoice.cardBank?.nilIfEmpty ?? "Unknown Bank") •••• \(last4)"
    }
}
