// Turning one cell of a workbook into a value of a schema type. Built by M0, shared by the applicant-workbook importer
// and the T-12 template importer.

import { SOURCE_TYPES, LEASE_TYPES } from '../enums.js'

export const normalize = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const SOURCE_TYPE_BY_TEXT = new Map(
  [...SOURCE_TYPES.map((t) => [normalize(t.label), t.value]), ['gov debt', 'gov_debt'], ['non recoverable grant', 'nonrecoverable_grant']],
)
const LEASE_TYPE_BY_TEXT = new Map(LEASE_TYPES.map((t) => [normalize(t.label), t.value]))

// Excel stores a date as a day count. Files use one of two systems: counting from 1900 (the usual) or from 1904 (older Mac files).
export function excelDate(serial, is1904) {
  const base = is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  return new Date(base + Math.round(serial) * 86400000).toISOString().slice(0, 10)
}

function parseNumberText(text) {
  const cleaned = text.replace(/[$,\s]/g, '')
  const isPercent = cleaned.endsWith('%')
  const n = Number(isPercent ? cleaned.slice(0, -1) : cleaned)
  if (cleaned === '' || !Number.isFinite(n)) return null
  return isPercent ? n / 100 : n
}

// Turn one workbook cell into a value of the schema type. Returns { value, error?, bad?, note? }.
export function convert(type, cell, is1904 = false) {
  if (!cell) return { value: null }
  if (cell.kind === 'error') return { value: null, error: cell.value }
  let v = cell.value
  // A formula that comes out as 0 or empty is a calculation, not something the applicant entered.
  if (cell.formula && (v === 0 || v === '')) return { value: null }
  if (typeof v === 'string') {
    v = v.trim()
    if (v === '') return { value: null }
  }
  switch (type) {
    case 'number':
    case 'dollars':
    case 'percent': {
      if (typeof v === 'number') return { value: v }
      const n = typeof v === 'string' ? parseNumberText(v) : null
      return n === null ? { value: null, bad: true } : { value: n }
    }
    case 'boolean': {
      if (v === 1 || /^yes$/i.test(String(v))) return { value: true }
      if (v === 2 || /^no$/i.test(String(v))) return { value: false }
      return { value: null, bad: true }
    }
    case 'date':
      return { value: typeof v === 'number' && v > 20000 ? excelDate(v, is1904) : String(v) }
    case 'yearMonth':
      if (typeof v === 'number' && v >= 1900 && v < 3000) return { value: String(v) }
      return { value: typeof v === 'number' && v > 20000 ? excelDate(v, is1904).slice(0, 7) : String(v) }
    case 'sourceType': {
      const known = SOURCE_TYPE_BY_TEXT.get(normalize(v))
      return known ? { value: known } : { value: String(v), note: `Unrecognized source type "${v}"` }
    }
    case 'leaseType': {
      const known = LEASE_TYPE_BY_TEXT.get(normalize(v))
      return known ? { value: known } : { value: String(v), note: `Unrecognized lease type "${v}"` }
    }
    default:
      return { value: String(v) }
  }
}

export const EXPECTED = { number: 'a number', dollars: 'a dollar amount', percent: 'a percentage', boolean: 'a yes or no' }
