import { buildReview, serializeReview, reviewFileName } from './modules/shared/index.js'

// The review currently on screen, kept outside the component tree so it is still there if the screen crashes.
// The "Save what I have" button on the crash screen reads it.
export const rescueStore = { current: null }

// Download a review as a file. Nothing is sent anywhere.
export function downloadReview(result) {
  const blob = new Blob([serializeReview(buildReview(result))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = reviewFileName()
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
