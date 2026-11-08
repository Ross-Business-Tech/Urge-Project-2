// Months for the transition checks (M3T). A month is a whole number counted from year 0, so "the next month" is +1.
//
// The timeline in the applicant workbook asks for years only; a month may be added where known. A year on its own is
// read as the middle of that year (July) and marked as approximate, so the screen can say "around 2027".

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "2026-06" and "2026-06-30" are the same month (as in the shared calculators). Returns null for anything else.
export function monthIndex(text) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof text === 'string' ? text.trim() : '')
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

// A timeline date: "2027-06", "2027-06-30", 2027 or "2027". Returns { idx, approx } or null.
export function timelineMonth(value) {
  const exact = monthIndex(value)
  if (exact !== null) return { idx: exact, approx: false }
  const year = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value.trim()) : null
  if (Number.isInteger(year) && year >= 1900 && year <= 2200) return { idx: year * 12 + 6, approx: true }
  return null
}

export const monthKey = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`

// "June 2027", or "around 2027" when only the year is known.
export function monthText(idx, approx = false) {
  if (!Number.isInteger(idx)) return 'an unknown date'
  return approx ? `around ${Math.floor(idx / 12)}` : `${MONTH_NAMES[idx % 12]} ${Math.floor(idx / 12)}`
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
