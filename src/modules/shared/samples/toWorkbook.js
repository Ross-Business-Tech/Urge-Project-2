// Turns a firm record and project records into a fake applicant workbook (cover version 1.9 layout).
// This is the importer in reverse: it uses the same cell map, so a workbook built here reads back as the same records.
// Made-up data only. Nothing here is copied from a real file.

import { firmSchema, projectSchema } from '../schema.js'
import { firmMap, projectMap, FIRM_TABS, DETAILS_ANCHORS, BUDGET_ANCHORS, COVER_VERSION_CELL } from '../import/workbookMap.js'
import { SOURCE_TYPES, LEASE_TYPES } from '../enums.js'
import { writeXlsx } from '../import/xlsxWriter.js'

const rowOf = (cell) => Number(String(cell).match(/\d+/)[0])
const labelOf = (list, value) => list.find((t) => t.value === value)?.label ?? value

// A record value as a workbook cell. Blank stays blank, so the importer sees what an applicant who left it empty would give.
function cellFor(type, value) {
  if (value === null || value === undefined || value === '') return undefined
  if (type === 'boolean') return value ? 1 : 2
  if (type === 'sourceType') return labelOf(SOURCE_TYPES, value)
  if (type === 'leaseType') return labelOf(LEASE_TYPES, value)
  if (type === 'yearMonth' && /^\d{4}$/.test(String(value))) return Number(value)
  return value
}

const anchors = (list) => Object.fromEntries(list.map(([addr, text]) => [addr, text]))
const typeOf = (list, key) => (list || []).find((i) => i.key === key)?.type

// Write one record group into a cell map, following the same map the importer reads.
function writeGroup(cells, schemaGroup, spec, data) {
  if (!data) return
  for (const [key, addr] of Object.entries(spec.fields || {})) {
    const v = cellFor(typeOf(schemaGroup.fields, key), data[key])
    if (v !== undefined) cells[addr] = v
  }
  if (spec.table) {
    const t = spec.table
    const defs = t.rows ?? Array.from({ length: t.last - t.first + 1 }, (_, i) => Object.fromEntries(Object.entries(t.cols).map(([k, col]) => [k, `${col}${t.first + i}`])))
    ;(data.rows || []).forEach((row, i) => {
      if (!defs[i]) throw new Error(`${schemaGroup.id}: more than ${defs.length} rows`)
      for (const [k, addr] of Object.entries(defs[i])) {
        const v = cellFor(typeOf(schemaGroup.columns, k), row[k])
        if (v !== undefined) cells[addr] = v
      }
    })
  }
  if (spec.grid) {
    for (const r of schemaGroup.rows) {
      const line = data.lines?.[r.key]
      if (!line) continue
      for (const [colKey, letter] of Object.entries(spec.grid.cols)) {
        const v = cellFor(typeOf(schemaGroup.columns, colKey), line[colKey])
        if (v !== undefined) cells[`${letter}${rowOf(r.cell)}`] = v
      }
    }
  }
  if (spec.years) {
    const lineCols = schemaGroup.columns.filter((c) => c.key !== 'fiscalYear')
    ;(data.rows || []).forEach((row, i) => {
      const letter = spec.years.cols[i]
      cells[`${letter}${spec.years.headerRow}`] = row.fiscalYear
      for (const c of lineCols) {
        const v = cellFor(c.type, row[c.key])
        if (v !== undefined) cells[`${letter}${rowOf(c.cell)}`] = v
      }
    })
  }
}

// projects: [{ record, kind: 'development' | 'completed', state?: 'hidden' | 'veryHidden', details?: {cell: value}, budget?: {cell: value} }]
// `details` and `budget` overwrite single cells after the record is written (for error cells, residue, typed numbers).
// `firmCells` overwrites firm-tab cells the same way: { 'Cover!C9': 3 }.
export function recordsToWorkbook({ firm, projects = [], firmCells = {}, extraSheets = [], version = 'Version 1.9' }) {
  const byTab = {}
  for (const [tab, list] of Object.entries(FIRM_TABS)) byTab[tab] = anchors(list)
  byTab.Cover[COVER_VERSION_CELL] = version
  for (const g of firmSchema) {
    const spec = firmMap[g.id]
    if (spec.tab) writeGroup(byTab[spec.tab], g, spec, firm.data[g.id])
  }
  // The Cover project counts are what an applicant types, so write them from the projects given unless the record already has them.
  const count = (kind) => projects.filter((p) => (p.kind ?? 'development') === kind).length
  byTab.Cover.C9 ??= count('development')
  byTab.Cover.C10 ??= count('completed')
  for (const [key, v] of Object.entries(firmCells)) {
    const [tab, addr] = key.split('!')
    byTab[tab][addr] = v
  }

  const sheets = Object.entries(byTab).map(([name, cells]) => ({ name, cells }))
  const counters = { development: 0, completed: 0 }
  for (const p of projects) {
    const kind = p.kind ?? 'development'
    const n = ++counters[kind]
    const base = `${kind === 'development' ? 'Development' : 'Completed'} Project ${n}`
    const details = anchors(DETAILS_ANCHORS)
    const budget = anchors(BUDGET_ANCHORS)
    for (const g of projectSchema) {
      const spec = projectMap[g.id]
      if (!spec.tab) continue
      writeGroup(spec.tab === 'budget' ? budget : details, g, spec, p.record.data[g.id])
    }
    Object.assign(details, p.details)
    Object.assign(budget, p.budget)
    sheets.push({ name: `${base} Details`, ...(p.state ? { state: p.state } : {}), cells: details })
    if (kind === 'development') sheets.push({ name: `${base} Budget`, cells: budget })
  }
  return writeXlsx({ sheets: [...sheets, ...extraSheets] })
}
