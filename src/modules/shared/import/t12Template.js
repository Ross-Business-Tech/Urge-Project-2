// The T-12 template: a small spreadsheet the underwriter (or the applicant) fills in with up to 12 months of actual results,
// and the reader that turns it into T-12 rows. Built by M0. The applicant workbook has no T-12, so this is how monthly
// actuals come in without typing them by hand.
//
// Columns are found by their HEADER text, not their position, so a column that was moved or added does not matter. Nothing
// is guessed: a cell that is not believable (a percentage typed as 95, text where an amount belongs, a negative amount)
// is left blank and reported, and a row without a usable month is skipped and reported.

import { projectSchema } from '../schema.js'
import { blankTableRow } from '../records.js'
import { isValidDate } from '../projectStage.js'
import { limitError } from '../fieldFormat.js'
import { openWorkbook, ImportError } from './xlsxReader.js'
import { normalize, convert } from './cellValue.js'
import { writeXlsx } from './xlsxWriter.js'

export const T12_SHEET = 'T-12'
export const T12_TEMPLATE_VERSION = 1
// The name shown as the source of a loaded value (the sheet name in the file does not matter).
export const T12_SOURCE = 'T-12 template'

const T12 = projectSchema.find((g) => g.id === 't12')
const MAX_MONTHS = T12.maxRows
const HEADER_ROW = 4
const COLS = (n) => {
  let s = ''
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}
const rowOf = (addr) => Number(addr.match(/\d+/)[0])
const colOf = (addr) => addr.match(/^[A-Z]+/)[0]

const STYLE_BY_TYPE = { date: 'date', dollars: 'money', percent: 'percent' }

// A date written as YYYY-MM-DD becomes a real Excel date; anything else (such as 2026-06) stays as text.
const toExcelDate = (text) => (isValidDate(text) ? (Date.UTC(+text.slice(0, 4), +text.slice(5, 7) - 1, +text.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000 : text)

// Build the template workbook. `rows` (optional) pre-fills months; the tests and the sample data use that.
export function buildT12Template({ rows = [] } = {}) {
  const cells = {
    A1: { v: `T-12 template, version ${T12_TEMPLATE_VERSION}`, s: 'header' },
    A2: 'One row per month, up to 12, oldest first. Amounts are plain dollars. Occupancy is a percentage: type 95% or 0.95.',
    A3: 'Vacancy loss and concessions can be typed as positive or negative amounts. Leave a cell blank if you do not have it.',
  }
  T12.columns.forEach((c, i) => {
    cells[`${COLS(i)}${HEADER_ROW}`] = { v: c.label, s: 'header' }
    for (let r = 0; r < MAX_MONTHS; r++) {
      const value = rows[r]?.[c.key]
      const style = STYLE_BY_TYPE[c.type]
      cells[`${COLS(i)}${HEADER_ROW + 1 + r}`] = value === undefined || value === null ? { s: style } : { v: c.type === 'date' ? toExcelDate(value) : value, s: style }
    }
  })
  return writeXlsx({ sheets: [{ name: T12_SHEET, cells, widths: T12.columns.map((c) => (c.key === 'month' ? 14 : 18)) }] })
}

const LABEL_TO_KEY = new Map(T12.columns.flatMap((c) => [[normalize(c.label), c.key], [normalize(c.key), c.key]]))
const monthText = (v) => (typeof v === 'string' && (/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isValidDate(v))) ? v : null)

// Read a filled-in template. Returns { rows, sources, notes, sheetName }. Throws ImportError if the file cannot be read as a T-12.
export function parseT12Template(bytes) {
  const wb = openWorkbook(bytes)
  const sheet = wb.sheets.find((s) => s.isWorksheet && s.name === T12_SHEET) ?? wb.sheets.find((s) => s.isWorksheet)
  if (!sheet) throw new ImportError('That workbook has no sheet to read.')
  const cells = wb.cells(sheet.name)

  // Group the cells by row, and find the header row: the first row with a cell that says "Month".
  const byRow = new Map()
  let headerRow = null
  for (const [addr, cell] of cells) {
    const r = rowOf(addr)
    if (!byRow.has(r)) byRow.set(r, new Map())
    byRow.get(r).set(colOf(addr), { addr, cell })
    if (cell.kind === 'text' && normalize(cell.value) === 'month' && (headerRow === null || r < headerRow)) headerRow = r
  }
  if (headerRow === null) throw new ImportError('That sheet has no "Month" column, so it does not look like the T-12 template.')

  const notes = []
  const columns = new Map() // column letter -> schema column
  for (const [letter, { cell }] of byRow.get(headerRow)) {
    if (cell.kind !== 'text') continue
    const key = LABEL_TO_KEY.get(normalize(cell.value))
    if (key) columns.set(letter, T12.columns.find((c) => c.key === key))
    else notes.push(`The column "${cell.value}" is not part of the template and was ignored.`)
  }

  const dataRows = [...byRow.keys()].filter((r) => r > headerRow).sort((a, b) => a - b)
  if (dataRows.length > MAX_MONTHS) throw new ImportError(`A T-12 holds at most ${MAX_MONTHS} months, but this file has ${dataRows.length} rows of data.`)

  const rows = []
  const sources = {}
  const monthLetter = [...columns].find(([, c]) => c.key === 'month')?.[0]
  for (const r of dataRows) {
    const entries = byRow.get(r)
    const monthEntry = entries.get(monthLetter)
    const converted = monthEntry ? convert('date', monthEntry.cell, wb.date1904) : { value: null }
    const month = monthText(converted.value)
    if (!month) {
      notes.push(`Row ${r} has no usable month (use a date, or a month like 2026-06), so it was skipped.`)
      continue
    }
    const row = blankTableRow(T12)
    const index = rows.length
    for (const [letter, def] of columns) {
      const entry = entries.get(letter)
      if (!entry) continue
      if (def.key === 'month') {
        row.month = month
        sources[`t12.rows.${index}.month`] = `${T12_SOURCE}!${entry.addr}`
        continue
      }
      const got = convert(def.type, entry.cell, wb.date1904)
      if (got.value === null && !got.error && !got.bad) continue // blank
      const where = `${month}: ${def.label}`
      if (got.error) notes.push(`${where} shows an Excel error (${got.error}), so it was left blank.`)
      else if (got.bad) notes.push(`${where} is not a number, so it was left blank.`)
      else {
        const problem = limitError(def.type, got.value, def)
        if (problem) {
          notes.push(
            def.type === 'percent'
              ? `${where} is ${got.value}, which is not a believable percentage. Type it as 95% or 0.95. It was left blank.`
              : `${where} is ${got.value}. ${problem} It was left blank.`,
          )
        } else {
          row[def.key] = got.value
          sources[`t12.rows.${index}.${def.key}`] = `${T12_SOURCE}!${entry.addr}`
        }
      }
    }
    rows.push(row)
  }

  // The same calendar month twice: the calculators use the later row, so say so.
  const seen = new Map()
  rows.forEach((row, i) => {
    const key = row.month.slice(0, 7)
    if (seen.has(key)) notes.push(`The month ${key} appears more than once (rows ${seen.get(key) + 1} and ${i + 1}); the later one is used.`)
    seen.set(key, i)
  })
  return { rows, sources, notes, sheetName: sheet.name }
}
