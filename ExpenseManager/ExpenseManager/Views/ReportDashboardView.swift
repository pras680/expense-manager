import SwiftUI

enum ReportKind: String, CaseIterable, Identifiable {
    case category = "Spend by Category"
    case card = "Spend by Card"
    case month = "Spend by Month"
    case overview = "Overview"

    var id: String { rawValue }

    var subtitle: String {
        switch self {
        case .category:
            return "Compare groceries, food, fuel, entertainment, and other expense groups."
        case .card:
            return "See spend by bank credit card and last 4 digits."
        case .month:
            return "Review month-by-month totals and receipt volume."
        case .overview:
            return "View total spend, this month, receipts, and weekly trend."
        }
    }
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
            StatCell(title: "Total", value: store.totalSpend.formatted(.currency(code: Invoice.defaultCurrency)), valueSize: 15)
            StatCell(title: "Month", value: store.monthlySpend.formatted(.currency(code: Invoice.defaultCurrency)), valueSize: 15)
            StatCell(title: "Receipts", value: "\(store.receiptCount)", valueSize: 15)
        }
        .background(AppTheme.divider)
    }

    private var reportOptions: some View {
        RuledStack {
            ForEach(ReportKind.allCases) { kind in
                RuledRow {
                    NavigationLink {
                        ReportDetailView(store: store, kind: kind)
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
                BackLink(title: "Reports") { dismiss() }
                VStack(alignment: .leading, spacing: AppTheme.space1) {
                    Text(kind.rawValue)
                        .font(AppFont.title)
                        .foregroundStyle(AppTheme.text)
                    Text(kind.subtitle)
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                }

                switch kind {
                case .overview:
                    overviewSection
                case .category:
                    summaryList(store.categorySpendSummaries, emptyText: "No category data yet.")
                case .card:
                    summaryList(store.cardSpendReportSummaries, emptyText: "No card spend data yet. Add card lookup rows and scan receipts with card last digits.")
                case .month:
                    summaryList(store.monthlySpendSummaries, emptyText: "No monthly data yet.")
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
                RuledRow { cleanStatRow(title: "Total Spend", value: store.totalSpend) }
                RuledRow { cleanStatRow(title: "This Month", value: store.monthlySpend) }
            }
            SectionLabel(text: "Weekly Trend")
            weeklyTrend
        }
    }

    private func summaryList(_ summaries: [ReceiptStore.SpendSummary], emptyText: String) -> some View {
        Group {
            if summaries.isEmpty {
                Text(emptyText)
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .padding(AppTheme.space4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.surface)
                    .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
            } else {
                RuledStack {
                    ForEach(summaries) { item in
                        RuledRow {
                            HStack(spacing: AppTheme.space3) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(AppFont.headline)
                                        .foregroundStyle(AppTheme.text)
                                        .lineLimit(1)
                                    Text("\(item.subtitle) · \(item.receiptCount) receipt\(item.receiptCount == 1 ? "" : "s")")
                                        .font(AppFont.subhead)
                                        .foregroundStyle(AppTheme.textMuted)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: AppTheme.space2)
                                Text(item.amount.formatted(.currency(code: Invoice.defaultCurrency)))
                                    .font(AppFont.title2)
                                    .foregroundStyle(AppTheme.text)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                            }
                            .padding(.vertical, AppTheme.space3)
                            .padding(.horizontal, AppTheme.space3)
                        }
                    }
                }
            }
        }
    }

    private func cleanStatRow(title: String, value: Decimal) -> some View {
        HStack {
            Text(title)
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.text)
            Spacer()
            Text(value.formatted(.currency(code: Invoice.defaultCurrency)))
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
    }

    private var weeklyTrend: some View {
        VStack(spacing: AppTheme.space2 + 2) {
            ForEach(Array(store.weeklySpendByDay.enumerated()), id: \.offset) { _, day in
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
                    Text(day.amount.formatted(.currency(code: Invoice.defaultCurrency)))
                        .font(AppFont.caption)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .frame(width: 64, alignment: .trailing)
                }
            }
        }
    }

    private func trendWidth(for amount: Decimal, totalWidth: CGFloat) -> CGFloat {
        let maxAmount = store.weeklySpendByDay.map(\.amount).max() ?? 0
        guard maxAmount > 0 else { return totalWidth * 0.04 }
        return max(totalWidth * 0.04, CGFloat(truncating: (amount / maxAmount) as NSDecimalNumber) * totalWidth)
    }
}
