// M1: Integrity checks (layer 1, the same for every stage). "Can we trust the numbers at all?"
//
//   run(project, context) -> { flags, notes }        the module interface every module shares (section 1d)
//   checklist(project, context) -> [row]             every check with pass / fail / not checked / not applicable, for the screen
//
// context: { firm, facts, report, projects }. `facts` and `report` come from M0's importWorkbook (or a reopened review).
// M1 never changes the stage or any value: it only reports.

import { createFlagMaker, guardModule, missingDataFlag, isValidDate } from '../shared/index.js'
import { CHECKS, projectTabs, monthOf } from './checks.js'

export const MODULE_ID = 'M1'

function prepare(project, context = {}) {
  const maker = createFlagMaker(MODULE_ID, project)
  const asOfDate = project.data.stage.asOfDate
  return {
    record: project,
    stage: maker.stage,
    flag: maker.flag,
    firm: context.firm ?? null,
    facts: context.facts ?? null,
    report: context.report ?? null,
    tabs: projectTabs(project),
    asOf: isValidDate(asOfDate) ? monthOf(asOfDate, false) : null,
  }
}

export function checklist(project, context) {
  const ctx = prepare(project, context)
  return CHECKS.map((check) => check(ctx))
}

function runChecks(project, context) {
  if (!project?.data?.stage?.stage) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The integrity checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the integrity checks did not run.'],
    }
  }
  const rows = checklist(project, context)
  const failed = rows.filter((r) => r.status === 'fail').length
  const unchecked = rows.filter((r) => r.status === 'not_checked').length
  return {
    flags: rows.flatMap((r) => r.flags),
    notes: [`${rows.length} integrity checks: ${rows.length - failed - unchecked} passed or not applicable, ${failed} failed, ${unchecked} could not run.`],
  }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
