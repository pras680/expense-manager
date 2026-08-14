import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { canGoBack } from '../lib/navigation'

// A swipe must start within this many pixels of the left edge. Restricting to
// the edge is what keeps the gesture from stealing ordinary horizontal drags,
// and it matches the iOS system gesture users already expect.
const EDGE_ZONE_PX = 30
const MIN_DISTANCE_PX = 60
// Rightward travel must dominate vertical travel, or a diagonal scroll would
// register as a back swipe.
const MIN_HORIZONTAL_RATIO = 2
const MAX_DURATION_MS = 800

/** True if the touch began inside something the user can scroll sideways. */
function startedInHorizontalScroller(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== document.body) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = getComputedStyle(node).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

/**
 * Edge-swipe-right to go back.
 *
 * iOS suppresses its own back-swipe once the app is installed to the home
 * screen (display: standalone), so in the PWA there is otherwise no gesture to
 * leave a screen — only the header button.
 */
export function useSwipeBack() {
  const navigate = useNavigate()

  useEffect(() => {
    let startX = 0
    let startY = 0
    let startedAt = 0
    let tracking = false

    function onTouchStart(e: TouchEvent) {
      // Multi-touch is a pinch/zoom, never a back swipe.
      if (e.touches.length !== 1) {
        tracking = false
        return
      }
      const touch = e.touches[0]
      if (touch.clientX > EDGE_ZONE_PX) {
        tracking = false
        return
      }
      if (startedInHorizontalScroller(e.target)) {
        tracking = false
        return
      }
      startX = touch.clientX
      startY = touch.clientY
      startedAt = Date.now()
      tracking = true
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return
      tracking = false

      const touch = e.changedTouches[0]
      if (!touch) return

      const dx = touch.clientX - startX
      const dy = Math.abs(touch.clientY - startY)
      if (dx < MIN_DISTANCE_PX) return
      if (dx < dy * MIN_HORIZONTAL_RATIO) return
      if (Date.now() - startedAt > MAX_DURATION_MS) return

      if (canGoBack()) navigate(-1)
    }

    function onTouchCancel() {
      tracking = false
    }

    // Passive: the handlers never preventDefault, so this keeps scrolling smooth.
    const opts = { passive: true } as const
    window.addEventListener('touchstart', onTouchStart, opts)
    window.addEventListener('touchend', onTouchEnd, opts)
    window.addEventListener('touchcancel', onTouchCancel, opts)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [navigate])
}
