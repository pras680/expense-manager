import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ReceiptsProvider } from './hooks/useReceipts'
import { SettingsProvider } from './hooks/useSettings'
import { SignInPage } from './pages/SignInPage'
import { RegisterPage } from './pages/RegisterPage'
import { LandingPage } from './pages/LandingPage'
import { ReceiptsListPage } from './pages/ReceiptsListPage'
import { AddReceiptPage } from './pages/AddReceiptPage'
import { EditReceiptPage } from './pages/EditReceiptPage'
import { ReportsOverviewPage } from './pages/ReportsOverviewPage'
import { ReportsByCategoryPage } from './pages/ReportsByCategoryPage'
import { ReportsCategoriesPage } from './pages/ReportsCategoriesPage'
import { ReportsMonthlyPage } from './pages/ReportsMonthlyPage'
import { ReportsMonthDetailPage } from './pages/ReportsMonthDetailPage'
import { SettingsPage } from './pages/SettingsPage'
import { SmsSetupPage } from './pages/SmsSetupPage'
import { CategoriesSetupPage } from './pages/CategoriesSetupPage'
import { GmailSetupPage } from './pages/GmailSetupPage'
import { GmailScanLogPage } from './pages/GmailScanLogPage'
import { useSwipeBack } from './hooks/useSwipeBack'

/** Renders nothing; exists so the gesture hook sits inside the router. */
function SwipeBackLayer() {
  useSwipeBack()
  return null
}

function AuthGate() {
  const { session, loading } = useAuth()
  // Pre-auth screens sit outside the router (it only mounts once signed in), so
  // they swap on local state rather than routes.
  const [showRegister, setShowRegister] = useState(false)

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-neutral-500">Loading…</div>
  }

  if (!session) {
    return showRegister
      ? <RegisterPage onBackToSignIn={() => setShowRegister(false)} />
      : <SignInPage onRegister={() => setShowRegister(true)} />
  }

  return (
    // key={session.userId} is load-bearing: without it, signing in as a second
    // user without first passing through a null session would reuse the same
    // provider instances, leaving the previous user's receipts and currency in
    // state until something happened to refetch them.
    <BrowserRouter key={session.userId}>
      <SwipeBackLayer />
      <SettingsProvider>
        <ReceiptsProvider>
          <div
            className="min-h-dvh bg-neutral-50 dark:bg-neutral-950"
            // viewport-fit=cover + black-translucent means the web view runs
            // under the iOS status bar when installed, so without the top inset
            // the page header sits behind the clock and battery and can't be
            // tapped. Padding (not margin) so the background still fills the
            // notch strip.
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))'
            }}
          >
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/add" element={<AddReceiptPage />} />
              <Route path="/receipts" element={<ReceiptsListPage />} />
              <Route path="/receipts/:id/edit" element={<EditReceiptPage />} />
              <Route path="/reports" element={<ReportsOverviewPage />} />
              <Route path="/reports/category/:category" element={<ReportsByCategoryPage />} />
              <Route path="/reports/categories" element={<ReportsCategoriesPage />} />
              <Route path="/reports/monthly" element={<ReportsMonthlyPage />} />
              <Route path="/reports/monthly/:month" element={<ReportsMonthDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/sms" element={<SmsSetupPage />} />
              <Route path="/settings/categories" element={<CategoriesSetupPage />} />
              <Route path="/settings/gmail" element={<GmailSetupPage />} />
              {/* Google redirects here after consent; same component reads ?code= */}
              <Route path="/settings/gmail/callback" element={<GmailSetupPage />} />
              <Route path="/settings/gmail/log" element={<GmailScanLogPage />} />
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
