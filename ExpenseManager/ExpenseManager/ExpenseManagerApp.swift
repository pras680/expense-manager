import SwiftUI

@main
struct ExpenseManagerApp: App {
    let supabaseService = SupabaseService(
        supabaseUrl: "https://lxxetltpuuwjtxmeemhx.supabase.co",
        supabaseAnonKey: "sb_publishable_7jF_NW4pRe8y6T-mFrLtew_9VtCke9e",
        edgeFunctionBaseUrl: "https://lxxetltpuuwjtxmeemhx.supabase.co"
    )

    init() {
        AppFonts.registerIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(supabaseService: supabaseService)
        }
    }
}
