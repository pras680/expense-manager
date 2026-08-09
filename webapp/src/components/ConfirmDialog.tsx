interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel, busy }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg bg-neutral-100 py-2.5 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
