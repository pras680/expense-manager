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
        <h1 className="text-center text-2xl font-bold text-neutral-900 dark:text-neutral-50">Create your account</h1>
        <p className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
          You'll get your own household to start adding expenses to.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Your name</span>
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
              required
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              At least {MIN_PASSWORD_LENGTH} characters.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Household name</span>
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              placeholder="Optional — defaults to your name"
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Invite code</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
              required
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-lg bg-accent-700 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={onBackToSignIn}
          className="mt-4 w-full text-center text-sm text-accent-700 dark:text-accent-400"
        >
          Already have an account? Sign in
        </button>
      </div>
    </div>
  )
}
