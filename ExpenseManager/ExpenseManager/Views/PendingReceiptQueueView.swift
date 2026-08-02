import SwiftUI

/// Review queue for freshly-extracted receipts (camera scan, photo import, Gmail scan, SMS
/// scan). Lists every pending candidate with its key fields and a raw-text snippet so each line
/// can be approved or rejected without opening a full editor; "Detail" opens the full receipt
/// message plus editable fields for the cases that need a closer look or a correction.
struct PendingReceiptQueueView: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var detailTarget: ReceiptStore.PendingReceipt?

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    header
                    RuleLine()

                    if let status = store.statusMessage {
                        Text(status)
                            .font(AppFont.subhead)
                            .foregroundStyle(AppTheme.textMuted)
                            .padding(AppTheme.space3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(AppTheme.surface)
                            .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
                    }

                    if store.pendingReceipts.isEmpty {
                        emptyState
                    } else {
                        RuledStack {
                            ForEach(store.pendingReceipts) { pending in
                                RuledRow {
                                    row(pending)
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
        .sheet(item: $detailTarget) { pending in
            PendingReceiptDetailView(
                store: store,
                pending: pending,
                onApprove: { edited in await store.approvePendingReceipt(pending, editedInvoice: edited) },
                onReject: { store.rejectPendingReceipt(pending) }
            )
        }
        .onChange(of: store.pendingReceipts.isEmpty) {
            if store.pendingReceipts.isEmpty { store.showPendingReview = false }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            HStack {
                Text(store.pendingReceipts.count == 1 ? "Review 1 Receipt" : "Review \(store.pendingReceipts.count) Receipts")
                    .font(AppFont.title)
                    .foregroundStyle(AppTheme.text)
                Spacer()
                Button("Done") { dismiss() }
                    .font(AppFont.headline)
                    .foregroundStyle(AppTheme.accent700)
            }
            Text("Scroll through each line, then Approve or Reject. Use Detail to read the full receipt message or fix a field first.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
        .padding(.top, AppTheme.space2)
    }

    private var emptyState: some View {
        VStack(spacing: AppTheme.space2) {
            Text("All caught up")
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.text)
            Text("No receipts waiting for review.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AppTheme.space6)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private func row(_ pending: ReceiptStore.PendingReceipt) -> some View {
        let invoice = pending.invoice
        let isSaving = store.savingPendingReceiptIDs.contains(pending.id)

        return VStack(alignment: .leading, spacing: AppTheme.space2) {
            HStack(alignment: .top, spacing: AppTheme.space3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(invoice.merchant?.nilIfEmpty ?? "Unknown merchant")
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

            Text(rawTextSnippet(for: invoice))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(AppTheme.textMuted)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: AppTheme.space2) {
                Button {
                    Task { await store.approvePendingReceipt(pending) }
                } label: {
                    if isSaving {
                        ProgressView().frame(maxWidth: 90)
                    } else {
                        Text("Approve").frame(maxWidth: 90)
                    }
                }
                .buttonStyle(FlatPrimaryButtonStyle(fullWidth: false))
                .disabled(isSaving)

                Button("Reject") {
                    store.rejectPendingReceipt(pending)
                }
                .buttonStyle(FlatSecondaryButtonStyle(fullWidth: false))
                .disabled(isSaving)

                Spacer()

                Button {
                    detailTarget = pending
                } label: {
                    HStack(spacing: 3) {
                        Text("Detail")
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                    }
                }
                .buttonStyle(.plain)
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.accent700)
                .disabled(isSaving)
            }
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
    }

    private func rowSubtitle(for invoice: Invoice) -> String {
        let dateLabel = invoice.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? "No date"
        let category = invoice.category?.nilIfEmpty ?? "Miscellaneous"
        if let cardLast4 = invoice.cardLast4?.nilIfEmpty {
            return "\(dateLabel) · \(category) · •••• \(cardLast4)"
        }
        return "\(dateLabel) · \(category)"
    }

    private func rawTextSnippet(for invoice: Invoice) -> String {
        let collapsed = invoice.rawText
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: "  ·  ")
        guard !collapsed.isEmpty else { return "No raw text was captured for this receipt." }
        let limit = 160
        return collapsed.count > limit ? String(collapsed.prefix(limit)) + "…" : collapsed
    }
}
