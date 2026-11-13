import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Wordmark } from '../components/Wordmark'

export function SignInPage({ onRegister }: { onRegister: () => void }) {
  const { signIn, expiredMessage } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col justify-center px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto w-full max-w-sm">
        <Wordmark as="h1" size="lg" />
        <p className="mt-4 text-[15px] text-muted">
          Every receipt in the household, in one place. Sign in to pick up where you left off.
        </p>

        {/* Explains an involuntary sign-out, rather than silently dumping the
            user back here with no idea why their session ended. */}
        {expiredMessage && !error && (
          <div className="mt-4 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
            {expiredMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && (
            <div role="alert" className="rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium text-muted">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium text-muted">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              required
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="mt-2 min-h-14 rounded-full bg-accent text-base font-semibold text-on-accent disabled:opacity-60 active:opacity-80"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <button
          type="button"
          onClick={onRegister}
          className="mt-3 min-h-11 w-full text-center text-sm font-medium text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          New here? Create an account
        </button>
      </div>
    </div>
  )
}
