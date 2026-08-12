import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ReceiptsProvider } from './hooks/useReceipts'
import { SettingsProvider } from './hooks/useSettings'
import { SignInPage } from './pages/SignInPage'
import { ReceiptsListPage } from './pages/ReceiptsListPage'
import { AddReceiptPage } from './pages/AddReceiptPage'
import { EditReceiptPage } from './pages/EditReceiptPage'
import { ReportsOverviewPage } from './pages/ReportsOverviewPage'
import { ReportsByCategoryPage } from './pages/ReportsByCategoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { SmsSetupPage } from './pages/SmsSetupPage'
import { GmailSetupPage } from './pages/GmailSetupPage'

function AuthGate() {
  const { session, loading } = useAuth()

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-neutral-500">Loading…</div>
  }

  if (!session) {
    return <SignInPage />
  }

  return (
    // key={session.userId} is load-bearing: without it, signing in as a second
    // user without first passing through a null session would reuse the same
    // provider instances, leaving the previous user's receipts and currency in
    // state until something happened to refetch them.
    <BrowserRouter key={session.userId}>
      <SettingsProvider>
        <ReceiptsProvider>
          <div
            className="min-h-dvh bg-neutral-50 dark:bg-neutral-950"
            style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
          >
            <Routes>
              <Route path="/" element={<ReceiptsListPage />} />
              <Route path="/add" element={<AddReceiptPage />} />
              <Route path="/receipts/:id/edit" element={<EditReceiptPage />} />
              <Route path="/reports" element={<ReportsOverviewPage />} />
              <Route path="/reports/category/:category" element={<ReportsByCategoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/sms" element={<SmsSetupPage />} />
              <Route path="/settings/gmail" element={<GmailSetupPage />} />
              {/* Google redirects here after consent; same component reads ?code= */}
              <Route path="/settings/gmail/callback" element={<GmailSetupPage />} />
            </Routes>
          </div>
          <NavBar />
        </ReceiptsProvider>
      </SettingsProvider>
    </BrowserRouter>
  )
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

export default App
