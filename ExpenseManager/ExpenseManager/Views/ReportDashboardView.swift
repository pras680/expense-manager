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

    var icon: String {
        switch self {
        case .category: return "tag.fill"
        case .card: return "creditcard.fill"
        case .month: return "calendar"
        case .keyword: return "text.magnifyingglass"
        case .overview: return "chart.line.uptrend.xyaxis"
        }
    }

    var tint: Color {
        switch self {
        case .category: return .purple
        case .card: return .orange
        case .month: return .blue
        case .keyword: return .indigo
        case .overview: return .green
        }
    }
}

struct ReportDashboardView: View {
    @ObservedObject var store: ReceiptStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                header
                cleanSummary
                reportOptions
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Reports")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Reports")
                .font(.largeTitle.weight(.black))
            Text("Choose a report type to open a clean stats page.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(LinearGradient(colors: [Color.blue.opacity(0.18), Color.purple.opacity(0.14)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
    }

    private var cleanSummary: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Summary")
                .font(.headline)
            VStack(spacing: 10) {
                summaryRow("Total Spend", value: store.totalSpend.formatted(.currency(code: store.defaultCurrencyCode)), tint: .purple)
                summaryRow("This Month", value: store.monthlySpend.formatted(.currency(code: store.defaultCurrencyCode)), tint: .blue)
                summaryRow("Receipts", value: "\(store.receiptCount)", tint: .green)
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private func summaryRow(_ title: String, value: String, tint: Color) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 16)
            Text(value)
                .font(.title3.weight(.bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
                .monospacedDigit()
        }
        .padding(14)
        .background(Color(.systemBackground).opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var reportOptions: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("View Report")
                .font(.headline)

            ForEach(ReportKind.allCases) { kind in
                NavigationLink {
                    if kind == .keyword {
                        KeywordReceiptSearchReportView(store: store)
                    } else {
                        ReportDetailView(store: store, kind: kind)
                    }
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: kind.icon)
                            .font(.headline)
                            .foregroundStyle(kind.tint)
                            .frame(width: 44, height: 44)
                            .background(kind.tint.opacity(0.14))
                            .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 5) {
                            Text(kind.rawValue)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Text(kind.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(Color(.systemBackground).opacity(0.96))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

struct ReportDetailView: View {
    @ObservedObject var store: ReceiptStore
    let kind: ReportKind

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                detailHeader
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
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(kind.rawValue)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var detailHeader: some View {
        HStack(spacing: 14) {
            Image(systemName: kind.icon)
                .font(.title2.weight(.bold))
                .foregroundStyle(kind.tint)
                .frame(width: 54, height: 54)
                .background(kind.tint.opacity(0.14))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(kind.rawValue)
                    .font(.title2.weight(.bold))
                Text(kind.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private var overviewSection: some View {
        VStack(spacing: 14) {
            drillDownRow(
                title: "Total Spend",
                subtitle: "All saved receipts",
                amount: store.totalSpend,
                count: store.receiptCount,
                tint: .purple,
                receipts: kind.receipts(in: store),
                destinationTitle: "Total Spend Receipts"
            )
            drillDownRow(
                title: "This Month",
                subtitle: "Current calendar month",
                amount: store.monthlySpend,
                count: currentMonthReceipts.count,
                tint: .blue,
                receipts: currentMonthReceipts,
                destinationTitle: "This Month Receipts"
            )
            weeklyTrend
        }
    }

    private func summaryList(_ summaries: [ReceiptStore.SpendSummary], emptyText: String) -> some View {
        VStack(spacing: 12) {
            if summaries.isEmpty {
                Text(emptyText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemBackground).opacity(0.96))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            } else {
                ForEach(summaries) { item in
                    drillDownRow(
                        title: item.title,
                        subtitle: item.subtitle,
                        amount: item.amount,
                        count: item.receiptCount,
                        tint: kind.tint,
                        receipts: kind.receipts(in: store, matching: item),
                        destinationTitle: item.title
                    )
                }
            }
        }
    }

    private func drillDownRow(title: String, subtitle: String, amount: Decimal, count: Int, tint: Color, receipts: [Invoice], destinationTitle: String) -> some View {
        NavigationLink {
            reportDestination(title: destinationTitle, amount: amount, count: count, receipts: receipts, tint: tint)
        } label: {
            cleanStatRow(title: title, subtitle: subtitle, amount: amount, count: count, tint: tint, showsDisclosure: true)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the receipt details for this report amount")
    }

    private func reportDestination(title: String, amount: Decimal, count: Int, receipts: [Invoice], tint: Color) -> some View {
        ReportMonthlyBreakdownView(
            store: store,
            title: title,
            subtitle: "\(count) receipt\(count == 1 ? "" : "s") • \(amount.formatted(.currency(code: store.defaultCurrencyCode)))",
            receipts: receipts,
            tint: tint
        )
    }

    private func cleanStatRow(title: String, subtitle: String, amount: Decimal, count: Int, tint: Color, showsDisclosure: Bool = false) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text("\(subtitle) • \(count) receipt\(count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 16)
            Text(amount.formatted(.currency(code: store.defaultCurrencyCode)))
                .font(.title3.weight(.bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .monospacedDigit()
            if showsDisclosure {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var weeklyTrend: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Weekly Trend")
                .font(.headline)
            ForEach(Array(store.weeklySpendByDay.enumerated()), id: \.offset) { _, day in
                NavigationLink {
                    let receipts = kind.receipts(in: store, dayLabel: day.label)
                    reportDestination(title: "\(day.label) Receipts", amount: day.amount, count: receipts.count, receipts: receipts, tint: .blue)
                } label: {
                    HStack {
                        Text(day.label)
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 42, alignment: .leading)
                        GeometryReader { geometry in
                            RoundedRectangle(cornerRadius: 8)
                                .fill(LinearGradient(colors: [Color.blue.opacity(0.9), Color.purple.opacity(0.75)], startPoint: .leading, endPoint: .trailing))
                                .frame(width: trendWidth(for: day.amount, totalWidth: geometry.size.width))
                        }
                        .frame(height: 12)
                        Text(day.amount.formatted(.currency(code: store.defaultCurrencyCode)))
                            .font(.caption.weight(.bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .monospacedDigit()
                            .frame(width: 86, alignment: .trailing)
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
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
        guard maxAmount > 0 else { return totalWidth * 0.08 }
        return max(totalWidth * 0.08, CGFloat(truncating: (amount / maxAmount) as NSDecimalNumber) * totalWidth)
    }
}

private struct KeywordReceiptSearchReportView: View {
    @ObservedObject var store: ReceiptStore
    @State private var keyword = ""
    @State private var useFromDate = false
    @State private var fromDate = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
    private let tint = Color.indigo

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                header
                searchControls
                resultSummary
                if normalizedKeyword.isEmpty {
                    helperCard("Enter a keyword to search merchant, category, card, and raw OCR text.")
                } else if matchingReceipts.isEmpty {
                    helperCard("No receipts match this keyword and date range.")
                } else {
                    monthlyBreakdown
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Search OCR Text")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "text.magnifyingglass")
                .font(.title2.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 54, height: 54)
                .background(tint.opacity(0.14))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text("Search OCR Text")
                    .font(.title2.weight(.bold))
                Text("Find receipts by keyword in raw OCR text and review monthly stats first.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private var searchControls: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Keyword Search")
                .font(.headline)
            TextField("Example: FairPrice, Dell, petrol, Visa", text: $keyword)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            Toggle("Use from date", isOn: $useFromDate)
            if useFromDate {
                DatePicker("From", selection: $fromDate, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.compact)
            }
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var resultSummary: some View {
        HStack(spacing: 12) {
            statPill("Matches", value: "\(matchingReceipts.count)")
            statPill("Spend", value: matchingAmount.formatted(.currency(code: store.defaultCurrencyCode)))
        }
    }

    private func statPill(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.weight(.bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var monthlyBreakdown: some View {
        ReportMonthlyBreakdownView(
            store: store,
            title: "Keyword: \(normalizedKeyword)",
            subtitle: resultSubtitle,
            receipts: matchingReceipts,
            tint: tint
        )
    }

    private func helperCard(_ message: String) -> some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground).opacity(0.96))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
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
        return "\(matchingReceipts.count) receipt\(matchingReceipts.count == 1 ? "" : "s") • \(matchingAmount.formatted(.currency(code: store.defaultCurrencyCode))) • \(dateText)"
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
    let tint: Color

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                header
                if receipts.isEmpty {
                    emptyState
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Monthly Breakdown")
                            .font(.headline)
                        ForEach(monthlyGroups) { group in
                            NavigationLink {
                                ReportCategoryBreakdownView(
                                    store: store,
                                    title: group.title,
                                    subtitle: "\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s") • \(group.amount.formatted(.currency(code: store.defaultCurrencyCode)))",
                                    receipts: group.receipts,
                                    tint: tint
                                )
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(group.title)
                                            .font(.headline)
                                        Text("\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s")")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 16)
                                    Text(group.amount.formatted(.currency(code: store.defaultCurrencyCode)))
                                        .font(.title3.weight(.bold))
                                        .foregroundStyle(tint)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.65)
                                        .monospacedDigit()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.secondary)
                                }
                                .padding()
                                .background(Color(.systemBackground).opacity(0.96))
                                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding()
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.title2.weight(.bold))
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(tint.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var emptyState: some View {
        Text("No receipts found for this report line item.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground).opacity(0.96))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
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
    let tint: Color

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                header
                if receipts.isEmpty {
                    emptyState
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Category Breakdown")
                            .font(.headline)
                        ForEach(categoryGroups) { group in
                            NavigationLink {
                                ReportReceiptDrillDownView(
                                    store: store,
                                    title: "\(title) • \(group.title)",
                                    subtitle: "\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s") • \(group.amount.formatted(.currency(code: store.defaultCurrencyCode)))",
                                    receipts: group.receipts,
                                    tint: tint
                                )
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(group.title)
                                            .font(.headline)
                                        Text("\(group.receipts.count) receipt\(group.receipts.count == 1 ? "" : "s")")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 16)
                                    Text(group.amount.formatted(.currency(code: store.defaultCurrencyCode)))
                                        .font(.title3.weight(.bold))
                                        .foregroundStyle(tint)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.65)
                                        .monospacedDigit()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.secondary)
                                }
                                .padding()
                                .background(Color(.systemBackground).opacity(0.96))
                                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding()
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.title2.weight(.bold))
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(tint.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var emptyState: some View {
        Text("No receipts found for this month.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground).opacity(0.96))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
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
    let tint: Color

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
                                ReportReceiptDetailView(store: store, invoice: invoice, defaultCurrencyCode: store.defaultCurrencyCode, tint: tint)
                            } label: {
                                ReportReceiptRow(invoice: invoice, defaultCurrencyCode: store.defaultCurrencyCode, tint: tint)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Opens the receipt behind this amount")
                        }
                    }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.title2.weight(.bold))
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(tint.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var emptyState: some View {
        Text("No receipts found for this report line item.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground).opacity(0.96))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct ReportReceiptDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ReceiptStore
    let invoice: Invoice
    let defaultCurrencyCode: String
    let tint: Color
    @State private var showingDeleteConfirmation = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                detailHeader
                actionButtons
                detailSection("Receipt", rows: receiptRows)
                detailSection("Currency", rows: currencyRows)
                detailSection("Payment", rows: paymentRows)
                if !currentInvoice.rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    rawTextSection
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(currentInvoice.merchant ?? "Receipt")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    store.editingInvoice = currentInvoice
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                Button(role: .destructive) {
                    showingDeleteConfirmation = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
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
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Circle()
                    .fill(tint.opacity(0.16))
                    .frame(width: 52, height: 52)
                    .overlay(Text(initial).font(.title3.weight(.bold)).foregroundStyle(tint))
                VStack(alignment: .leading, spacing: 4) {
                    Text(currentInvoice.merchant ?? "Unknown merchant")
                        .font(.title2.weight(.bold))
                    Text(currentInvoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .full, timeStyle: .none) } ?? "No date")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Text(currentInvoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD conversion pending")
                .font(.largeTitle.weight(.black))
                .foregroundStyle(tint)
                .monospacedDigit()
            if let original = currentInvoice.displayReceiptAmount {
                Text("Receipt amount: \(original.formatted(.currency(code: currentInvoice.displayReceiptCurrency)))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var actionButtons: some View {
        HStack(spacing: 12) {
            Button {
                store.editingInvoice = currentInvoice
            } label: {
                Label("Edit", systemImage: "pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(tint)

            Button(role: .destructive) {
                showingDeleteConfirmation = true
            } label: {
                Label("Delete", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .font(.subheadline.weight(.semibold))
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
            ("Total Amount", currentInvoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD conversion pending"),
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
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            ForEach(rows, id: \.0) { label, value in
                HStack(alignment: .top, spacing: 12) {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 120, alignment: .leading)
                    Text(value)
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var rawTextSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Raw OCR Text")
                .font(.headline)
            Text(currentInvoice.rawText)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var initial: String {
        String((currentInvoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }
}

private struct ReportReceiptRow: View {
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
                    .lineLimit(1)
                Text(invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Label(invoice.category ?? "Miscellaneous", systemImage: "tag.fill")
                    if let cardLabel {
                        Label(cardLabel, systemImage: "creditcard.fill")
                    }
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }

            Spacer(minLength: 10)

            VStack(alignment: .trailing, spacing: 4) {
                Text(invoice.reportingTotal(defaultCurrencyCode: defaultCurrencyCode).map { $0.formatted(.currency(code: defaultCurrencyCode)) } ?? "SGD pending")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .monospacedDigit()
                if let original = invoice.displayReceiptAmount {
                    Text("Receipt: \(original.formatted(.currency(code: invoice.displayReceiptCurrency)))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
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
