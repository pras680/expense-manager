import SwiftUI

struct SupabaseSignInView: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                } header: {
                    Text("Supabase Auth")
                } footer: {
                    Text("Optional. Use this only if you later switch from single-user anon policies to Auth-backed per-user RLS.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    Button {
                        Task { await signIn() }
                    } label: {
                        HStack {
                            if isSigningIn {
                                ProgressView()
                            }
                            Text(isSigningIn ? "Signing in..." : "Sign In")
                        }
                    }
                    .disabled(isSigningIn || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                }
            }
            .navigationTitle("Optional Supabase Auth")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func signIn() async {
        isSigningIn = true
        errorMessage = nil
        defer { isSigningIn = false }

        do {
            try await store.signInToSupabase(email: email, password: password)
            dismiss()
        } catch {
            errorMessage = AppSecurity.safeUserMessage(for: error, fallback: "Sign in failed. Check the Supabase Auth user and password.")
        }
    }
}
