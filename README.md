# Expense Manager

Clean copy of the receipt scanning and expense management implementation.

## Important paths

Repository:

`/Users/prasannaganesan/git_repos/expense-manager`

Swift source folder to add to a new Xcode iOS app project:

`/Users/prasannaganesan/git_repos/expense-manager/ios-app`

Supabase Edge Function:

`/Users/prasannaganesan/git_repos/expense-manager/supabase-edge/parse-receipt`

## Recommended fresh Xcode setup

1. Open Xcode.
2. Choose **File > New > Project...**.
3. Select **iOS > App**.
4. Product Name: `Expense Manager`.
5. Interface: `SwiftUI`.
6. Language: `Swift`.
7. Do **not** select SwiftData.
8. Save the project somewhere clean, preferably inside this repo or next to it.
9. Delete the default generated `ContentView.swift` and generated `App.swift` from the Xcode project.
10. Drag these files/folders into the Xcode project navigator and check **Copy items if needed** only if the project is outside this repo:
    - `ios-app/ExpenseManagerApp.swift`
    - `ios-app/Info.plist`
    - `ios-app/Models`
    - `ios-app/Services`
    - `ios-app/Views`
11. In target settings, make sure `Info.plist` points to `ios-app/Info.plist` if you use this plist.
12. Build and run the `Expense Manager` target.

## Files included

- `ExpenseManagerApp.swift` — app entry point.
- `Views/ContentView.swift` — launches the tabbed app UI.
- `Views/MainTabView.swift` — Receipts, Report, and Tools tabs.
- `Views/ReceiptsDashboardView.swift` — redesigned dashboard.
- `Views/ReceiptStore.swift` — scanner, OCR, sample trial, and Supabase workflow.
- `Services/OCRService.swift` — Apple Vision OCR.
- `Services/DocumentScanner.swift` — camera integration.
- `Services/SupabaseService.swift` — REST, storage, and Edge Function calls.
- `supabase-edge/parse-receipt/index.ts` — Anthropic parsing Edge Function.

## Test flow

Use the **Tools** tab in the app and tap **Run Sample OCR Trial**. It generates a sample receipt image, runs Vision OCR, opens review, then saves to Supabase when approved.

If DB save fails, check Supabase RLS policies for the `receipts` table. If image upload fails, check Storage policies for the `receipt-documents` bucket.
