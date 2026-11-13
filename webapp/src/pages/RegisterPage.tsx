import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

const MIN_PASSWORD_LENGTH = 8

export function RegisterPage({ onBackToSignIn }: { onBackToSignIn: () => void }) {
  const { register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [householdName, setHouseholdName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setBusy(true)
    try {
      // Signs in on success, so the auth gate swaps to the app on its own.
      await register({ email, password, displayName, householdName, inviteCode })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col justify-center px-6 py-8"
      style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))', paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-[30px] leading-none font-bold tracking-tight text-ink">Create your account</h1>
        <p className="mt-3 text-[15px] text-muted">
          You'll get your own household for tracking expenses.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && (
            <div role="alert" className="rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium text-muted">Your name</span>
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
              className="field"
            />
          </label>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              className="field"
              required
            />
            <span className="px-1 text-[13px] text-muted">
              At least {MIN_PASSWORD_LENGTH} characters.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium text-muted">Household name</span>
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              placeholder="Optional — defaults to your name"
              className="field"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium text-muted">Invite code</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="field"
              required
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="mt-2 min-h-14 rounded-full bg-accent text-base font-semibold text-on-accent disabled:opacity-60 active:opacity-80"
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={onBackToSignIn}
          className="mt-3 min-h-11 w-full text-center text-sm font-medium text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          Already have an account? Sign in
        </button>
      </div>
    </div>
  )
}
