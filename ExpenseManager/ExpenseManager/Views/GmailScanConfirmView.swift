import SwiftUI

/// Count/confirm screen shown after a Gmail search finishes and before anything is parsed or
/// queued. Nothing from the scan is touched until the user explicitly taps Proceed; Cancel (or
/// swiping the sheet away) discards the findings entirely.
struct GmailScanConfirmView: View {
    @ObservedObject var store: ReceiptStore
    let result: GmailReceiptScanResult
    @Environment(\.dismiss) private var dismiss

    private var count: Int { result.receiptCandidates.count }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    header
                    RuleLine()
                    countStat
                    scanRangeSummary

                    if count > 0 {
                        SectionLabel(text: "Emails Found")
                        RuledStack {
                            ForEach(result.receiptCandidates) { candidate in
                                RuledRow { candidateRow(candidate) }
                            }
                        }
                    }
                }
                .padding(AppTheme.space4)
            }
            .background(AppTheme.bg.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .bottom) {
                actions
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            Text("Gmail Scan")
                .font(AppFont.title)
                .foregroundStyle(AppTheme.text)
            Text("Review the count before anything is parsed or added to your review queue.")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
        .padding(.top, AppTheme.space2)
    }

    private var countStat: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            SectionLabel(text: count == 1 ? "Receipt Found" : "Receipts Found")
            Text("\(count)")
                .font(AppFont.heading(48))
                .foregroundStyle(AppTheme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppTheme.space4)
        .background(AppTheme.surface)
        .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
    }

    private var scanRangeSummary: some View {
        VStack(alignment: .leading, spacing: AppTheme.space1) {
            Text("Searched \(Self.displayDate(result.searchedFrom)) – \(Self.displayDate(result.searchedThrough))")
            Text("\(result.scannedMessageCount) email\(result.scannedMessageCount == 1 ? "" : "s") scanned in that range")
        }
        .font(AppFont.subhead)
        .foregroundStyle(AppTheme.textMuted)
    }

    private func candidateRow(_ candidate: GmailReceiptCandidate) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(Self.subject(from: candidate.rawText))
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.text)
                .lineLimit(2)
            Text(candidate.receivedDate.map(Self.displayDate) ?? "Unknown date")
                .font(AppFont.subhead)
                .foregroundStyle(AppTheme.textMuted)
        }
        .padding(.vertical, AppTheme.space3)
        .padding(.horizontal, AppTheme.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actions: some View {
        VStack(spacing: AppTheme.space3) {
            if count > 0 {
                Button {
                    Task {
                        await store.proceedWithGmailImport()
                        dismiss()
                    }
                } label: {
                    if store.isImportingGmailResult {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Proceed — Review \(count) Receipt\(count == 1 ? "" : "s")").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(FlatPrimaryButtonStyle())
                .disabled(store.isImportingGmailResult)

                Button("Cancel") {
                    store.cancelGmailImport()
                    dismiss()
                }
                .buttonStyle(FlatSecondaryButtonStyle())
                .disabled(store.isImportingGmailResult)
            } else {
                Button("Close") {
                    store.cancelGmailImport()
                    dismiss()
                }
                .buttonStyle(FlatPrimaryButtonStyle())
            }
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space3)
        .padding(.bottom, AppTheme.space2)
        .background(AppTheme.bg)
        .overlay(alignment: .top) { RuleLine() }
    }

    private static func subject(from rawText: String) -> String {
        guard let line = rawText.components(separatedBy: .newlines).first(where: { $0.hasPrefix("Email Subject:") }) else {
            return "Gmail receipt"
        }
        return line.replacingOccurrences(of: "Email Subject:", with: "").trimmingCharacters(in: .whitespaces)
    }

    private static func displayDate(_ date: Date) -> String {
        DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .none)
    }
}
