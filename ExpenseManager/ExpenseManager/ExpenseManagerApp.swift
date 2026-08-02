import SwiftUI

@main
@MainActor
struct ExpenseManagerApp: App {
    @StateObject private var store: ReceiptStore

    init() {
        AppFonts.registerIfNeeded()
        let supabaseService = SupabaseService(
            supabaseUrl: "https://lxxetltpuuwjtxmeemhx.supabase.co",
            supabaseAnonKey: "sb_publishable_7jF_NW4pRe8y6T-mFrLtew_9VtCke9e",
            edgeFunctionBaseUrl: "https://lxxetltpuuwjtxmeemhx.supabase.co"
        )
        let receiptStore = ReceiptStore(supabaseService: supabaseService)
        _store = StateObject(wrappedValue: receiptStore)
        GmailBackgroundScheduler.register(store: receiptStore)
    }

    var body: some Scene {
        WindowGroup {
            MainTabView(store: store)
                .onOpenURL { url in
                    Task { await store.handleSharedSMSURL(url) }
                }
        }
    }
}
