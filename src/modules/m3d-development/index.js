// M3D: development risk (layer 3). "What can go wrong while this project is being built?"
//
//   run(project, context) -> { flags, notes }        the module interface every module shares (section 1d)
//   checklist(project, context) -> [row]             every check with pass / fail / not checked / not applicable, for the screen
//
// Runs for `development` projects, and for `lease_up` projects (their still-projected parts: the budget, the remaining
// schedule and the debt are checked the same way, and their flags say stage_used: development). A `completed` project is
// M3C's job, so M3D reports nothing for it. M3D never changes the stage or any value.
//
// context (all optional): { firm, settings, benchmarkSets }. Settings are M0's (the lender's minimum DSCR comes from here).

import { createFlagMaker, guardModule, missingDataFlag, DEFAULT_SETTINGS } from '../shared/index.js'
import { CHECKS, GROUPS } from './checks.js'

export const MODULE_ID = 'M3D'
export { GROUPS }

const RUNS_FOR = ['development', 'lease_up']

function prepare(project, context = {}) {
  const maker = createFlagMaker(MODULE_ID, project)
  return {
    record: project,
    stage: maker.stage,
    // A lease-up project's projected parts are development checks, so say so on the flag.
    flag: (fields) => maker.flag({ stage_used: 'development', ...fields }),
    settings: { ...DEFAULT_SETTINGS, ...(context.settings ?? {}) },
    benchmarkSets: context.benchmarkSets,
    firm: context.firm ?? null,
  }
}

export function appliesTo(project) {
  return RUNS_FOR.includes(project?.data?.stage?.stage)
}

export function checklist(project, context) {
  if (!appliesTo(project)) return []
  const ctx = prepare(project, context)
  return CHECKS.flatMap((check) => check(ctx))
}

function runChecks(project, context) {
  if (!project?.data?.stage?.stage) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The development risk checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the development risk checks did not run.'],
    }
  }
  if (!appliesTo(project)) return { flags: [], notes: ['Development risk checks are for development and lease-up projects. Completed projects are covered by M3C.'] }
  const rows = checklist(project, context)
  const failed = rows.filter((r) => r.status === 'fail').length
  const unchecked = rows.filter((r) => r.status === 'not_checked').length
  const passed = rows.filter((r) => r.status === 'pass').length
  const notes = [
    `${rows.length} development risk checks: ${passed} passed, ${failed} raised a flag, ${unchecked} could not run.`,
    'Cost per square foot is compared with the market by M2. The workbook has no property manager or guarantor fields, so they count only when named under "Other" in the team table.',
  ]
  if (project.data.stage.stage === 'lease_up') notes.push('Lease-up project: the projected parts were checked as development. Stabilization and absorption belong to M3T.')
  return { flags: rows.flatMap((r) => r.flags), notes }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
