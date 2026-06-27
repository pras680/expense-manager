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

    var icon: String {
        switch self {
        case .category: return "tag.fill"
        case .card: return "creditcard.fill"
        case .month: return "calendar"
        case .overview: return "chart.line.uptrend.xyaxis"
        }
    }

    var tint: Color {
        switch self {
        case .category: return .purple
        case .card: return .orange
        case .month: return .blue
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
                summaryRow("Total Spend", value: store.totalSpend.formatted(.currency(code: Invoice.defaultCurrency)), tint: .purple)
                summaryRow("This Month", value: store.monthlySpend.formatted(.currency(code: Invoice.defaultCurrency)), tint: .blue)
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
                    ReportDetailView(store: store, kind: kind)
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
            cleanStatRow(title: "Total Spend", subtitle: "All saved receipts", amount: store.totalSpend, count: store.receiptCount, tint: .purple)
            cleanStatRow(title: "This Month", subtitle: "Current calendar month", amount: store.monthlySpend, count: store.receiptCount, tint: .blue)
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
                    cleanStatRow(title: item.title, subtitle: item.subtitle, amount: item.amount, count: item.receiptCount, tint: kind.tint)
                }
            }
        }
    }

    private func cleanStatRow(title: String, subtitle: String, amount: Decimal, count: Int, tint: Color) -> some View {
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
            Text(amount.formatted(.currency(code: Invoice.defaultCurrency)))
                .font(.title3.weight(.bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .monospacedDigit()
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
                    Text(day.amount.formatted(.currency(code: Invoice.defaultCurrency)))
                        .font(.caption.weight(.bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .monospacedDigit()
                        .frame(width: 86, alignment: .trailing)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func trendWidth(for amount: Decimal, totalWidth: CGFloat) -> CGFloat {
        let maxAmount = store.weeklySpendByDay.map(\.amount).max() ?? 0
        guard maxAmount > 0 else { return totalWidth * 0.08 }
        return max(totalWidth * 0.08, CGFloat(truncating: (amount / maxAmount) as NSDecimalNumber) * totalWidth)
    }
}
