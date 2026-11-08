// M3D: Development risk (layer 3). "What can go wrong while this project is being built and filled?"
//
//   run(project, context) -> { flags, notes }        the module interface every module shares (section 1d)
//   checklist(project, context) -> [row]             every check with pass / fail / not checked / not applicable, for the screen
//
// context: { firm, settings, benchmarkSets } (all optional). The settings default to M0's (lender's minimum DSCR 1.20 and so
// on) and the benchmark sets to M0's made-up sample sets.
//
// Runs for `development`, and for the still-projected parts of `lease_up`. For a `completed` project it has nothing to say
// and returns no flags. It never changes the stage or any value: it only reports.

import { guardModule, missingDataFlag, sanitizeSettings, DEFAULT_SETTINGS } from '../shared/index.js'
import { CHECKS, MODULE_ID, prepare } from './checks.js'

export { MODULE_ID }

const settingsOf = (context) => sanitizeSettings(context?.settings ?? DEFAULT_SETTINGS)

// Every check as a row, for the screen. Empty for a completed project, which this module does not review.
export function checklist(project, context) {
  const stage = project?.data?.stage?.stage
  if (stage !== 'development' && stage !== 'lease_up') return []
  const ctx = prepare(project, context, settingsOf(context))
  return CHECKS.map((check) => check(ctx))
}

function runChecks(project, context) {
  const stage = project?.data?.stage?.stage
  if (!stage) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The development risk checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the development risk checks did not run.'],
    }
  }
  if (stage === 'completed') return { flags: [], notes: ['M3D reviews development and lease-up projects. This project is completed, so M3C reviews it instead.'] }

  const rows = checklist(project, context)
  const failed = rows.filter((r) => r.status === 'fail').length
  const unchecked = rows.filter((r) => r.status === 'not_checked').length
  const skipped = rows.filter((r) => r.status === 'not_applicable').length
  const notes = [`${rows.length} development risk checks: ${rows.length - failed - unchecked - skipped} passed, ${failed} raised a flag, ${unchecked} could not run, ${skipped} not applicable.`]
  if (stage === 'lease_up') notes.push('Lease-up project: only the still-projected parts ran (schedule, reserves, loans, team). The budget checks are skipped because the workbook holds the original budget.')
  return { flags: rows.flatMap((r) => r.flags), notes }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
