// Where the team's benchmarks are kept between visits: this browser's own storage, on this device only. Nothing is sent anywhere.
// Browsers can refuse storage (private windows, blocked site data), so every read and write is guarded and the app works without it.

import { parseEntries, serializeEntries } from './modules/shared/index.js'

export const STORAGE_KEY = 'deal-review-benchmarks'

// What was kept on this device: { entries, changedAt }. changedAt is null when nothing was kept or it was kept without a date.
export function loadSaved(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY)
    if (!text) return { entries: [], changedAt: null }
    const read = parseEntries(text)
    return read.ok ? { entries: read.entries, changedAt: read.changedAt } : { entries: [], changedAt: null }
  } catch {
    return { entries: [], changedAt: null }
  }
}

// Returns true when the list was kept on this device.
export function saveEntries(storage, entries, changedAt = null) {
  try {
    if (!storage) return false
    storage.setItem(STORAGE_KEY, serializeEntries(entries, '', changedAt))
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

// Record a change to the list: work out the date it was changed and keep it on this device.
// `when` is the date to record: left out (undefined) it is now; given as null it is "not recorded" (a file that had no date).
export function commitChange(storage, list, when, now = () => new Date().toISOString()) {
  const changedAt = when === undefined ? now() : when
  return { changedAt, kept: saveEntries(storage, list, changedAt) }
}
