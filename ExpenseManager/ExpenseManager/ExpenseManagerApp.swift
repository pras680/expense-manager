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
                // AppTheme is a single fixed light palette with no dark variant. Without this,
                // system Dark Mode flips native control text (TextField/TextEditor/Picker) to
                // white, which renders unreadable against the light AppTheme.surface/bg fills.
                .preferredColorScheme(.light)
        }
    }
}
