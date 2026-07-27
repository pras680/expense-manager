import SwiftUI

struct ReceiptsDashboardView: View {
    @ObservedObject var store: ReceiptStore
    let onShowReport: () -> Void
    @State private var activeInvoice: Invoice?
    @State private var showingDeleteConfirmation = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                headerSection
                quickActionsSection
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
        }
    }

    // MARK: Header

    private var headerSection: some View {
        Section {
            VStack(spacing: AppTheme.space4) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Expense Manager")
                        .font(AppFont.largeTitle)
                        .foregroundStyle(AppTheme.text)
                    Spacer()
                    TagView(text: Invoice.defaultCurrency, style: .outline)
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
                    .foregroundStyle(AppTheme.accent)
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

    // MARK: Stats

    private var statsSection: some View {
        Section {
            VStack(spacing: 1) {
                StatCell(title: "Total Spend", value: store.totalSpend.formatted(.currency(code: Invoice.defaultCurrency)), valueSize: 30)
                HStack(spacing: 1) {
                    StatCell(title: "This Month", value: store.monthlySpend.formatted(.currency(code: Invoice.defaultCurrency)))
                    StatCell(title: "Receipts", value: "\(store.receiptCount)")
                }
            }
            .background(AppTheme.divider)
            .padding(.vertical, AppTheme.space3)
            .plainRow()
        }
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
            SectionLabel(text: "Receipts Inbox")
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
                        }
                        .plainRow()
                }
            }
        }
    }

    private func receiptRow(_ invoice: Invoice) -> some View {
        Button {
            store.editingInvoice = invoice
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

                Text(invoice.total.map { $0.formatted(.currency(code: invoice.currency ?? Invoice.defaultCurrency)) } ?? "—")
                    .font(AppFont.title2)
                    .foregroundStyle(AppTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
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
