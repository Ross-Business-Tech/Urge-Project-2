// Setting a project's stage and "as of" date, and checking they are both there. Built by M0.
//
// The stage is always chosen by the underwriter; nothing here works it out. Both values start blank after an import.
// These functions never change a record in place: they return a new copy.

import { STAGES } from './enums.js'

export const STAGE_VALUES = STAGES.map((s) => s.value)

// True for a real calendar date written as YYYY-MM-DD.
export function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

// Returns a copy of the project with the given stage and/or as-of date. Pass null to clear a value.
// Values typed by hand are marked as 'manual' in the record's sources.
export function applyStageAndDate(project, { stage, asOfDate }) {
  const next = { ...project, data: { ...project.data, stage: { ...project.data.stage } }, sources: { ...project.sources } }
  const set = (key, value) => {
    next.data.stage[key] = value
    if (value === null) delete next.sources[`stage.${key}`]
    else next.sources[`stage.${key}`] = 'manual'
  }
  if (stage !== undefined) {
    if (stage !== null && !STAGE_VALUES.includes(stage)) throw new Error(`Unknown stage: ${stage}`)
    set('stage', stage)
  }
  if (asOfDate !== undefined) {
    if (asOfDate !== null && !isValidDate(asOfDate)) throw new Error(`Not a valid date: ${asOfDate}`)
    set('asOfDate', asOfDate)
  }
  return next
}

// Which required choices are still missing for one project.
export function projectReadiness(project) {
  const missing = []
  if (!project.data.stage.stage) missing.push('stage')
  if (!project.data.stage.asOfDate) missing.push('asOfDate')
  return { ready: missing.length === 0, missing }
}

// How many of a review's projects still need a stage or date.
export function reviewReadiness(projects) {
  const waiting = projects.filter((p) => !projectReadiness(p).ready).length
  return { ready: waiting === 0, total: projects.length, waiting }
}
