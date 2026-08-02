import SwiftUI

struct SupabaseSignInView: View {
    @ObservedObject var store: ReceiptStore
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            RuleLine()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: AppTheme.space4) {
                    FlatField(label: "Email") {
                        TextField("you@company.com", text: $email)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled()
                    }
                    FlatField(label: "Password") {
                        SecureField("••••••••", text: $password)
                            .textContentType(.password)
                    }
                    Text("Optional. Use this only if you later switch from single-user anon policies to Auth-backed per-user RLS.")
                        .font(AppFont.subhead)
                        .foregroundStyle(AppTheme.textMuted)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(AppFont.subhead)
                            .foregroundStyle(AppTheme.accent700)
                            .padding(AppTheme.space3)
                            .background(AppTheme.surface)
                            .overlay(Rectangle().stroke(AppTheme.divider, lineWidth: 1))
                    }

                    Button {
                        Task { await signIn() }
                    } label: {
                        if isSigningIn {
                            ProgressView()
                                .tint(AppTheme.bg)
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Sign In")
                        }
                    }
                    .buttonStyle(FlatPrimaryButtonStyle())
                    .disabled(isSigningIn || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                }
                .padding(AppTheme.space4)
            }
        }
        .background(AppTheme.bg.ignoresSafeArea())
    }

    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .font(AppFont.headline)
                .foregroundStyle(AppTheme.accent700)
            Spacer()
            Text("Supabase Auth")
                .font(AppFont.title2)
                .foregroundStyle(AppTheme.text)
            Spacer()
            Color.clear.frame(width: 56, height: 1)
        }
        .padding(.horizontal, AppTheme.space4)
        .padding(.top, AppTheme.space6 + AppTheme.space2)
        .padding(.bottom, AppTheme.space3)
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
