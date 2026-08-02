import SwiftUI

/// Lists receipts discarded from the pending review sheet. Unlike a normal delete, rejecting a
/// receipt keeps its full data so it can be reviewed and, if the rejection was a mistake,
/// restored back into the pending review queue.
struct RejectedReceiptsView: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                BackLink(title: "Reports") { dismiss() }
                VStack(alignment: .leading, spacing: AppTheme.space1) {
                    Text("Rejected Receipts")
                        .font(AppFont.title)
                        .foregroundStyle(AppTheme.text)
                    Text("Receipts you discarded from the review sheet. Open one to see its details or restore it.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                }

                if store.rejectedReceipts.isEmpty {
                    Text("No rejected receipts. Anything you discard from the review sheet will show up here.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)
                        .padding(AppTheme.space4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.surface)
                        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
                } else {
                    RuledStack {
                        ForEach(store.rejectedReceipts) { rejected in
                            RuledRow {
                                NavigationLink {
                                    RejectedReceiptDetailView(store: store, rejected: rejected)
                                } label: {
                                    row(for: rejected)
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

    private func row(for rejected: ReceiptStore.RejectedReceipt) -> some View {
        HStack(spacing: AppTheme.space3) {
            Text(initial(for: rejected.invoice))
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.text)
                .frame(width: 38, height: 38)
                .background(AppTheme.surface)
                .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text(rejected.invoice.merchant ?? "Unknown merchant")
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.text)
                    .lineLimit(1)
                Text("Rejected \(DateFormatter.localizedString(from: rejected.rejectedAt, dateStyle: .medium, timeStyle: .none))")
                    .font(AppFont.subhead)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: AppTheme.space2)

            Text(rejected.invoice.displayReceiptAmount.map { $0.formatted(.currency(code: rejected.invoice.displayReceiptCurrency)) } ?? "—")
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

    private func initial(for invoice: Invoice) -> String {
        String((invoice.merchant ?? "Receipt").prefix(1)).uppercased()
    }
}

struct RejectedReceiptDetailView: View {
    @ObservedObject var store: ReceiptStore
    let rejected: ReceiptStore.RejectedReceipt
    @Environment(\.dismiss) private var dismiss
    @State private var showingDeleteConfirmation = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: AppTheme.space4) {
                HStack {
                    BackLink(title: "Back") { dismiss() }
                    Spacer()
                    Button("Delete") {
                        showingDeleteConfirmation = true
                    }
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.accent700)
                }

                detailHeader

                Button("Restore for Review") {
                    store.restoreRejectedReceipt(rejected)
                    dismiss()
                }
                .buttonStyle(FlatPrimaryButtonStyle())

                detailSection("Receipt", rows: receiptRows)
                detailSection("Currency", rows: currencyRows)
                detailSection("Payment", rows: paymentRows)
                if !rejected.invoice.rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    rawTextSection
                }
            }
            .padding(AppTheme.space4)
        }
        .background(AppTheme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .alert("Delete rejected receipt?", isPresented: $showingDeleteConfirmation, actions: {
            Button("Delete", role: .destructive) {
                store.deleteRejectedReceipt(rejected)
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        }, message: {
            Text("This removes it permanently — it won't be restorable afterward.")
        })
    }

    private var invoice: Invoice { rejected.invoice }

    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: AppTheme.space2) {
            Text(invoice.merchant ?? "Unknown merchant")
                .font(AppFont.title)
                .foregroundStyle(AppTheme.text)
            Text("Rejected \(DateFormatter.localizedString(from: rejected.rejectedAt, dateStyle: .full, timeStyle: .short))")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
            Text(invoice.displayReceiptAmount.map { $0.formatted(.currency(code: invoice.displayReceiptCurrency)) } ?? "No amount")
                .font(AppFont.heading(30))
                .foregroundStyle(AppTheme.text)
            RuleLine()
        }
    }

    private var receiptRows: [(String, String)] {
        [
            ("Merchant", invoice.merchant ?? "Unknown"),
            ("Date", invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date"),
            ("Category", invoice.category ?? "Miscellaneous")
        ]
    }

    private var currencyRows: [(String, String)] {
        [
            ("Receipt Amount", invoice.displayReceiptAmount.map { $0.formatted(.currency(code: invoice.displayReceiptCurrency)) } ?? "—"),
            ("Receipt Currency", invoice.displayReceiptCurrency)
        ]
    }

    private var paymentRows: [(String, String)] {
        [
            ("Bank", invoice.cardBank?.nilIfEmpty ?? "Unknown Bank"),
            ("Card", invoice.cardLast4?.nilIfEmpty.map { "•••• \($0)" } ?? "Unknown")
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
