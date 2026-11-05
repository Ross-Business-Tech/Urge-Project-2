// Saving a review to a file and reopening it later. Built by M0.
//
// A review file holds everything on screen: the firm record, the project records, the workbook facts and the import
// report. It is plain JSON the underwriter downloads and opens again later. No server is involved and no copy is kept
// in the browser. A review file is treated as untrusted input, since it could have been edited or come from anywhere.

import { SCHEMA_VERSION } from './schema.js'
import { STAGE_VALUES, isValidDate } from './projectStage.js'

export const REVIEW_KIND = 'underwriting-review'
export const REVIEW_FORMAT_VERSION = 1
export const MAX_REVIEW_BYTES = 25 * 1024 * 1024

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

// Records saved before the provenance maps existed get empty ones; anything else odd is rejected.
function hasMaps(record) {
  if (!isObject(record)) return false
  record.sources ??= {}
  record.originals ??= {}
  return isObject(record.sources) && isObject(record.originals)
}

// A project record the screen can safely show: it has its stage section, a project id, and only allowed stage/date values.
function isProjectShape(p) {
  if (!isObject(p) || p.kind !== 'project' || !isObject(p.data) || !isObject(p.data.stage) || !hasMaps(p)) return false
  if (!isObject(p.meta) || typeof p.meta.projectId !== 'string') return false
  const { stage, asOfDate } = p.data.stage
  return (stage === null || STAGE_VALUES.includes(stage)) && (asOfDate === null || isValidDate(asOfDate))
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
  const shapeOk =
    isObject(firm) && firm.kind === 'firm' && isObject(firm.data) && hasMaps(firm) &&
    Array.isArray(projects) && projects.every(isProjectShape) &&
    isObject(facts) && Array.isArray(facts.sheets) &&
    isObject(report) && isObject(report.workbook) && Array.isArray(report.firmGroups) &&
    Array.isArray(report.projects) && Array.isArray(report.notes) && Array.isArray(report.layoutProblems)
  if (!shapeOk) throw new ReviewFileError('That saved review is damaged or incomplete, so it was not opened.')
  return review
}
