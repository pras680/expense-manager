import * as pdfjsLib from 'pdfjs-dist'
// Vite's ?url suffix bundles the worker as its own asset and gives back the
// built URL to load it from — self-hosted rather than pointed at a CDN, so
// this keeps working offline/without a third-party dependency at runtime,
// consistent with how the rest of the app avoids external script hosts.
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// Receipts are essentially always one page; rendering only the first keeps
// this fast and avoids asking the user to pick a page for the overwhelmingly
// common case. Matches the same downstream pipeline a camera photo goes
// through — parse-receipt only ever looks at one image either way.
const RENDER_SCALE = 2 // ~144 DPI equivalent off a 72 DPI PDF page — sharp enough for the OCR/vision parser without being huge.

/** Renders a PDF's first page to a PNG blob, entirely in the browser. */
export async function renderPdfFirstPageToBlob(file: File): Promise<Blob> {
  const data = await file.arrayBuffer()
  // destroy() (full worker/resource teardown) lives on the loading task
  // returned here, not on the PDFDocumentProxy .promise resolves to — that
  // object only exposes the weaker cleanup(), which just clears caches.
  const loadingTask = pdfjsLib.getDocument({ data })
  try {
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: RENDER_SCALE })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    if (!canvas.getContext('2d')) throw new Error('Canvas not supported on this device')

    await page.render({ canvas, viewport }).promise

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Failed to render PDF page')
    return blob
  } finally {
    await loadingTask.destroy()
  }
}
