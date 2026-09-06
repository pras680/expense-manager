import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Receipt } from '../types/receipt'
import { CategoryBadge } from './CategoryBadge'
import { ConfirmDialog } from './ConfirmDialog'
import { reportingTotal, reportingCurrency, needsReview, hasMergedSources, receiptSourceLabels } from '../lib/receiptShape'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { useReceipts } from '../hooks/useReceipts'
import { deleteReceipt, markReceiptsReviewed } from '../lib/supabaseClient'

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatDate(iso: string | null) {
  if (!iso) return 'No date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'No date'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Width of a fully-revealed action panel, and how far a drag has to travel
// past the midpoint before release snaps it open rather than springing shut —
// same "slop then commit" shape as useSwipeBack's own edge gesture.
const ACTION_WIDTH = 88
const OPEN_THRESHOLD = ACTION_WIDTH / 2
const TAP_SLOP = 8

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const total = reportingTotal(receipt)
  const currency = reportingCurrency(receipt)
  const { nameFor } = useSettings()
  const { session } = useAuth()
  const { removeReceiptLocal, patchReceiptLocal } = useReceipts()
  // Only label other people's receipts — tagging every one of your own with
  // "You" is noise on the screen you look at most.
  const owner = nameFor(receipt.userId)
  const showOwner = owner !== null && owner !== 'You'
  const unreviewed = needsReview(receipt)
  const sourceLabel = receipt.source === 'sms' ? 'SMS'
    : receipt.source === 'gmail' ? 'Email'
    : receipt.source === 'photo' ? 'Photo' : null
  const merged = hasMergedSources(receipt)

  // Swipe left reveals Approve (only meaningful for a receipt still awaiting
  // review); swipe right reveals Delete (always available, same guard as the
  // Edit page's own delete button). offset < 0 -> approve panel on the right,
  // offset > 0 -> delete panel on the left.
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [approving, setApproving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const offsetRef = useRef(0)
  const startRef = useRef({ x: 0, y: 0 })
  const baseOffsetRef = useRef(0)
  const axisRef = useRef<'horizontal' | 'vertical' | null>(null)
  const draggedRef = useRef(false)
  const suppressClickRef = useRef(false)

  const minOffset = unreviewed ? -ACTION_WIDTH : 0

  function applyOffset(next: number) {
    offsetRef.current = next
    setOffset(next)
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return
    // Keeps a drag that starts near the screen's left edge from also being
    // picked up by useSwipeBack's window-level back-gesture listener.
    e.stopPropagation()
    const t = e.touches[0]
    startRef.current = { x: t.clientX, y: t.clientY }
    baseOffsetRef.current = offsetRef.current
    axisRef.current = null
    draggedRef.current = false
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startRef.current.x
    const dy = t.clientY - startRef.current.y
    if (axisRef.current === null) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      if (axisRef.current === 'horizontal') {
        setDragging(true)
        draggedRef.current = true
      }
    }
    if (axisRef.current !== 'horizontal') return
    applyOffset(clamp(baseOffsetRef.current + dx, minOffset, ACTION_WIDTH))
  }

  function onTouchEnd() {
    if (axisRef.current === 'horizontal') {
      const current = offsetRef.current
      const resting = current <= -OPEN_THRESHOLD ? minOffset : current >= OPEN_THRESHOLD ? ACTION_WIDTH : 0
      applyOffset(resting)
      if (draggedRef.current) suppressClickRef.current = true
    }
    setDragging(false)
    axisRef.current = null
  }

  function onTouchCancel() {
    applyOffset(baseOffsetRef.current)
    setDragging(false)
    axisRef.current = null
  }

  function onContentClick(e: React.MouseEvent) {
    // A drag that ended with the panel open, or that just snapped shut,
    // wasn't a tap — swallow the click rather than navigating into Edit.
    // A tap while a panel is already open closes it instead of navigating.
    if (suppressClickRef.current || offsetRef.current !== 0) {
      e.preventDefault()
      suppressClickRef.current = false
      if (offsetRef.current !== 0) applyOffset(0)
    }
  }

  async function handleApprove() {
    if (!session?.userId || approving) return
    setApproving(true)
    try {
      await markReceiptsReviewed([receipt.id], session.userId)
      patchReceiptLocal(receipt.id, { reviewedAt: new Date().toISOString() })
      applyOffset(0)
    } finally {
      setApproving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteReceipt(receipt.id)
      removeReceiptLocal(receipt.id)
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-y-0 left-0" style={{ width: ACTION_WIDTH }}>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="flex h-full w-full items-center justify-center bg-red-600 text-sm font-semibold text-white"
        >
          Delete
        </button>
      </div>
      {unreviewed && (
        <div className="absolute inset-y-0 right-0" style={{ width: ACTION_WIDTH }}>
          <button
            type="button"
            onClick={handleApprove}
            disabled={approving}
            className="flex h-full w-full items-center justify-center bg-green-600 text-sm font-semibold text-white disabled:opacity-70"
          >
            {approving ? '…' : 'Approve'}
          </button>
        </div>
      )}

      <Link
        to={`/receipts/${receipt.id}/edit`}
        onClick={onContentClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease-out',
          touchAction: 'pan-y'
        }}
        className={`relative flex items-center justify-between gap-3 rounded-xl border px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${
          unreviewed
            ? 'border-amber-400 bg-amber-50 dark:border-amber-600/60 dark:bg-amber-950/30'
            : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-neutral-900 dark:text-neutral-50">
            {receipt.merchant || 'Unknown merchant'}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span>{formatDate(receipt.date)}</span>
            {receipt.cardLast4 && <span>•••• {receipt.cardLast4}</span>}
          </div>
          {(receipt.category || showOwner || receipt.visibility === 'private' || sourceLabel || unreviewed || merged) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {unreviewed && (
                <span className="inline-block rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Check
                </span>
              )}
              {merged && (
                <span
                  title={`Combined data from ${receiptSourceLabels(receipt).join(' + ')}`}
                  className="inline-block rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-800 dark:bg-accent-900/50 dark:text-accent-300"
                >
                  🔗 Merged
                </span>
              )}
              {receipt.category && <CategoryBadge category={receipt.category} />}
              {sourceLabel && (
                <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {sourceLabel}
                </span>
              )}
              {showOwner && (
                <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {owner}
                </span>
              )}
              {receipt.visibility === 'private' && (
                <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                  Private
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right font-semibold text-neutral-900 dark:text-neutral-50">
          {total != null ? formatMoney(total, currency) : '—'}
        </div>
      </Link>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this receipt?"
          message={`This will permanently remove "${receipt.merchant || 'this receipt'}". This can't be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => {
            setConfirmingDelete(false)
            applyOffset(0)
          }}
        />
      )}
    </div>
  )
}
