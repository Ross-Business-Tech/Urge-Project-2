// Turning stored values into text for an input box, and typed text back into stored values. Built by M0.
//
// Money is whole dollars (cents allowed). Percentages are STORED as decimals (6.5% is 0.065) but SHOWN and TYPED as
// percentages, so the person editing never has to think about decimals. Dates are YYYY-MM-DD.
// A field may carry limits ({ min, max, integer }); without them, money and numbers must stay within a trillion and
// percentages within -100% to 100%.

import { isValidDate } from './projectStage.js'

export const isEmpty = (value) => value === null || value === undefined || value === ''

const MAGNITUDE = 1e12
const PLAIN = /^[-+]?(\d+(\.\d*)?|\.\d+)$/
const GROUPED = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/ // 1,234 and 1,234.50 but NOT 1,5 or 1,2,3

// Parse a number the way a person types it: "$250,000", "1 250", "-4,000.50", "(4,000)".
// Commas (or spaces) must group thousands; "1,5" is refused instead of silently becoming 15.
function parseNumber(text) {
  let t = text.trim().replace(/\$/g, '').replace(/\s+/g, ',')
  let negative = false
  if (/^\(.*\)$/.test(t)) {
    negative = true
    t = t.slice(1, -1)
  }
  if (!PLAIN.test(t) && !GROUPED.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

// Is this number allowed for a field of this type? Returns a plain message if not, or null. Works on STORED values
// (so a percentage is a decimal).
export function limitError(type, value, limits = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.'
  if (limits.integer && !Number.isInteger(value)) return 'Enter a whole number.'
  const lo = typeof limits.min === 'number' ? limits.min : type === 'percent' ? -1 : -MAGNITUDE
  const hi = typeof limits.max === 'number' ? limits.max : type === 'percent' ? 1 : MAGNITUDE
  if (value >= lo && value <= hi) return null
  if (type === 'percent') return `Enter a percentage between ${Number((lo * 100).toPrecision(6))}% and ${Number((hi * 100).toPrecision(6))}%.`
  const bounded = typeof limits.min === 'number' || typeof limits.max === 'number'
  if (typeof limits.min === 'number' && typeof limits.max !== 'number') return `Enter a number of ${lo.toLocaleString('en-US')} or more.`
  if (bounded) return `Enter a number between ${lo.toLocaleString('en-US')} and ${hi.toLocaleString('en-US')}.`
  return 'That number is too large.'
}

// What to put in the input box for a stored value.
export function formatForInput(type, value) {
  if (isEmpty(value)) return ''
  switch (type) {
    case 'dollars':
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(value)
    case 'percent':
      return typeof value === 'number' ? String(Number((value * 100).toFixed(6))) : String(value)
    default:
      return String(value)
  }
}

// Read typed text. Returns { value } (value may be null for "empty") or { error: 'plain message' }.
export function parseInput(type, text, limits = {}) {
  const t = typeof text === 'string' ? text.trim() : ''
  if (t === '') return { value: null }
  const checked = (value) => {
    const problem = limitError(type, value, limits)
    return problem ? { error: problem } : { value }
  }
  switch (type) {
    case 'dollars': {
      const n = parseNumber(t)
      return n === null ? { error: 'Enter a dollar amount, such as 250,000.' } : checked(n)
    }
    case 'number': {
      const n = parseNumber(t)
      return n === null ? { error: 'Enter a number.' } : checked(n)
    }
    case 'percent': {
      const n = parseNumber(t.replace(/%$/, ''))
      return n === null ? { error: 'Enter a percentage, such as 6.5.' } : checked(Number((n / 100).toFixed(10)))
    }
    case 'date':
      return isValidDate(t) ? { value: t } : { error: 'Enter a real date, such as 2026-03-31.' }
    case 'yearMonth':
      return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(t) ? { value: t } : { error: 'Enter a year (2026) or a year and month (2026-03).' }
    case 'boolean':
      if (/^(yes|true)$/i.test(t)) return { value: true }
      if (/^(no|false)$/i.test(t)) return { value: false }
      return { error: 'Choose yes or no.' }
    default:
      return { value: t.slice(0, 500) }
  }
}
