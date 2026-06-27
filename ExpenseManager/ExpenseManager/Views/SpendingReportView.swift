import SwiftUI

struct SpendingReportView: View {
    @ObservedObject var store: ReceiptStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                header
                summaryCard
                trendChart
                cardSpendByBank
                recentReceipts
                insightsCard
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Spending Report")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Spending Report")
                .font(.largeTitle.weight(.black))
            Text("A clear snapshot of your receipt activity and weekly spend.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(
            LinearGradient(colors: [Color.purple.opacity(0.20), Color.blue.opacity(0.16)], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: Color.black.opacity(0.06), radius: 18, x: 0, y: 8)
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Summary")
                        .font(.headline)
                    Text("Top-level spend metrics at a glance.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundColor(Color.purple)
                    .padding(10)
                    .background(Color.purple.opacity(0.15))
                    .clipShape(Circle())
            }

            HStack(spacing: 16) {
                metricCard(title: "Total Spend", value: store.totalSpend, color: Color.purple)
                metricCard(title: "This Month", value: store.monthlySpend, color: Color.blue)
                metricCard(title: "Receipts", value: Decimal(store.receiptCount), color: Color.green)
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 10)
    }

    private func metricCard(title: String, value: Decimal, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundColor(.secondary)
            Text(value.formatted(.currency(code: Invoice.defaultCurrency)))
                .font(.title3.weight(.bold))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.white.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var trendChart: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Weekly Trend")
                .font(.headline)
            Text("See how your spend changes each day.")
                .font(.subheadline)
                .foregroundColor(.secondary)

            GeometryReader { geometry in
                HStack(alignment: .bottom, spacing: 12) {
                    ForEach(Array(store.weeklySpendByDay.enumerated()), id: \.offset) { item in
                        let bar = item.element
                        VStack(spacing: 8) {
                            Text(bar.amount.formatted(.currency(code: Invoice.defaultCurrency)))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.5)
                            RoundedRectangle(cornerRadius: 16)
                                .fill(LinearGradient(colors: [Color.blue.opacity(0.9), Color.purple.opacity(0.8)], startPoint: .bottom, endPoint: .top))
                                .frame(height: barHeight(bar.amount, availableHeight: geometry.size.height - 50))
                            Text(bar.label)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            .frame(height: 240)
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 10)
    }

    private func barHeight(_ amount: Decimal, availableHeight: CGFloat) -> CGFloat {
        let values = store.weeklySpendByDay.map { $0.amount }
        guard let maxValue = values.max(), maxValue > 0 else { return availableHeight * 0.20 }
        return CGFloat(truncating: (amount / maxValue) as NSDecimalNumber) * availableHeight
    }

    private var cardSpendByBank: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Card Spend by Bank")
                        .font(.headline)
                    Text("Track how much you spend on each mapped credit card.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "creditcard.fill")
                    .font(.title3)
                    .foregroundColor(.orange)
                    .padding(10)
                    .background(Color.orange.opacity(0.15))
                    .clipShape(Circle())
            }

            if store.cardSpendSummaries.isEmpty {
                Text("No card information found yet. Add cards to the lookup table and scan receipts that show card last digits.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemBackground).opacity(0.95))
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                ForEach(store.cardSpendSummaries) { summary in
                    HStack(spacing: 12) {
                        Image(systemName: "building.columns.fill")
                            .foregroundColor(.orange)
                            .frame(width: 38, height: 38)
                            .background(Color.orange.opacity(0.14))
                            .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 4) {
                            Text(summary.displayName)
                                .font(.subheadline.weight(.semibold))
                            Text("\(summary.receiptCount) receipt\(summary.receiptCount == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Text(summary.amount.formatted(.currency(code: Invoice.defaultCurrency)))
                            .font(.subheadline.bold())
                    }
                    .padding()
                    .background(Color(.systemBackground).opacity(0.95))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: Color.black.opacity(0.03), radius: 8, x: 0, y: 6)
                }
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 10)
    }

    private var recentReceipts: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Latest Receipts")
                .font(.headline)
            Text("Review your most recent saved purchases.")
                .font(.subheadline)
                .foregroundColor(.secondary)

            ForEach(store.recentInvoices) { invoice in
                HStack(spacing: 14) {
                    Circle()
                        .fill(Color.blue.opacity(0.17))
                        .frame(width: 48, height: 48)
                        .overlay(Text(invoice.merchant?.prefix(1) ?? "R").font(.headline).foregroundColor(.blue))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(invoice.merchant ?? "Unknown merchant")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        if let date = invoice.date {
                            Text(date, style: .date)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } else {
                            Text("No date")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Label(invoice.category ?? "Miscellaneous", systemImage: "tag.fill")
                            .font(.caption2.weight(.bold))
                            .foregroundColor(.purple)
                        if let cardLabel = cardLabel(for: invoice) {
                            Label(cardLabel, systemImage: "creditcard.fill")
                                .font(.caption2.weight(.bold))
                                .foregroundColor(.orange)
                        }
                    }
                    Spacer()
                    Text(invoice.total.map { $0.formatted(.currency(code: invoice.currency ?? Invoice.defaultCurrency)) } ?? "—")
                        .font(.subheadline.bold())
                }
                .padding()
                .background(Color(.systemBackground).opacity(0.95))
                .cornerRadius(20)
                .shadow(color: Color.black.opacity(0.03), radius: 8, x: 0, y: 6)
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 10)
    }

    private func cardLabel(for invoice: Invoice) -> String? {
        guard let last4 = invoice.cardLast4?.nilIfEmpty else { return nil }
        return "\(invoice.cardBank?.nilIfEmpty ?? "Unknown Bank") •••• \(last4)"
    }

    private var insightsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Insights")
                        .font(.headline)
                    Text(store.receiptCount == 0 ? "Add receipts to begin tracking your spend." : "Keep an eye on your weekly spend and update receipts as needed.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "lightbulb.fill")
                    .foregroundColor(.yellow)
                    .padding(10)
                    .background(Color.yellow.opacity(0.18))
                    .clipShape(Circle())
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.blue.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}
