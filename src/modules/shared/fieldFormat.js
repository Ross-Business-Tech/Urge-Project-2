// Turning stored values into text for an input box, and typed text back into stored values. Built by M0.
//
// Money is whole dollars (cents allowed). Percentages are STORED as decimals (6.5% is 0.065) but SHOWN and TYPED as
// percentages, so the person editing never has to think about decimals. Dates are YYYY-MM-DD.

import { isValidDate } from './projectStage.js'

export const isEmpty = (value) => value === null || value === undefined || value === ''

const MAX_ABS = 1e15

// Parse a number the way a person types it: "$250,000", "1 250", "-4,000.50", "(4,000)".
function parseNumber(text) {
  let t = text.trim().replace(/[$,\s]/g, '')
  let negative = false
  if (/^\(.*\)$/.test(t)) {
    negative = true
    t = t.slice(1, -1)
  }
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) return null
  return negative ? -n : n
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
export function parseInput(type, text) {
  const t = typeof text === 'string' ? text.trim() : ''
  if (t === '') return { value: null }
  switch (type) {
    case 'dollars': {
      const n = parseNumber(t)
      return n === null ? { error: 'Enter a dollar amount, such as 250,000.' } : { value: n }
    }
    case 'number': {
      const n = parseNumber(t)
      return n === null ? { error: 'Enter a number.' } : { value: n }
    }
    case 'percent': {
      const n = parseNumber(t.replace(/%$/, ''))
      if (n === null) return { error: 'Enter a percentage, such as 6.5.' }
      return { value: Number((n / 100).toFixed(10)) }
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
