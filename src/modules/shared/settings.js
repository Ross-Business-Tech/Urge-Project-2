// The adjustable settings from section 1f of the module spec. Built by M0; other modules read them.
// Percentages are stored as decimals (90% is 0.9), like everywhere else.

export const DEFAULT_SETTINGS = Object.freeze({
  minDscr: 1.2, // the lender's minimum DSCR
  noiVsUnderwritten: 1.0, // a month's NOI must be at least this share of the underwritten NOI (100%)
  consecutiveMonths: 3, // how many months in a row must pass to count as stable
  occupancyFloor: 0.9, // occupancy below this is a concern
  rentPremium: 0.1, // rent this far above market warrants a look (used with the market benchmarks from M2)
})

// What each setting is, for the screen: its label, kind of value, allowed range, and a plain-language hint.
export const SETTING_DEFS = [
  { key: 'minDscr', label: "Lender's minimum DSCR", type: 'number', min: 1, max: 5, hint: 'Income must cover loan payments at least this many times.' },
  { key: 'noiVsUnderwritten', label: 'NOI vs. underwritten', type: 'percent', min: 0.1, max: 2, hint: "A month's NOI must be at least this share of the underwritten NOI." },
  { key: 'consecutiveMonths', label: 'Consecutive months', type: 'number', min: 1, max: 12, integer: true, hint: 'How many months in a row must pass to count as stable.' },
  { key: 'occupancyFloor', label: 'Occupancy floor', type: 'percent', min: 0.1, max: 1, hint: 'Occupancy below this is a concern.' },
  { key: 'rentPremium', label: 'Rent premium over market', type: 'percent', min: 0, max: 1, hint: 'Rent this far above market warrants a look (needs the market benchmarks).' },
]

// Check one setting. Returns { value } or { error: 'plain message' }.
export function checkSetting(key, value) {
  const def = SETTING_DEFS.find((d) => d.key === key)
  if (!def) return { error: 'Unknown setting.' }
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'Enter a number.' }
  if (def.integer && !Number.isInteger(value)) return { error: 'Enter a whole number.' }
  if (value < def.min || value > def.max) {
    const show = (n) => (def.type === 'percent' ? `${Math.round(n * 100)}%` : String(n))
    return { error: `Enter a value between ${show(def.min)} and ${show(def.max)}.` }
  }
  return { value }
}

// Settings from a saved file: keep valid values, fall back to the default for anything missing or out of range.
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const def of SETTING_DEFS) {
    const checked = checkSetting(def.key, raw[def.key])
    if (!checked.error) out[def.key] = checked.value
  }
  return out
}
