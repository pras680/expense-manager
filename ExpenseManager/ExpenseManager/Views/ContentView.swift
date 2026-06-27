import SwiftUI

@MainActor
struct ContentView: View {
    let supabaseService: SupabaseService

    var body: some View {
        MainTabView(store: ReceiptStore(supabaseService: supabaseService))
            .onAppear {
                // Ensure any required initialization runs when the app starts.
            }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(
            supabaseService: SupabaseService(
                supabaseUrl: "https://example.supabase.co",
                supabaseAnonKey: "anon",
                edgeFunctionBaseUrl: "https://example.supabase.co"
            )
        )
    }
}
