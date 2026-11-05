import { buildReview, serializeReview, reviewFileName } from './modules/shared/index.js'

// The review currently on screen, kept outside the component tree so it is still there if the screen crashes.
// The "Save what I have" button on the crash screen reads it.
export const rescueStore = { current: null }

// Download bytes as a file. Nothing is sent anywhere.
export function downloadBytes(bytes, fileName, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadReview = (result) => downloadBytes(serializeReview(buildReview(result)), reviewFileName(), 'application/json')
