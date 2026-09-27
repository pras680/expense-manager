import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useSettings } from '../hooks/useSettings'
import { useReceipts } from '../hooks/useReceipts'
import { EXPENSE_CATEGORIES } from '../lib/categories'
import { addHouseholdCategory, deleteHouseholdCategory, listHouseholdCategories, renameHouseholdCategory, type HouseholdCategory } from '../lib/supabaseClient'

export function CategoriesSetupPage() {
  const { householdId, refreshCategories } = useSettings()
  const { refresh: refreshReceipts } = useReceipts()
  const [categories, setCategories] = useState<HouseholdCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<HouseholdCategory | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      setCategories(await listHouseholdCategories())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const builtInLower = new Set(EXPENSE_CATEGORIES.map((c) => c.toLowerCase()))
  const customLower = new Set(categories.map((c) => c.name.toLowerCase()))

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (builtInLower.has(trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already a built-in category.`)
      return
    }
    if (customLower.has(trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`)
      return
    }
    if (!householdId) {
      setError('Join a household before adding categories.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addHouseholdCategory(trimmed, householdId)
      setName('')
      await refresh()
      await refreshCategories()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function startEditing(c: HouseholdCategory) {
    setEditingId(c.id)
    setEditName(c.name)
    setError(null)
  }

  async function handleRename(c: HouseholdCategory) {
    const trimmed = editName.trim()
    if (!trimmed || trimmed === c.name) {
      setEditingId(null)
      return
    }
    if (builtInLower.has(trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already a built-in category.`)
      return
    }
    // Case-only changes ("pet supplies" -> "Pet Supplies") are fine — it's
    // only a clash when a *different* custom category already has the name.
    if (categories.some((o) => o.id !== c.id && o.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameHouseholdCategory(c.id, trimmed)
      setEditingId(null)
      await refresh()
      await refreshCategories()
      // Receipts filed under the old name were renamed server-side too.
      await refreshReceipts()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteHouseholdCategory(deleting.id)
      setDeleting(null)
      await refresh()
      await refreshCategories()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <PageHeader title="Categories" backTo="/settings" />
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Add categories specific to your household. They show up alongside the built-in ones when
        editing a receipt, and once you've used one on a receipt from a merchant, future SMS and
        email imports from that merchant will apply it automatically. Renaming one also renames it
        on every receipt already using it.
      </p>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          placeholder="e.g. Pet Supplies"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-accent-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? '…' : 'Add'}
        </button>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        Your household's categories
      </h2>
      {loading ? (
        <p className="mt-2 text-sm text-neutral-500">Loading…</p>
      ) : categories.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          None yet — the built-in categories are still available everywhere.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              {editingId === c.id ? (
                <>
                  <input
                    type="text"
                    value={editName}
                    autoFocus
                    aria-label={`Rename ${c.name}`}
                    onChange={(e) => { setEditName(e.target.value); setError(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(c)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-base dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <div className="flex shrink-0 gap-3">
                    <button
                      onClick={() => handleRename(c)}
                      disabled={busy || !editName.trim()}
                      className="text-sm font-semibold text-accent-700 disabled:opacity-60 dark:text-accent-400"
                    >
                      {busy ? '…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                      className="text-sm font-medium text-neutral-500"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">{c.name}</span>
                  <div className="flex shrink-0 gap-4">
                    <button onClick={() => startEditing(c)} className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                      Rename
                    </button>
                    <button onClick={() => setDeleting(c)} className="text-sm font-medium text-red-600">
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Remove this category?"
          message={`"${deleting.name}" won't be offered for new receipts. Receipts already using it keep it — nothing is changed retroactively.`}
          confirmLabel="Remove"
          busy={busy}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
