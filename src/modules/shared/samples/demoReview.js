// Builds the demo pack's saved review: the workbook read the way the app reads it, with a stage and date chosen for every
// project and the finished projects' T-12 results loaded, so the demo opens ready to show with one drop of one file.
import { recordsToWorkbook } from './toWorkbook.js'
import { importWorkbook } from '../import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../import/t12Template.js'
import { applyStageAndDate, replaceT12Rows } from '../index.js'
import { buildReview, serializeReview } from '../reviewFile.js'
import { demoBuild, pastProjects, DEMO_AS_OF } from './demoPack.js'

export async function demoImport() {
  return importWorkbook(recordsToWorkbook(demoBuild()))
}

// The imported result with stages, dates and T-12s applied. `projects` are the records the app would hold after those choices.
export async function demoReadyResult() {
  const out = await demoImport()
  const projects = out.projects.map((p) => {
    const past = pastProjects.find((x) => x.name === p.data.identity.name)
    let record = applyStageAndDate(p, { stage: past ? 'completed' : 'development', asOfDate: DEMO_AS_OF })
    if (past) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: past.t12 })))
    return record
  })
  return { ...out, projects }
}

export async function demoReviewText(now = new Date('2026-01-15T12:00:00Z')) {
  return serializeReview(buildReview(await demoReadyResult(), now))
}
