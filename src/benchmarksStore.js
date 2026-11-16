// Where the team's benchmarks are kept between visits: this browser's own storage, on this device only. Nothing is sent anywhere.
// Browsers can refuse storage (private windows, blocked site data), so every read and write is guarded and the app works without it.

import { parseEntries, serializeEntries } from './modules/shared/index.js'

export const STORAGE_KEY = 'deal-review-benchmarks'

export function loadSaved(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY)
    if (!text) return []
    const read = parseEntries(text)
    return read.ok ? read.entries : []
  } catch {
    return []
  }
}

// Returns true when the list was kept on this device.
export function saveEntries(storage, entries) {
  try {
    if (!storage) return false
    storage.setItem(STORAGE_KEY, serializeEntries(entries))
    return true
  } catch {
    return false
  }
}

export function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
