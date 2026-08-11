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

function AuthGate() {
  const { session, loading } = useAuth()

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-neutral-500">Loading…</div>
  }

  if (!session) {
    return <SignInPage />
  }

  return (
    <BrowserRouter>
      <ReceiptsProvider>
        <SettingsProvider>
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
            </Routes>
          </div>
          <NavBar />
        </SettingsProvider>
      </ReceiptsProvider>
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
