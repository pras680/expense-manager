import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { NavBar, NAV_CLEARANCE } from './components/NavBar'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ReceiptsProvider } from './hooks/useReceipts'
import { SettingsProvider } from './hooks/useSettings'
import { SignInPage } from './pages/SignInPage'
import { RegisterPage } from './pages/RegisterPage'
import { LandingPage } from './pages/LandingPage'
import { ReceiptsListPage } from './pages/ReceiptsListPage'
import { AddReceiptPage } from './pages/AddReceiptPage'
import { EditReceiptPage } from './pages/EditReceiptPage'
import { ReceiptDetailPage } from './pages/ReceiptDetailPage'
import { InsightsPage } from './pages/InsightsPage'
import { CategoryPage } from './pages/CategoryPage'
import { MerchantPage } from './pages/MerchantPage'
import { MonthsPage } from './pages/MonthsPage'
import { SettingsPage } from './pages/SettingsPage'
import { HouseholdPage } from './pages/HouseholdPage'
import { SmsSetupPage } from './pages/SmsSetupPage'
import { CategoriesSetupPage } from './pages/CategoriesSetupPage'
import { GmailSetupPage } from './pages/GmailSetupPage'
import { GmailScanLogPage } from './pages/GmailScanLogPage'
import { SmsScanLogPage } from './pages/SmsScanLogPage'
import { useSwipeBack } from './hooks/useSwipeBack'
import { ChatProvider } from './hooks/useChat'
import { TalkToMe } from './components/TalkToMe'
import { ThemeProvider } from './hooks/useTheme'
import { ALL_TIME } from './lib/insights'

/** Renders nothing; exists so the gesture hook sits inside the router. */
function SwipeBackLayer() {
  useSwipeBack()
  return null
}

/** Old month-detail URL: the month is now a selection on the Insights page. */
function MonthRedirect() {
  const { month } = useParams<{ month: string }>()
  return <Navigate to={`/reports?m=${encodeURIComponent(month ?? '')}`} replace />
}

function AuthGate() {
  const { session, loading } = useAuth()
  // Pre-auth screens sit outside the router (it only mounts once signed in), so
  // they swap on local state rather than routes.
  const [showRegister, setShowRegister] = useState(false)

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>
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
          {/* Above the routes, not just around the chat panel: the Ask bar on
              Home opens the same conversation the floating launcher does. */}
          <ChatProvider>
            <div
              className="min-h-dvh bg-bg"
              // viewport-fit=cover + black-translucent means the web view runs
              // under the iOS status bar when installed, so without the top
              // inset the page header sits behind the clock and battery and
              // can't be tapped. Padding (not margin) so the background still
              // fills the notch strip.
              style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: NAV_CLEARANCE }}
            >
              {/* One phone-width column at every screen size: the app is
                  designed mobile-first, and stretched edge to edge on a
                  desktop the same cards become unreadably wide. */}
              <div className="mx-auto w-full max-w-xl">
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/add" element={<AddReceiptPage />} />
                  <Route path="/receipts" element={<ReceiptsListPage />} />
                  <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
                  <Route path="/receipts/:id/edit" element={<EditReceiptPage />} />
                  {/* Insights and its drill-down: month -> category -> merchant -> receipt. */}
                  <Route path="/reports" element={<InsightsPage />} />
                  <Route path="/reports/category/:category" element={<CategoryPage />} />
                  <Route path="/reports/merchant/:merchant" element={<MerchantPage />} />
                  <Route path="/reports/monthly" element={<MonthsPage />} />
                  {/* Pre-redesign URLs, kept so old bookmarks and links still land somewhere sensible. */}
                  <Route path="/reports/monthly/:month" element={<MonthRedirect />} />
                  <Route path="/reports/categories" element={<Navigate to={`/reports?m=${ALL_TIME}`} replace />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/household" element={<HouseholdPage />} />
                  <Route path="/settings/sms" element={<SmsSetupPage />} />
                  <Route path="/settings/sms/log" element={<SmsScanLogPage />} />
                  <Route path="/settings/categories" element={<CategoriesSetupPage />} />
                  <Route path="/settings/gmail" element={<GmailSetupPage />} />
                  {/* Google redirects here after consent; same component reads ?code= */}
                  <Route path="/settings/gmail/callback" element={<GmailSetupPage />} />
                  <Route path="/settings/gmail/log" element={<GmailScanLogPage />} />
                </Routes>
              </div>
            </div>
            <NavBar />
            <TalkToMe />
          </ChatProvider>
        </ReceiptsProvider>
      </SettingsProvider>
    </BrowserRouter>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
