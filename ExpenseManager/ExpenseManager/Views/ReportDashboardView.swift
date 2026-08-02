import SwiftUI

enum ReportKind: String, CaseIterable, Identifiable {
    case category = "Spend by Category"
    case card = "Spend by Card"
    case month = "Spend by Month"
    case keyword = "Search OCR Text"
    case overview = "Overview"

    var id: String { rawValue }

    func receipts(in store: ReceiptStore, matching summary: ReceiptStore.SpendSummary? = nil, dayLabel: String? = nil) -> [Invoice] {
        let calendar = Calendar.current
        let normalizedSummaryId = summary?.id.lowercased()

        let filtered = store.invoices.filter { invoice in
            switch self {
            case .overview:
                if let dayLabel {
                    guard let date = invoice.date else { return false }
                    let formatter = DateFormatter()
                    formatter.dateFormat = "E"
                    return formatter.string(from: date) == dayLabel && calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: Date())).day.map { 0...6 ~= $0 } == true
                }
                return true
            case .category:
                let category = invoice.category?.nilIfEmpty ?? "Miscellaneous"
                return category.lowercased() == normalizedSummaryId
            case .card:
                let bank = invoice.cardBank?.nilIfEmpty ?? "Unknown Bank"
                let last4 = invoice.cardLast4?.nilIfEmpty ?? "unknown"
                return "\(bank)|\(last4)".lowercased() == normalizedSummaryId
            case .month:
                guard let date = invoice.date else {
                    return normalizedSummaryId == "unknown"
                }
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM"
                return formatter.string(from: date).lowercased() == normalizedSummaryId
            case .keyword:
                return true
            }
        }

        return filtered.sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
    }

    var subtitle: String {
        switch self {
        case .category:
            return "Compare groceries, food, fuel, entertainment, and other expense groups."
        case .card:
            return "See spend by bank credit card and last 4 digits."
        case .month:
            return "Review month-by-month totals and receipt volume."
        case .keyword:
            return "Search raw OCR text with an optional from date, then review monthly stats."
        case .overview:
            return "View total spend, this month, receipts, and weekly trend."
        }
    }
}

/// A flush-left, chevron-trailing ruled row: title/subtitle on the left, a bold amount and
/// chevron on the right. Shared by every report drill-down level.
private struct GroupRow: View {
    let title: String
    let subtitle: String
    let amount: String

    var body: some View {
        HStack(spacing: AppTheme.space3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(subtitle)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: AppTheme.space2)
            Text(amount)
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.neutral600)
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
        .contentShape(Rectangle())
    }
}

/// Back link + flush title/subtitle, reused at the top of every drill-down level.
@ViewBuilder
private func reportDetailHeader(title: String, subtitle: String, onBack: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: AppTheme.space1) {
        BackLink(title: "Back", action: onBack)
            .padding(.bottom, AppTheme.space3)
        Text(title)
            .font(AppFont.title)
            .foregroundStyle(AppTheme.text)
        Text(subtitle)
            .font(AppFont.subhead)
            .foregroundStyle(AppTheme.textMuted)
    }
}

private func emptyReportState(_ message: String) -> some View {
    Text(message)
        .font(AppFont.subhead)
        .foregroundStyle(AppTheme.textMuted)
        .padding(AppTheme.space4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
}

struct ReportDashboardView: View {
    @ObservedObject var store: ReceiptStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                header
                RuleLine()
                summaryGrid
                SectionLabel(text: "View Report")
                reportOptions
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            Text("Reports")
                .font(AppFont.largeTitle)
                .foregroundStyle(AppTheme.text)
            Text("Choose a report to open a clean stats page.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
    }

    private var summaryGrid: some View {
        HStack(spacing: 1) {
            StatCell(title: "Total", value: store.totalSpend.formatted(.currency(code: store.defaultCurrencyCode)), valueSize: 15)
            StatCell(title: "Month", value: store.monthlySpend.formatted(.currency(code: store.defaultCurrencyCode)), valueSize: 15)
            StatCell(title: "Receipts", value: "\(store.receiptCount)", valueSize: 15)
        }
        .background(AppTheme.divider)
    }

    private var reportOptions: some View {
        RuledStack {
            ForEach(ReportKind.allCases) { kind in
                RuledRow {
                    NavigationLink {
                        if kind == .keyword {
                            KeywordReceiptSearchReportView(store: store)
                        } else {
                            ReportDetailView(store: store, kind: kind)
                        }
                    } label: {
                        HStack(spacing: AppTheme.space3) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(kind.rawValue)
                                    .font(AppFont.headline)
                                    .foregroundStyle(AppTheme.text)
                                Text(kind.subtitle)
                                    .font(AppFont.subhead)
                                    .foregroundStyle(AppTheme.textMuted)
                                    .lineLimit(2)
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
            }
        }
    }
}

struct ReportDetailView: View {
    @ObservedObject var store: ReceiptStore
    let kind: ReportKind
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                reportDetailHeader(title: kind.rawValue, subtitle: kind.subtitle) { dismiss() }
                switch kind {
                case .overview:
                    overviewSection
                case .category:
                    summaryList(store.categorySpendSummaries, emptyText: "No category data yet.")
                case .card:
                    summaryList(store.cardSpendReportSummaries, emptyText: "No card spend data yet. Add card lookup rows and scan receipts with card last digits.")
                case .month:
                    summaryList(store.monthlySpendSummaries, emptyText: "No monthly data yet.")
                case .keyword:
                    KeywordReceiptSearchReportView(store: store)
                }
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var overviewSection: some View {
        VStack(alignment: .leading, spacing: AppTheme.space4) {
            RuledStack {
                RuledRow {
                    drillDownRow(
                        title: "Total Spend",
                        subtitle: "All saved receipts",
                        amount: store.totalSpend,
                        count: store.receiptCount,
                        receipts: kind.receipts(in: store),
                        destinationTitle: "Total Spend Receipts"
                    )
                }
                RuledRow {
                    drillDownRow(
                        title: "This Month",
                        subtitle: "Current calendar month",
                        amount: store.monthlySpend,
                        count: currentMonthReceipts.count,
                        receipts: currentMonthReceipts,
                        destinationTitle: "This Month Receipts"
                    )
                }
            }
            SectionLabel(text: "Weekly Trend")
            weeklyTrend
        }
    }

    private func summaryList(_ summaries: [ReceiptStore.SpendSummary], emptyText: String) -> some View {
        Group {
            if summaries.isEmpty {
                emptyReportState(emptyText)
            } else {
                RuledStack {
                    ForEach(summaries) { item in
                        RuledRow {
                            drillDownRow(
                                title: item.title,
                                subtitle: item.subtitle,
                                amount: item.amount,
                                count: item.receiptCount,
                                receipts: kind.receipts(in: store, matching: item),
                                destinationTitle: item.title
                            )
                        }
                    }
                }
            }
        }
    }

    private func drillDownRow(title: String, subtitle: String, amount: Decimal, count: Int, receipts: [Invoice], destinationTitle: String) -> some View {
        NavigationLink {
            ReportMonthlyBreakdownView(
                store: store,
                title: destinationTitle,
                subtitle: "\(count) receipt\(count == 1 ? "" : "s") · \(amount.formatted(.currency(code: store.defaultCurrencyCode)))",
                receipts: receipts
            )
        } label: {
            GroupRow(title: title, subtitle: "\(subtitle) · \(count) receipt\(count == 1 ? "" : "s")", amount: amount.formatted(.currency(code: store.defaultCurrencyCode)))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the receipt details for this report amount")
    }

    private var weeklyTrend: some View {
        VStack(spacing: AppTheme.space2 + 2) {
            ForEach(Array(store.weeklySpendByDay.enumerated()), id: \.offset) { _, day in
                NavigationLink {
                    let receipts = kind.receipts(in: store, dayLabel: day.label)
                    ReportMonthlyBreakdownView(
                        store: store,
                        title: "\(day.label) Receipts",
                        subtitle: "\(receipts.count) receipt\(receipts.count == 1 ? "" : "s") · \(day.amount.formatted(.currency(code: store.defaultCurrencyCode)))",
                        receipts: receipts
                    )
                } label: {
                    HStack(spacing: AppTheme.space2 + 2) {
                        Text(day.label)
                            .font(AppFont.headline)
                            .frame(width: 32, alignment: .leading)
                        GeometryReader { geometry in
                            Rectangle()
                                .fill(AppTheme.accent)
                                .frame(width: trendWidth(for: day.amount, totalWidth: geometry.size.width))
                        }
                        .frame(height: 10)
                        .background(AppTheme.surface)
                        Text(day.amount.formatted(.currency(code: store.defaultCurrencyCode)))
                            .font(AppFont.caption)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .frame(width: 72, alignment: .trailing)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(AppTheme.neutral600)
                    }
                    .foregroundStyle(AppTheme.text)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var currentMonthReceipts: [Invoice] {
        store.invoices
            .filter { invoice in
                guard let date = invoice.date else { return false }
                return Calendar.current.isDate(date, equalTo: Date(), toGranularity: .month)
            }
            .sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
    }

    private func trendWidth(for amount: Decimal, totalWidth: CGFloat) -> CGFloat {
        let maxAmount = store.weeklySpendByDay.map(\.amount).max() ?? 0
        guard maxAmount > 0 else { return totalWidth * 0.04 }
        return max(totalWidth * 0.04, CGFloat(truncating: (amount / maxAmount) as NSDecimalNumber) * totalWidth)
    }
}

private struct KeywordReceiptSearchReportView: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var keyword = ""
    @State private var useFromDate = false
    @State private var fromDate = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                reportDetailHeader(title: "Search OCR Text", subtitle: "Find receipts by keyword in raw OCR text and review monthly stats first.") { dismiss() }
                searchControls
                resultSummary
                if normalizedKeyword.isEmpty {
                    emptyReportState("Enter a keyword to search merchant, category, card, and raw OCR text.")
                } else if matchingReceipts.isEmpty {
                    emptyReportState("No receipts match this keyword and date range.")
                } else {
                    ReportMonthlyBreakdownView(
                        store: store,
                        title: "Keyword: \(normalizedKeyword)",
                        subtitle: resultSubtitle,
                        receipts: matchingReceipts
                    )
                }
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var searchControls: some View {
        VStack(alignment: .leading, spacing: AppTheme.space3) {
            FlatField(label: "Keyword") {
                TextField("Example: FairPrice, Dell, petrol, Visa", text: $keyword)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Toggle("Use from date", isOn: $useFromDate)
                .tint(AppTheme.accent)
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.text)
            if useFromDate {
                DatePicker("From", selection: $fromDate, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .tint(AppTheme.accent700)
                    .font(AppFont.body15)
            }
        }
        .padding(AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private var resultSummary: some View {
        HStack(spacing: 1) {
            StatCell(title: "Matches", value: "\(matchingReceipts.count)", valueSize: 18)
            StatCell(title: "Spend", value: matchingAmount.formatted(.currency(code: store.defaultCurrencyCode)), valueSize: 18)
        }
        .background(AppTheme.divider)
    }

    private var normalizedKeyword: String {
        keyword.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var matchingReceipts: [Invoice] {
        let query = normalizedKeyword.lowercased()
        guard !query.isEmpty else { return [] }
        let fromDay = Calendar.current.startOfDay(for: fromDate)

        return store.invoices
            .filter { invoice in
                if useFromDate {
                    guard let date = invoice.date else { return false }
                    guard Calendar.current.startOfDay(for: date) >= fromDay else { return false }
                }
                return searchableText(for: invoice).contains(query)
            }
            .sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
    }

    private var matchingAmount: Decimal {
        matchingReceipts.compactMap { $0.reportingTotal(defaultCurrencyCode: store.defaultCurrencyCode) }.reduce(0, +)
    }

    private var resultSubtitle: String {
        let dateText = useFromDate ? "from \(DateFormatter.localizedString(from: fromDate, dateStyle: .medium, timeStyle: .none))" : "all dates"
        return "\(matchingReceipts.count) receipt\(matchingReceipts.count == 1 ? "" : "s") · \(matchingAmount.formatted(.currency(code: store.defaultCurrencyCode))) · \(dateText)"
    }

    private func searchableText(for invoice: Invoice) -> String {
        [
            invoice.rawText,
            invoice.merchant ?? "",
            invoice.category ?? "",
            invoice.cardBank ?? "",
            invoice.cardLast4 ?? "",
            invoice.currency ?? "",
            invoice.receiptCurrency ?? ""
        ]
        .joined(separator: "\n")
        .lowercased()
    }
}

private struct ReportMonthlyBreakdownView: View {
    @ObservedObject var store: ReceiptStore
    let title: String
    let subtitle: String
    let receipts: [Invoice]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                reportDetailHeader(title: title, subtitle: subtitle) { dismiss() }
                if receipts.isEmpty {
                    emptyReportState("No receipts found for this report line item.")
                } else {
                    SectionLabel(text: "Monthly Breakdown")
                    RuledStack {
                        ForEach(monthlyGroups) { group in
                            RuledRow {
                                NavigationLink {
                                    ReportCategoryBreakdownView(
                                        store: store,
                                        title: group.title,
                                        subtitle: "\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s") · \(group.amount.formatted(.currency(code: store.defaultCurrencyCode)))",
                                        receipts: group.receipts
                                    )
                                } label: {
                                    GroupRow(title: group.title, subtitle: "\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s")", amount: group.amount.formatted(.currency(code: store.defaultCurrencyCode)))
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

    private var monthlyGroups: [MonthlyReceiptGroup] {
        MonthlyReceiptGroup.make(from: receipts, defaultCurrencyCode: store.defaultCurrencyCode)
    }
}

private struct MonthlyReceiptGroup: Identifiable {
    let id: String
    let title: String
    let amount: Decimal
    let receipts: [Invoice]

    static func make(from receipts: [Invoice], defaultCurrencyCode: String) -> [MonthlyReceiptGroup] {
        let keyFormatter = DateFormatter()
        keyFormatter.dateFormat = "yyyy-MM"
        let titleFormatter = DateFormatter()
        titleFormatter.dateFormat = "MMM yyyy"

        var grouped: [String: (title: String, amount: Decimal, receipts: [Invoice], sortDate: Date)] = [:]
        for invoice in receipts {
            let date = invoice.date ?? Date.distantPast
            let key = invoice.date.map { keyFormatter.string(from: $0) } ?? "unknown"
            let title = invoice.date.map { titleFormatter.string(from: $0) } ?? "No Date"
            let existing = grouped[key] ?? (title: title, amount: 0, receipts: [], sortDate: date)
            grouped[key] = (
                title: title,
                amount: existing.amount + (invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode) ?? 0),
                receipts: existing.receipts + [invoice],
                sortDate: max(existing.sortDate, date)
            )
        }

        return grouped.map { key, value in
            MonthlyReceiptGroup(
                id: key,
                title: value.title,
                amount: value.amount,
                receipts: value.receipts.sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
            )
        }
        .sorted { left, right in
            if left.id == "unknown" { return false }
            if right.id == "unknown" { return true }
            return left.id > right.id
        }
    }
}

private struct ReportCategoryBreakdownView: View {
    @ObservedObject var store: ReceiptStore
    let title: String
    let subtitle: String
    let receipts: [Invoice]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                reportDetailHeader(title: title, subtitle: subtitle) { dismiss() }
                if receipts.isEmpty {
                    emptyReportState("No receipts found for this month.")
                } else {
                    SectionLabel(text: "Category Breakdown")
                    RuledStack {
                        ForEach(categoryGroups) { group in
                            RuledRow {
                                NavigationLink {
                                    ReportReceiptDrillDownView(
                                        store: store,
                                        title: "\(title) · \(group.title)",
                                        subtitle: "\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s") · \(group.amount.formatted(.currency(code: store.defaultCurrencyCode)))",
                                        receipts: group.receipts
                                    )
                                } label: {
                                    GroupRow(title: group.title, subtitle: "\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s")", amount: group.amount.formatted(.currency(code: store.defaultCurrencyCode)))
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

    private var categoryGroups: [CategoryReceiptGroup] {
        CategoryReceiptGroup.make(from: receipts, defaultCurrencyCode: store.defaultCurrencyCode)
    }
}

private struct CategoryReceiptGroup: Identifiable {
    let id: String
    let title: String
    let amount: Decimal
    let receipts: [Invoice]

    static func make(from receipts: [Invoice], defaultCurrencyCode: String) -> [CategoryReceiptGroup] {
        var grouped: [String: (title: String, amount: Decimal, receipts: [Invoice])] = [:]
        for invoice in receipts {
            let category = invoice.category?.nilIfEmpty ?? "Miscellaneous"
            let key = category.lowercased()
            let existing = grouped[key] ?? (title: category, amount: 0, receipts: [])
            grouped[key] = (
                title: category,
                amount: existing.amount + (invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode) ?? 0),
                receipts: existing.receipts + [invoice]
            )
        }

        return grouped.map { key, value in
            CategoryReceiptGroup(
                id: key,
                title: value.title,
                amount: value.amount,
                receipts: value.receipts.sorted { ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast) }
            )
        }
        .sorted { $0.amount > $1.amount }
    }
}

private struct ReportReceiptDrillDownView: View {
    @ObservedObject var store: ReceiptStore
    let title: String
    let subtitle: String
    let receipts: [Invoice]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                reportDetailHeader(title: title, subtitle: subtitle) { dismiss() }
                if receipts.isEmpty {
                    emptyReportState("No receipts found for this report line item.")
                } else {
                    RuledStack {
                        ForEach(receipts) { invoice in
                            RuledRow {
                                NavigationLink {
                                    ReportReceiptDetailView(store: store, invoice: invoice, defaultCurrencyCode: store.defaultCurrencyCode)
                                } label: {
                                    ReportReceiptRow(invoice: invoice, defaultCurrencyCode: store.defaultCurrencyCode)
                                }
                                .buttonStyle(.plain)
                                .accessibilityHint("Opens the receipt behind this amount")
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
}

private struct ReportReceiptDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ReceiptStore
    let invoice: Invoice
    let defaultCurrencyCode: String
    @State private var showingDeleteConfirmation = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                HStack {
                    BackLink(title: "Back") { dismiss() }
                    Spacer()
                    Button("Edit") {
                        store.editingInvoice = currentInvoice
                    }
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.accent700)
                    Button(role: .destructive) {
                        showingDeleteConfirmation = true
                    } label: {
                        Text("Delete")
                    }
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.accent700)
                }

                detailHeader
                detailSection("Receipt", rows: receiptRows)
                detailSection("Currency", rows: currencyRows)
                detailSection("Payment", rows: paymentRows)
                if !currentInvoice.rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    rawTextSection
                }
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .alert("Delete receipt?", isPresented: $showingDeleteConfirmation, actions: {
            Button("Delete", role: .destructive) {
                Task {
                    await store.deleteInvoice(currentInvoice)
                    dismiss()
                }
            }
            Button("Cancel", role: .cancel) {}
        }, message: {
            Text("This action cannot be undone.")
        })
    }

    private var currentInvoice: Invoice {
        store.invoices.first(where: { $0.id == invoice.id }) ?? invoice
    }

    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: AppTheme.space2) {
            Text(currentInvoice.merchant ?? "Unknown merchant")
                .font(AppFont.title)
                .foregroundStyle(AppTheme.text)
            Text(currentInvoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .full, timeStyle: .none) } ?? "No date")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
            Text(currentInvoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "Conversion pending")
                .font(AppFont.heading(30))
                .foregroundStyle(AppTheme.text)
            if let original = currentInvoice.displayReceiptAmount {
                Text("Receipt amount: \(original.formatted(.currency(code: currentInvoice.displayReceiptCurrency)))")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
            }
            RuleLine()
        }
    }

    private var receiptRows: [(String, String)] {
        [
            ("Merchant", currentInvoice.merchant ?? "Unknown"),
            ("Date", currentInvoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date"),
            ("Category", currentInvoice.category ?? "Miscellaneous"),
            ("File URL", currentInvoice.fileUrl?.nilIfEmpty ?? "Not saved")
        ]
    }

    private var currencyRows: [(String, String)] {
        [
            ("Total Amount", currentInvoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "Conversion pending"),
            ("Receipt Amount", currentInvoice.displayReceiptAmount.map { $0.formatted(.currency(code: currentInvoice.displayReceiptCurrency)) } ?? "—"),
            ("Receipt Currency", currentInvoice.displayReceiptCurrency),
            ("Conversion Rate", currentInvoice.conversionRate?.description ?? "Not stored")
        ]
    }

    private var paymentRows: [(String, String)] {
        [
            ("Bank", currentInvoice.cardBank?.nilIfEmpty ?? "Unknown Bank"),
            ("Card", currentInvoice.cardLast4?.nilIfEmpty.map { "•••• \($0)" } ?? "Unknown"),
            ("Receipt ID", currentInvoice.id.uuidString)
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
            Text(currentInvoice.rawText)
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

private struct ReportReceiptRow: View {
    let invoice: Invoice
    let defaultCurrencyCode: String

    var body: some View {
        HStack(spacing: AppTheme.space3) {
            Text(initial)
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
                Text(rowSubtitle)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: AppTheme.space2)

            VStack(alignment: .trailing, spacing: 2) {
                Text(invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "Pending")
                    .font(AppFont.title2)
                    .foregroundStyle(AppTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let original = invoice.displayReceiptAmount {
                    Text(original.formatted(.currency(code: invoice.displayReceiptCurrency)))
                        .font(AppFont.caption)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
        .contentShape(Rectangle())
    }

    private var initial: String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }

    private var rowSubtitle: String {
        let dateLabel = invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date"
        let category = invoice.category?.nilIfEmpty ?? "Miscellaneous"
        return "\(dateLabel) · \(category)"
    }
}
