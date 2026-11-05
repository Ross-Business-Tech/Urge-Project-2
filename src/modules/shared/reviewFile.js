// Saving a review to a file and reopening it later. Built by M0.
//
// A review file holds everything on screen: the firm record, the project records, the workbook facts and the import
// report. It is plain JSON the underwriter downloads and opens again later. No server is involved and no copy is kept
// in the browser.
//
// A review file is UNTRUSTED input: it could have been edited, damaged, or come from anywhere. Before anything on screen
// touches it, every record is checked against the record structure (every group present, every value a plain number,
// text, yes/no or blank, no more rows than allowed) and the report is checked field by field. A file that is not exactly
// right is refused with a plain message, instead of being handed to code that assumes it is.

import { SCHEMA_VERSION, firmSchema, projectSchema } from './schema.js'
import { STAGE_VALUES, isValidDate } from './projectStage.js'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings.js'

export const REVIEW_KIND = 'underwriting-review'
export const REVIEW_FORMAT_VERSION = 1
export const MAX_REVIEW_BYTES = 25 * 1024 * 1024

const MAX_TEXT = 10000
const MAX_MAP_ENTRIES = 50000

export class ReviewFileError extends Error {}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// Reject keys that could be used to tamper with built-in objects.
function hasForbiddenKey(value, depth = 0) {
  if (depth > 40) return true
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKey(v, depth + 1))
  if (value && typeof value === 'object') {
    return Object.keys(value).some((k) => FORBIDDEN_KEYS.has(k) || hasForbiddenKey(value[k], depth + 1))
  }
  return false
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v, max = MAX_TEXT) => typeof v === 'string' && v.length <= max
const isScalar = (v) => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isText(v)
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

// Records saved before the provenance maps existed get empty ones; anything else odd is rejected.
function hasMaps(record) {
  if (!isObject(record)) return false
  record.sources ??= {}
  record.originals ??= {}
  return isObject(record.sources) && isObject(record.originals)
}

function validGroup(group, data) {
  if (!isObject(data)) return false
  if (!(group.fields ?? []).every((f) => isScalar(data[f.key]))) return false
  const rowOk = (row, columns) => isObject(row) && columns.every((c) => isScalar(row[c.key]))
  if (group.kind === 'table') return Array.isArray(data.rows) && data.rows.length <= group.maxRows && data.rows.every((row) => rowOk(row, group.columns))
  if (group.kind === 'grid') return isObject(data.lines) && group.rows.every((r) => rowOk(data.lines[r.key], group.columns))
  return true
}

// A record the screen and the calculators can safely read.
function validRecord(record, schema, kind) {
  if (!isObject(record) || record.kind !== kind || !isObject(record.data) || !hasMaps(record)) return false
  if (Object.keys(record.sources).length > MAX_MAP_ENTRIES || Object.keys(record.originals).length > MAX_MAP_ENTRIES) return false
  if (!Object.values(record.sources).every((s) => isText(s, 300))) return false
  if (!schema.every((g) => validGroup(g, record.data[g.id]))) return false
  if (kind === 'project') {
    if (!isObject(record.meta) || !isText(record.meta.projectId, 200)) return false
    const { stage, asOfDate } = record.data.stage
    if (!(stage === null || STAGE_VALUES.includes(stage))) return false
    if (!(asOfDate === null || isValidDate(asOfDate))) return false
  }
  return true
}

const validGroupSummary = (g) =>
  isObject(g) && isText(g.id, 200) && isText(g.title, 300) && ['filled', 'blank', 'errors', 'bad'].every((k) => isCount(g[k])) && typeof g.read === 'boolean'

function validReport(report) {
  if (!isObject(report) || !(report.fileName === null || isText(report.fileName, 500))) return false
  const w = report.workbook
  if (!isObject(w) || !(w.version === null || isText(w.version, 200)) || typeof w.versionKnown !== 'boolean') return false
  if (!['sheetCount', 'visible', 'hidden', 'veryHidden'].every((k) => isCount(w[k]))) return false
  const projectOk = (p) =>
    isObject(p) && isText(p.id, 200) && isText(p.tab, 300) && ['development', 'completed'].includes(p.kind) && ['visible', 'hidden', 'veryHidden'].includes(p.state) &&
    isText(p.hint, 500) && typeof p.hasData === 'boolean' && (p.name === null || isText(p.name, 500)) && Array.isArray(p.groups) && p.groups.every(validGroupSummary)
  return (
    Array.isArray(report.firmGroups) && report.firmGroups.every(validGroupSummary) &&
    Array.isArray(report.projects) && report.projects.every(projectOk) &&
    Array.isArray(report.notes) && report.notes.every((n) => isText(n, 2000)) &&
    Array.isArray(report.layoutProblems) && report.layoutProblems.every((l) => isObject(l) && isText(l.tab, 300) && Array.isArray(l.problems) && l.problems.every((p) => isText(p, 1000))) &&
    (report.errorCells === undefined || (Array.isArray(report.errorCells) && report.errorCells.every((c) => isObject(c) && isText(c.tab, 300) && isText(c.cell, 50) && isText(c.value, 50))))
  )
}

// The review must hang together: each project the report says has data has a record, and no record is left without one.
function consistent(review) {
  const ids = review.projects.map((p) => p.meta.projectId)
  if (new Set(ids).size !== ids.length) return false
  const withData = review.report.projects.filter((p) => p.hasData).map((p) => p.id)
  return withData.length === ids.length && withData.every((id) => ids.includes(id))
}

// Version 1 of the record layout treated a typed payment as MONTHLY. From version 2 it is YEARLY, like the applicant
// workbook. An older review is converted so its numbers keep their meaning, history included.
function migrateToVersion2(review) {
  for (const project of review.projects) {
    for (const row of project.data.sources.rows) if (typeof row.paymentOverride === 'number') row.paymentOverride *= 12
    for (const [path, entry] of Object.entries(project.originals)) {
      if (/^sources\.rows\.\d+\.paymentOverride$/.test(path) && isObject(entry) && typeof entry.value === 'number') entry.value *= 12
      if (path === 'sources.removedRows' && Array.isArray(entry)) {
        for (const removed of entry) {
          if (isObject(removed?.row) && typeof removed.row.paymentOverride === 'number') removed.row.paymentOverride *= 12
          const original = removed?.originals?.paymentOverride
          if (isObject(original) && typeof original.value === 'number') original.value *= 12
        }
      }
    }
  }
  review.schemaVersion = 2
}

// The workbook facts. Reviews saved before the error and typed-over facts existed lack them; they are filled in as empty below.
function validFacts(facts) {
  if (!isObject(facts) || !Array.isArray(facts.sheets)) return false
  const sheetOk = (s) =>
    isObject(s) && isText(s.name, 300) && ['visible', 'hidden', 'veryHidden'].includes(s.state) && (s.hasData === undefined || s.hasData === null || typeof s.hasData === 'boolean') && (s.errorCount === undefined || isCount(s.errorCount))
  const errorOk = (c) => isObject(c) && isText(c.tab, 300) && isText(c.cell, 50) && isText(c.value, 50)
  const typedOk = (c) => isObject(c) && isText(c.tab, 300) && isText(c.cell, 50) && typeof c.value === 'number' && Number.isFinite(c.value)
  const listOk = (list, ok) => list === undefined || (Array.isArray(list) && list.length <= 500 && list.every(ok))
  const countOk = (n) => n === undefined || isCount(n)
  return (
    facts.sheets.every(sheetOk) && listOk(facts.errorCells, errorOk) && listOk(facts.typedOver, typedOk) && countOk(facts.errorCellsTotal) && countOk(facts.typedOverTotal)
  )
}

export function buildReview(importResult, now = new Date()) {
  return {
    kind: REVIEW_KIND,
    formatVersion: REVIEW_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    savedAt: now.toISOString(),
    firm: importResult.firm,
    projects: importResult.projects,
    facts: importResult.facts,
    report: importResult.report,
    settings: importResult.settings ?? { ...DEFAULT_SETTINGS },
  }
}

export const serializeReview = (review) => JSON.stringify(review, null, 2)

export function reviewFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `underwriting-review-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

// Read a review back from text. Throws ReviewFileError with a plain message if it cannot be trusted.
export function parseReview(text) {
  if (typeof text !== 'string' || text.length > MAX_REVIEW_BYTES) {
    throw new ReviewFileError('That file is too big to be a saved review.')
  }
  let review
  try {
    review = JSON.parse(text)
  } catch {
    throw new ReviewFileError('That file could not be read as a saved review.')
  }
  if (!isObject(review) || review.kind !== REVIEW_KIND) {
    throw new ReviewFileError('That file is not a saved review from this tool.')
  }
  if (typeof review.formatVersion !== 'number' || review.formatVersion > REVIEW_FORMAT_VERSION) {
    throw new ReviewFileError('That review was saved by a newer version of this tool. Please update the tool and try again.')
  }
  if (typeof review.schemaVersion !== 'number' || review.schemaVersion > SCHEMA_VERSION) {
    throw new ReviewFileError('That review uses a newer record layout than this tool understands.')
  }
  if (hasForbiddenKey(review)) {
    throw new ReviewFileError('That file contains content that is not allowed, so it was not opened.')
  }
  const { firm, projects, facts, report } = review
  const sound =
    validRecord(firm, firmSchema, 'firm') &&
    Array.isArray(projects) && projects.every((p) => validRecord(p, projectSchema, 'project')) &&
    validFacts(facts) &&
    validReport(report) &&
    consistent(review)
  if (!sound) throw new ReviewFileError('That saved review is damaged or incomplete, so it was not opened.')
  if (review.schemaVersion < 2) migrateToVersion2(review)
  review.facts.errorCells ??= []
  review.facts.typedOver ??= []
  review.facts.errorCellsTotal ??= review.facts.errorCells.length
  review.facts.typedOverTotal ??= review.facts.typedOver.length
  for (const sheet of review.facts.sheets) {
    sheet.hasData ??= null
    sheet.errorCount ??= 0
  }
  // Settings are optional in a file; anything missing or out of range falls back to the default.
  review.settings = sanitizeSettings(review.settings)
  return review
}
