# Expense Manager

Clean copy of the receipt scanning and expense management implementation.

## Important paths

Repository:

`/Users/prasannaganesan/git_repos/expense-manager`

Canonical Xcode app source:

`/Users/prasannaganesan/git_repos/expense-manager/ExpenseManager/ExpenseManager`

Legacy source snapshot, not maintained for security fixes:

`/Users/prasannaganesan/git_repos/expense-manager/ios-app`

Supabase Edge Functions:

`supabase/functions/` — deployed source for all functions.
`supabase-edge/` — SQL migrations, runbooks, and one-off scripts.

## Recommended Xcode setup

Use the checked-in project at `ExpenseManager/ExpenseManager.xcodeproj` with the `ExpenseManager` scheme. The maintained app source is under `ExpenseManager/ExpenseManager`; do not start new work from the legacy `ios-app` snapshot unless it is first synchronized with the maintained source.

## Files included

- `ExpenseManager/ExpenseManager/ExpenseManagerApp.swift` — app entry point.
- `ExpenseManager/ExpenseManager/Views/ContentView.swift` — launches the tabbed app UI.
- `ExpenseManager/ExpenseManager/Views/MainTabView.swift` — Receipts, Report, and Tools tabs.
- `ExpenseManager/ExpenseManager/Views/ReceiptsDashboardView.swift` — redesigned dashboard.
- `ExpenseManager/ExpenseManager/Views/ReceiptStore.swift` — scanner, OCR, Gmail, SMS, currency, and Supabase workflow.
- `ExpenseManager/ExpenseManager/Services/OCRService.swift` — Apple Vision OCR.
- `ExpenseManager/ExpenseManager/Services/DocumentScanner.swift` — camera integration.
- `ExpenseManager/ExpenseManager/Services/SupabaseService.swift` — REST, storage, and Edge Function calls.
- `supabase/functions/parse-receipt/index.ts` — receipt parsing Edge Function (LLM-backed).

## Test flow

Use the **Tools** tab in the app and tap **Run Sample OCR Trial**. It generates a sample receipt image, runs Vision OCR, opens review, then saves to Supabase when approved.

If DB save fails, check Supabase RLS policies for the `receipts` table. If image upload fails, check Storage policies for the `receipt-documents` bucket.

## Security notes

- The iOS app uses a Supabase publishable/anon key. Do not put a Supabase service-role key in the app bundle.
- Gmail access is requested with the read-only scope only: `https://www.googleapis.com/auth/gmail.readonly`.
- For production RLS, add Supabase Auth and per-user `user_id` policies. Without Auth, `auth.uid()` is `NULL`; broad `anon` policies are not safe for private receipt data.
- See `supabase-edge/payment-card-schema.sql` for example Auth-backed table and storage RLS policies.
- The Edge Function should return generic parser errors to clients and keep provider details out of client responses.
