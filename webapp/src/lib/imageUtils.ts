const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

// Downscale + re-encode as JPEG in-browser (Canvas API — identical behavior on
// iOS Safari and Android Chrome) so phone camera photos (often 3-8MB) stay
// well under both the Storage upload size and the parse-receipt request body
// limit, and to keep Gemini's per-request image tokens/cost down.
//
// Takes a Blob rather than a File so a PDF page rendered to canvas
// (pdfUtils.renderPdfFirstPageToBlob) can run through the exact same
// resize/encode path as a camera photo — one sizing policy, not two.
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported on this device')
  ctx.drawImage(bitmap, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Failed to encode image')
  return blob
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}
