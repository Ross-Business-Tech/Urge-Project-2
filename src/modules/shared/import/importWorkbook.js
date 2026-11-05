// Reads an applicant workbook into a firm record, project records and an import report. Built by M0.
// Runs in the browser (or Node). Nothing is sent anywhere. Stage and "as of" date are never filled in.

import { firmSchema, projectSchema } from '../schema.js'
import { blankFirm, blankProject } from '../records.js'
import { SOURCE_TYPES, LEASE_TYPES } from '../enums.js'
import { openWorkbook, ImportError } from './xlsxReader.js'
import {
  KNOWN_VERSIONS,
  PROJECT_TAB,
  FIRM_TABS,
  DETAILS_ANCHORS,
  BUDGET_ANCHORS,
  COVER_VERSION_CELL,
  firmMap,
  projectMap,
} from './workbookMap.js'

export { ImportError }

const normalize = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const rowOf = (cell) => Number(String(cell).match(/\d+/)[0])

const SOURCE_TYPE_BY_TEXT = new Map(
  [...SOURCE_TYPES.map((t) => [normalize(t.label), t.value]), ['gov debt', 'gov_debt'], ['non recoverable grant', 'nonrecoverable_grant']],
)
const LEASE_TYPE_BY_TEXT = new Map(LEASE_TYPES.map((t) => [normalize(t.label), t.value]))

function excelDate(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
  return d.toISOString().slice(0, 10)
}

function parseNumberText(text) {
  const cleaned = text.replace(/[$,\s]/g, '')
  const isPercent = cleaned.endsWith('%')
  const n = Number(isPercent ? cleaned.slice(0, -1) : cleaned)
  if (cleaned === '' || !Number.isFinite(n)) return null
  return isPercent ? n / 100 : n
}

// Turn one workbook cell into a value of the schema type. Returns { value, error?, bad?, note? }.
function convert(type, cell) {
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
      return { value: typeof v === 'number' && v > 20000 ? excelDate(v) : String(v) }
    case 'yearMonth':
      if (typeof v === 'number' && v >= 1900 && v < 3000) return { value: String(v) }
      return { value: typeof v === 'number' && v > 20000 ? excelDate(v).slice(0, 7) : String(v) }
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

const EXPECTED = { number: 'a number', dollars: 'a dollar amount', percent: 'a percentage', boolean: 'a yes or no' }

const typeOf = (list, key) => (list || []).find((i) => i.key === key)?.type

// Reads one group. Returns the group's data, how many cells were filled, blank or showing errors, and the source of each value.
function readGroup(schemaGroup, spec, cells, tabName) {
  const counts = { filled: 0, blank: 0, errors: 0, bad: 0 }
  const sources = {}
  const notes = []
  const errorCells = []
  const data = {}

  const read = (type, addr, path) => {
    const result = convert(type, cells.get(addr))
    if (result.error) {
      counts.errors++
      errorCells.push({ tab: tabName, cell: addr, value: result.error })
    } else if (result.bad) {
      counts.bad++
      notes.push(`${tabName}!${addr} holds text or an unexpected value where ${EXPECTED[type] ?? 'a different kind of value'} was expected.`)
    } else if (result.value === null) counts.blank++
    else {
      counts.filled++
      sources[path] = `${tabName}!${addr}`
    }
    if (result.note) notes.push(`${tabName}!${addr}: ${result.note}.`)
    return result.value ?? null
  }

  const readFields = (fields, into, prefix) => {
    for (const [key, addr] of Object.entries(fields || {})) {
      into[key] = read(typeOf(schemaGroup.fields, key), addr, `${prefix}${key}`)
    }
  }

  readFields(spec.fields, data, `${schemaGroup.id}.`)

  if (spec.table) {
    const rows = []
    const t = spec.table
    const rowDefs = t.rows ?? Array.from({ length: t.last - t.first + 1 }, (_, i) => Object.fromEntries(Object.entries(t.cols).map(([k, col]) => [k, `${col}${t.first + i}`])))
    for (const def of rowDefs) {
      // Look first, count only if the row is kept.
      const keep = Object.entries(def).some(([k, addr]) => {
        const r = convert(typeOf(schemaGroup.columns, k), cells.get(addr))
        return t.keepIf.includes(k) && (r.value !== null || r.error)
      })
      if (!keep) continue
      const index = rows.length
      const row = {}
      for (const [k, addr] of Object.entries(def)) row[k] = read(typeOf(schemaGroup.columns, k), addr, `${schemaGroup.id}.rows.${index}.${k}`)
      rows.push(row)
    }
    data.rows = rows
  }

  if (spec.grid) {
    const lines = {}
    for (const row of schemaGroup.rows) {
      const n = rowOf(row.cell)
      const line = {}
      for (const [colKey, letter] of Object.entries(spec.grid.cols)) {
        line[colKey] = read(typeOf(schemaGroup.columns, colKey), `${letter}${n}`, `${schemaGroup.id}.lines.${row.key}.${colKey}`)
      }
      lines[row.key] = line
    }
    data.lines = lines
  }

  if (spec.years) {
    const rows = []
    const yearCol = schemaGroup.columns.find((c) => c.key === 'fiscalYear')
    const lineCols = schemaGroup.columns.filter((c) => c.key !== 'fiscalYear')
    for (const letter of spec.years.cols) {
      const header = convert('number', cells.get(`${letter}${spec.years.headerRow}`))
      const headerCell = cells.get(`${letter}${spec.years.headerRow}`)
      let year = header.value
      if (typeof year === 'number' && year > 20000) year = Number(excelDate(year).slice(0, 4))
      if (!Number.isFinite(year) || !headerCell) continue
      const peek = lineCols.map((c) => convert(c.type, cells.get(`${letter}${rowOf(c.cell)}`)))
      // A year column counts only if the applicant put something in it (a value that is not just a calculated zero).
      if (!peek.some((r) => (typeof r.value === 'number' && r.value !== 0) || r.error)) continue
      const index = rows.length
      const row = { [yearCol.key]: year }
      counts.filled++
      sources[`${schemaGroup.id}.rows.${index}.fiscalYear`] = `${tabName}!${letter}${spec.years.headerRow}`
      for (const c of lineCols) row[c.key] = read(c.type, `${letter}${rowOf(c.cell)}`, `${schemaGroup.id}.rows.${index}.${c.key}`)
      rows.push(row)
    }
    data.rows = rows
  }

  return { data, counts, sources, notes, errorCells }
}

// Check the labels at known cells. Returns a list of plain-language problems (empty list means the layout matches).
function checkAnchors(cells, anchors, tabName) {
  const problems = []
  for (const [addr, expected] of anchors) {
    const cell = cells.get(addr)
    const text = cell && cell.kind === 'text' ? normalize(cell.value) : ''
    if (!text.includes(expected)) problems.push(`${tabName}!${addr} should say "${expected}"`)
  }
  return problems
}

function summarize(schema, results) {
  return schema.map((g) => ({
    id: g.id,
    title: g.title,
    ...(results[g.id]?.counts ?? { filled: 0, blank: 0, errors: 0, bad: 0 }),
    read: Boolean(results[g.id]),
  }))
}

function assemble(record, schema, results) {
  for (const g of schema) {
    const r = results[g.id]
    if (!r) continue
    Object.assign(record.data[g.id], r.data)
    Object.assign(record.sources, r.sources)
  }
}

// A project tab counts as "having data" only if the applicant entered real numbers: money sources, rent rows,
// budget amounts or expenses. Template defaults (a placeholder name, default growth rates, default labels) do not count.
function hasProjectData(results) {
  const d = (id) => results[id]?.data
  const anyAmount = (lines) => Object.values(lines ?? {}).some((l) => Object.values(l).some((v) => typeof v === 'number' && v !== 0))
  return Boolean(
    d('sources')?.rows?.length ||
      d('residentialIncome')?.rows?.length ||
      d('commercialIncome')?.rows?.length ||
      d('otherIncome')?.rows?.length ||
      d('otherExpenses')?.rows?.length ||
      anyAmount(d('budget')?.lines) ||
      anyAmount(d('operatingExpenses')?.lines),
  )
}

export async function importWorkbook(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer())
  const wb = openWorkbook(bytes)
  const notes = []
  const layoutProblems = []
  const errorCells = []

  const tabCache = new Map()
  const cellsFor = (name, anchors) => {
    if (tabCache.has(name)) return tabCache.get(name)
    const cells = wb.cells(name)
    let usable = null
    if (!cells) {
      tabCache.set(name, { cells: null, usable: null })
      return tabCache.get(name)
    }
    const problems = checkAnchors(cells, anchors, name)
    if (problems.length) layoutProblems.push({ tab: name, problems })
    else usable = cells
    tabCache.set(name, { cells, usable })
    return tabCache.get(name)
  }

  // ---- Workbook basics
  const visibility = { visible: 0, hidden: 0, veryHidden: 0 }
  for (const s of wb.sheets) visibility[s.state]++
  const coverRead = cellsFor('Cover', FIRM_TABS.Cover)
  if (!coverRead.cells) notes.push('This workbook has no "Cover" tab, so it may not be an applicant workbook.')
  const versionCell = coverRead.cells?.get(COVER_VERSION_CELL)
  const version = versionCell && versionCell.kind === 'text' ? String(versionCell.value).trim() : null
  const versionKnown = version ? KNOWN_VERSIONS.map(normalize).includes(normalize(version)) : false
  if (version && !versionKnown) notes.push(`This is workbook "${version}", a version we have not seen before. Check the numbers carefully.`)
  if (!version && coverRead.cells) notes.push('The workbook version could not be read from the Cover tab.')

  // ---- Firm
  const firm = blankFirm()
  const firmResults = {}
  for (const g of firmSchema) {
    const spec = firmMap[g.id]
    if (!spec.tab) continue
    const { cells, usable } = cellsFor(spec.tab, FIRM_TABS[spec.tab])
    if (!cells) {
      notes.push(`The "${spec.tab}" tab was not found, so "${g.title}" was left blank.`)
      continue
    }
    if (!usable) continue
    const result = readGroup(g, spec, usable, spec.tab)
    firmResults[g.id] = result
    notes.push(...result.notes)
    errorCells.push(...result.errorCells)
  }
  assemble(firm, firmSchema, firmResults)

  // ---- Projects
  const projects = []
  const projectReports = []
  for (const sheet of wb.sheets) {
    const m = sheet.isWorksheet ? sheet.name.match(PROJECT_TAB) : null
    if (!m) continue
    const kind = m[1].toLowerCase()
    const n = Number(m[2])
    const detailsName = sheet.name
    const budgetName = `${m[1]} Project ${n} Budget`
    const details = cellsFor(detailsName, DETAILS_ANCHORS)
    const budget = kind === 'development' && wb.hasSheet(budgetName) ? cellsFor(budgetName, BUDGET_ANCHORS) : { cells: null, usable: null }

    const results = {}
    for (const g of projectSchema) {
      const spec = projectMap[g.id]
      if (!spec.tab) continue
      const source = spec.tab === 'budget' ? budget : details
      const tabName = spec.tab === 'budget' ? budgetName : detailsName
      if (!source.usable) continue
      const result = readGroup(g, spec, source.usable, tabName)
      results[g.id] = result
      notes.push(...result.notes)
      errorCells.push(...result.errorCells)
    }

    const hasData = hasProjectData(results)
    const report = {
      id: `${kind}-${n}`,
      tab: detailsName,
      kind,
      number: n,
      state: sheet.state,
      hint: `This came from a "${m[1]} Project ${n}" tab`,
      hasData,
      name: results.identity?.data?.name ?? null,
      groups: summarize(projectSchema, results),
    }
    projectReports.push(report)
    if (!hasData) continue

    const record = blankProject()
    assemble(record, projectSchema, results)
    record.data.stage.workbookVersion = version
    record.meta = { projectId: report.id, sourceTab: detailsName, hint: report.hint }
    projects.push(record)
  }

  // ---- Cross-checks that are worth saying out loud
  const withData = projectReports.filter((p) => p.hasData)
  for (const kind of ['development', 'completed']) {
    const declared = firm.data.identity[kind === 'development' ? 'developmentProjectCount' : 'completedProjectCount']
    const found = withData.filter((p) => p.kind === kind).length
    if (typeof declared === 'number' && declared !== found) {
      notes.push(`The Cover says ${declared} ${kind} project${declared === 1 ? '' : 's'}, but ${found} ${kind} project tab${found === 1 ? ' has' : 's have'} data.`)
    }
  }
  for (const p of withData) {
    if (p.state !== 'visible') notes.push(`The tab "${p.tab}" is ${p.state === 'veryHidden' ? 'very hidden' : 'hidden'} but contains data.`)
  }
  for (const lp of layoutProblems) notes.push(`The "${lp.tab}" tab has a different layout than expected, so it was not read (${lp.problems[0]}).`)
  if (errorCells.length) {
    notes.push(
      errorCells.length === 1
        ? '1 cell we read shows an Excel error such as #REF!.'
        : `${errorCells.length} cells we read show an Excel error such as #REF!.`,
    )
  }

  firm.data.projects.rows = withData.map((p) => ({ projectId: p.id, ownershipPct: null }))

  return {
    firm,
    projects,
    facts: { sheets: wb.sheets.map((s) => ({ name: s.name, state: s.state })) },
    report: {
      fileName: options.fileName ?? input.name ?? null,
      workbook: { version, versionKnown, sheetCount: wb.sheets.length, ...visibility },
      firmGroups: summarize(firmSchema, firmResults),
      projects: projectReports,
      layoutProblems,
      errorCells: errorCells.slice(0, 100),
      notes: [...new Set(notes)],
    },
  }
}
