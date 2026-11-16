// The unit types a rent benchmark can be for: the ones the loaded workbook holds (read from its unit mix table, the "Unit type"
// column on the Details tab), and the usual ones. Workbooks write the same type many ways ("1-bdr", "1 BR", "one bedroom"), so a
// type is always matched by its standard form (1br), never by the way it was typed.

import { normalizeUnitType } from '../shared/index.js'

export const STANDARD_TYPES = ['studio', '1br', '2br', '3br', '4br']

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// Studio first, then by bedroom count, then anything else alphabetically.
const rank = (type) => (type === 'studio' ? 0 : /^\d+br$/.test(type) ? Number.parseInt(type, 10) : 1000)
const bySize = (a, b) => rank(a) - rank(b) || a.localeCompare(b)

export const typeName = (type) => (type === 'studio' ? 'Studio' : /^\d+br$/.test(type) ? `${Number.parseInt(type, 10)} bedroom (${type})` : type)

// What the loaded projects hold: [{ type, units, written: ['1-bdr'] }], for every unit type with a rent entered.
// `units` counts the units in the rows of that type; `written` is how the workbook wrote it, when that differs from the standard form.
export function unitTypesIn(projects) {
  const found = new Map()
  for (const p of Array.isArray(projects) ? projects : []) {
    for (const r of p?.data?.residentialIncome?.rows ?? []) {
      const type = normalizeUnitType(r.unitType)
      if (!type) continue
      const entry = found.get(type) ?? { type, units: 0, written: [] }
      if (isNum(r.units) && r.units > 0) entry.units += r.units
      const text = String(r.unitType).trim()
      if (text.toLowerCase() !== type && !entry.written.includes(text)) entry.written.push(text)
      found.set(type, entry)
    }
  }
  return [...found.values()].sort((a, b) => bySize(a.type, b.type))
}

// The choices for the dropdown: the workbook's types first, then the standard types it does not have.
export function unitTypeChoices(workbookTypes) {
  const inWorkbook = (Array.isArray(workbookTypes) ? workbookTypes : []).map((t) => ({ ...t, label: `${typeName(t.type)}: ${t.units} ${t.units === 1 ? 'unit' : 'units'}${t.written.length ? `, written “${t.written.join('”, “')}”` : ''}` }))
  const have = new Set(inWorkbook.map((t) => t.type))
  const standard = STANDARD_TYPES.filter((t) => !have.has(t)).map((type) => ({ type, label: typeName(type) }))
  return { inWorkbook, standard }
}
