import { useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import {
  addHouseholdMember,
  removeHouseholdMember,
  type AddedMember,
  type HouseholdMember
} from '../lib/supabaseClient'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, CardTitle, EmptyState, btn } from '../components/ui'

// Who shares this household's receipts, and adding or removing someone.
// Moved off the You page so that page stays a short list of rows.

export function HouseholdPage() {
  const { loading, members, refreshMembers } = useSettings()
  const { session } = useAuth()
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [added, setAdded] = useState<AddedMember | null>(null)
  const [removing, setRemoving] = useState<HouseholdMember | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    setAddBusy(true)
    setAddError(null)
    setAdded(null)
    try {
      const result = await addHouseholdMember(newEmail.trim(), newName.trim())
      setAdded(result)
      setNewEmail('')
      setNewName('')
      await refreshMembers()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddBusy(false)
    }
  }

  async function handleRemoveMember() {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await removeHouseholdMember(removing.userId)
      setRemoving(null)
      await refreshMembers()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6">
      <PageHeader title="Household" backTo="/settings" />
      <p className="px-1 text-[15px] text-muted">
        Household receipts are shared: everyone here can see and edit them. Receipts marked
        Private stay visible only to whoever added them.
      </p>

      <Card className="px-[18px] py-2">
        {members.length === 0 ? (
          <EmptyState>{loading ? 'Loading…' : 'No household members found.'}</EmptyState>
        ) : (
          <ul>
            {members.map((m) => (
              <li key={m.userId} className="flex min-h-[60px] items-center gap-3 border-b border-line last:border-b-0">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-2 font-display font-semibold text-ink"
                >
                  {(m.displayName ?? '?').trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-ink">
                    {m.displayName ?? 'Member'}
                    {m.userId === session?.userId && <span className="ml-1.5 text-[13px] font-normal text-muted">you</span>}
                  </span>
                  <span className="block text-[13px] text-muted capitalize">{m.role}</span>
                </span>
                {m.userId !== session?.userId && (
                  <button
                    type="button"
                    onClick={() => setRemoving(m)}
                    className="flex h-11 shrink-0 items-center px-2 text-sm font-medium text-red-600 dark:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Shown once. The server never stores a readable copy, so if this is
          lost the password has to be reset from the Supabase dashboard. */}
      {added && (
        <Card className="p-[18px] ring-2 ring-accent">
          <p className="font-display text-lg font-semibold text-ink">{added.displayName} can now sign in</p>
          {added.password ? (
            <>
              <p className="mt-1 text-sm text-muted">Send them these details. The password can't be shown again.</p>
              <code className="mt-3 block rounded-2xl bg-card-2 px-4 py-3 font-mono text-sm break-all text-ink">
                {added.email}<br />{added.password}
              </code>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">They already had an account, so their existing password still works.</p>
          )}
          <button type="button" onClick={() => setAdded(null)} className={`${btn.small} mt-3`}>Done</button>
        </Card>
      )}

      <Card className="px-[18px] pt-2 pb-[18px]">
        <CardTitle>Add someone</CardTitle>
        <form onSubmit={handleAddMember} className="flex flex-col gap-2.5">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="their@email.com"
            aria-label="Their email"
            required
            className="field bg-card-2!"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (optional)"
            aria-label="Their name"
            className="field bg-card-2!"
          />
          <button type="submit" disabled={addBusy} className={`${btn.primary} mt-1`}>
            {addBusy ? 'Adding…' : 'Add to household'}
          </button>
          {addError && <p className="text-[13px] text-red-600 dark:text-red-400">{addError}</p>}
        </form>
      </Card>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.displayName ?? 'this member'}?`}
          message="They lose access to household receipts. Their own receipts and their account are kept, so you can add them back later."
          confirmLabel="Remove"
          busy={removeBusy}
          onConfirm={handleRemoveMember}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
