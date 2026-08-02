import SwiftUI

struct ReceiptsDashboardView: View {
    @ObservedObject var store: ReceiptStore
    let onShowReport: () -> Void
    @State private var activeInvoice: Invoice?
    @State private var showingDeleteConfirmation = false
    @State private var showingSMSImport = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                headerSection
                quickActionsSection
                sourceImportSection
                statsSection
                searchAndFiltersSection
                receiptsSection
            }
            .listStyle(.plain)
            .listSectionSpacing(.compact)
            .scrollContentBackground(.hidden)
            .background(AppTheme.bg)
            .toolbar(.hidden, for: .navigationBar)
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

    // MARK: Header

    private var headerSection: some View {
        Section {
            VStack(spacing: AppTheme.space4) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Bill Skills")
                        .font(AppFont.largeTitle)
                        .foregroundStyle(AppTheme.text)
                    Spacer()
                    TagView(text: store.defaultCurrencyCode, style: .outline)
                }
                RuleLine()
            }
            .padding(.top, AppTheme.space3)
            .plainRow()
        }
    }

    // MARK: Quick actions

    private var quickActionsSection: some View {
        Section {
            HStack(spacing: 1) {
                actionCell(title: "Scan", icon: "camera.viewfinder") { store.showScanner = true }
                actionCell(title: "Import", icon: "photo.on.rectangle") { store.showPhotoPicker = true }
                actionCell(title: "Report", icon: "chart.line.uptrend.xyaxis") { onShowReport() }
                actionCell(title: "Manage", icon: "square.and.pencil", action: manage)
            }
            .background(AppTheme.divider)
            .padding(.vertical, AppTheme.space3)
            .plainRow()
        }
    }

    private func manage() {
        if let first = store.recentInvoices.first {
            store.editingInvoice = first
        } else {
            searchFocused = true
            store.statusMessage = "Scan or import a receipt first, then Manage opens editing."
        }
    }

    private func actionCell(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: AppTheme.space2) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.accent700)
                Text(title)
                    .font(AppFont.caption)
                    .foregroundStyle(AppTheme.text)
            }
            .padding(.vertical, AppTheme.space3)
            .padding(.horizontal, AppTheme.space2 + 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surface)
        }
        .buttonStyle(.plain)
    }

    // MARK: Gmail + SMS import sources

    private var sourceImportSection: some View {
        Section {
            VStack(spacing: AppTheme.space3) {
                HStack(spacing: 1) {
                    sourceCell(
                        title: store.gmailAgentIsRunning ? "Stop Agent" : "Scan Gmail",
                        detail: store.gmailAgentIsRunning ? "Scanning now" : "Gmail + Telegram",
                        icon: store.gmailAgentIsRunning ? "stop.circle" : "envelope.badge"
                    ) {
                        if store.gmailAgentIsRunning {
                            store.toggleGmailAgent()
                        } else {
                            store.startManualGmailScanSinceLastCheck()
                        }
                    }
                    sourceCell(title: "Scan SMS", detail: "Paste bank alert", icon: "message.badge") {
                        showingSMSImport = true
                    }
                }
                .background(AppTheme.divider)

                dailyAgentRow
            }
            .padding(.vertical, AppTheme.space2)
            .plainRow()
        }
    }

    private func sourceCell(title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: AppTheme.space2 + 2) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.accent700)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(AppFont.headline)
                        .foregroundStyle(AppTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(detail)
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, AppTheme.space3)
            .padding(.horizontal, AppTheme.space3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surface)
        }
        .buttonStyle(.plain)
    }

    private var dailyAgentRow: some View {
        Toggle(isOn: Binding(
            get: { store.gmailDailyAgentEnabled },
            set: { store.setGmailDailyAgentEnabled($0) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.gmailAgentLiveStatusTitle)
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                Text("Last scan: \(store.gmailLastScanInfo)")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .tint(AppTheme.accent)
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    // MARK: Stats

    private var statsSection: some View {
        Section {
            VStack(spacing: 1) {
                statLink(title: "Total Spend", value: store.totalSpend.formatted(.currency(code: store.defaultCurrencyCode)), valueSize: 30) {
                    DashboardReceiptDrillDownView(
                        store: store,
                        title: "Total Spend",
                        subtitle: "All saved receipts",
                        amount: store.totalSpend,
                        receipts: allReceipts,
                        onEdit: { invoice in store.editingInvoice = invoice },
                        onDelete: { invoice in
                            activeInvoice = invoice
                            showingDeleteConfirmation = true
                        }
                    )
                }
                HStack(spacing: 1) {
                    statLink(title: "This Month", value: store.monthlySpend.formatted(.currency(code: store.defaultCurrencyCode))) {
                        DashboardReceiptDrillDownView(
                            store: store,
                            title: "This Month",
                            subtitle: "Current calendar month receipts",
                            amount: store.monthlySpend,
                            receipts: currentMonthReceipts,
                            onEdit: { invoice in store.editingInvoice = invoice },
                            onDelete: { invoice in
                                activeInvoice = invoice
                                showingDeleteConfirmation = true
                            }
                        )
                    }
                    statLink(title: "Receipts", value: "\(store.receiptCount)") {
                        DashboardReceiptDrillDownView(
                            store: store,
                            title: "All Receipts",
                            subtitle: "Every saved receipt",
                            amount: store.totalSpend,
                            receipts: allReceipts,
                            onEdit: { invoice in store.editingInvoice = invoice },
                            onDelete: { invoice in
                                activeInvoice = invoice
                                showingDeleteConfirmation = true
                            }
                        )
                    }
                }
            }
            .background(AppTheme.divider)
            .padding(.vertical, AppTheme.space3)
            .plainRow()
        }
    }

    private func statLink<Destination: View>(title: String, value: String, valueSize: CGFloat = 18, @ViewBuilder destination: () -> Destination) -> some View {
        NavigationLink {
            destination()
        } label: {
            ZStack(alignment: .topTrailing) {
                StatCell(title: title, value: value, valueSize: valueSize)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(AppTheme.neutral600)
                    .padding(AppTheme.space2)
            }
        }
        .buttonStyle(.plain)
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

    // MARK: Search + filters

    private var searchAndFiltersSection: some View {
        Section {
            VStack(alignment: .leading, spacing: AppTheme.space3) {
                HStack(spacing: AppTheme.space2) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(AppTheme.neutral700)
                    TextField("Search merchant, amount, or date", text: $store.searchText)
                        .focused($searchFocused)
                        .font(AppFont.body15)
                        .textInputAutocapitalization(.never)
                    if !store.searchText.isEmpty {
                        Button {
                            store.searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(AppTheme.neutral600)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, AppTheme.space3)
                .padding(.vertical, AppTheme.space2 + 2)
                .background(AppTheme.surface)
                .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: AppTheme.space2) {
                        ForEach(ReceiptStore.ReceiptFilter.allCases) { filter in
                            Button {
                                store.selectedFilter = filter
                            } label: {
                                TagView(text: filter.rawValue, style: store.selectedFilter == filter ? .solid : .outline)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.vertical, AppTheme.space2)
            .plainRow()
        }
    }

    // MARK: Receipts inbox

    private var receiptsSection: some View {
        Section {
            HStack {
                SectionLabel(text: "Receipts Inbox")
                Spacer()
                if store.pendingReceipt != nil {
                    TagView(text: "Review", style: .solid)
                }
            }
            .padding(.top, AppTheme.space2)
            .padding(.bottom, AppTheme.space1)
            .plainRow()

            if store.filteredInvoices.isEmpty {
                emptyState
                    .plainRow()
            } else {
                ForEach(store.filteredInvoices) { invoice in
                    receiptRow(invoice)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                activeInvoice = invoice
                                showingDeleteConfirmation = true
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                store.editingInvoice = invoice
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            .tint(AppTheme.accent700)
                        }
                        .plainRow()
                }
            }
        }
    }

    private func receiptRow(_ invoice: Invoice) -> some View {
        NavigationLink {
            DashboardReceiptDetailView(
                invoice: invoice,
                defaultCurrencyCode: store.defaultCurrencyCode,
                onEdit: { store.editingInvoice = invoice },
                onDelete: {
                    activeInvoice = invoice
                    showingDeleteConfirmation = true
                }
            )
        } label: {
            HStack(spacing: AppTheme.space3) {
                Text(initial(for: invoice))
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                    .frame(width: 38, height: 38)
                    .background(AppTheme.surface)
                    .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))

                VStack(alignment: .leading, spacing: 2) {
                    Text(invoice.merchant ?? "Unknown merchant")
                        .font(AppFont.headline)
                        .foregroundStyle(AppTheme.text)
                        .lineLimit(1)
                    Text(rowSubtitle(for: invoice))
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                }

                Spacer(minLength: AppTheme.space2)

                VStack(alignment: .trailing, spacing: 2) {
                    Text(invoice.reportingTotal(defaultCurrencyCode: store.defaultCurrencyCode).map { $0.formatted(.currency(code: store.defaultCurrencyCode)) } ?? "Pending")
                        .font(AppFont.title2)
                        .foregroundStyle(AppTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    if let original = invoice.displayReceiptAmount {
                        Text(original.formatted(.currency(code: invoice.displayReceiptCurrency)))
                            .font(AppFont.caption)
                            .foregroundStyle(AppTheme.textMuted)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.vertical, AppTheme.space3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surface)
            .overlay(alignment: .bottom) { RuleLine().opacity(0.5) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func initial(for invoice: Invoice) -> String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }

    private func rowSubtitle(for invoice: Invoice) -> String {
        let dateLabel = invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date"
        let category = invoice.category?.nilIfEmpty ?? "Miscellaneous"
        return "\(dateLabel) · \(category)"
    }

    private var emptyState: some View {
        VStack(spacing: AppTheme.space3) {
            Text(store.searchText.isEmpty ? "No receipts yet" : "No matching receipts")
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.text)
            Text(store.searchText.isEmpty ? "Tap Scan or Import to extract receipt text, then approve the review sheet to save it." : "Try another search term or switch the filter back to All.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
                .multilineTextAlignment(.center)
            HStack(spacing: AppTheme.space3) {
                Button("Scan") { store.showScanner = true }
                    .buttonStyle(FlatPrimaryButtonStyle(fullWidth: false))
                Button("Sample Trial") { Task { await store.runSampleReceiptTrial() } }
                    .buttonStyle(FlatSecondaryButtonStyle(fullWidth: false))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AppTheme.space6)
        .padding(.horizontal, AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }
}

// MARK: - Drill-down (Total Spend / This Month / Receipts)

private struct DashboardReceiptDrillDownView: View {
    @ObservedObject var store: ReceiptStore
    let title: String
    let subtitle: String
    let amount: Decimal
    let receipts: [Invoice]
    let onEdit: (Invoice) -> Void
    let onDelete: (Invoice) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                BackLink(title: "Back") { dismiss() }
                VStack(alignment: .leading, spacing: AppTheme.space1) {
                    Text(title)
                        .font(AppFont.title)
                        .foregroundStyle(AppTheme.text)
                    Text(subtitle)
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                }

                HStack(spacing: 1) {
                    StatCell(title: "Receipts", value: "\(receipts.count)", valueSize: 15)
                    StatCell(title: "Amount", value: amount.formatted(.currency(code: store.defaultCurrencyCode)), valueSize: 15)
                }
                .background(AppTheme.divider)

                if receipts.isEmpty {
                    Text("No receipts found for this metric.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                        .padding(AppTheme.space4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.surface)
                        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
                } else {
                    RuledStack {
                        ForEach(receipts) { invoice in
                            RuledRow {
                                NavigationLink {
                                    DashboardReceiptDetailView(
                                        invoice: invoice,
                                        defaultCurrencyCode: store.defaultCurrencyCode,
                                        onEdit: { onEdit(invoice) },
                                        onDelete: { onDelete(invoice) }
                                    )
                                } label: {
                                    drillDownRow(invoice)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private func drillDownRow(_ invoice: Invoice) -> some View {
        HStack(spacing: AppTheme.space3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(invoice.merchant ?? "Unknown merchant")
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                    .lineLimit(1)
                Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: AppTheme.space2)
            Text(invoice.reportingTotal(defaultCurrencyCode: store.defaultCurrencyCode).map { $0.formatted(.currency(code: store.defaultCurrencyCode)) } ?? "Pending")
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.neutral600)
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
        .contentShape(Rectangle())
    }
}

// MARK: - Receipt detail (full page: View / Edit / Delete)

private struct DashboardReceiptDetailView: View {
    let invoice: Invoice
    let defaultCurrencyCode: String
    let onEdit: () -> Void
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                HStack {
                    BackLink(title: "Back") { dismiss() }
                    Spacer()
                    Button("Edit", action: onEdit)
                        .font(AppFont.headline)
                        .foregroundStyle(AppTheme.accent700)
                    Button(role: .destructive, action: onDelete) {
                        Text("Delete")
                    }
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.accent700)
                }

                detailHeader

                detailSection("Receipt", rows: receiptRows)
                detailSection("Currency", rows: currencyRows)
                detailSection("Payment", rows: paymentRows)
                if !invoice.rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    rawTextSection
                }
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: AppTheme.space2) {
            Text(invoice.merchant ?? "Unknown merchant")
                .font(AppFont.title)
                .foregroundStyle(AppTheme.text)
            Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .full, timeStyle: .none) } ?? "No date")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
            Text(invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "Conversion pending")
                .font(AppFont.heading(30))
                .foregroundStyle(AppTheme.text)
            if let original = invoice.displayReceiptAmount {
                Text("Receipt amount: \(original.formatted(.currency(code: invoice.displayReceiptCurrency)))")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
            }
            RuleLine()
        }
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
            ("Total Amount", invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "Conversion pending"),
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
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            SectionLabel(text: title)
            RuledStack {
                ForEach(rows, id: \.0) { label, value in
                    RuledRow {
                        HStack(alignment: .top, spacing: AppTheme.space3) {
                            Text(label)
                                .font(AppFont.subhead)
                                .foregroundStyle(AppTheme.textMuted)
                                .frame(width: 110, alignment: .leading)
                            Text(value)
                                .font(AppFont.body15)
                                .foregroundStyle(AppTheme.text)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, AppTheme.space3)
                        .padding(.horizontal, AppTheme.space3)
                    }
                }
            }
        }
    }

    private var rawTextSection: some View {
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            SectionLabel(text: "Raw OCR Text")
            Text(invoice.rawText)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(AppTheme.textMuted)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(AppTheme.space3)
                .background(AppTheme.surface)
                .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
        }
    }
}
