// M3C: Completed risk (layer 3). "Is this operating property performing as promised, and what happens when its loan comes due?"
//
//   run(project, context) -> { flags, notes }        the module interface every module shares (section 1d)
//   checklist(project, context) -> [row]             every check with pass / fail / not checked / not applicable, for the screen
//
// context: { firm, settings } (both optional). The settings default to M0's.
//
// Runs for `completed`, and for the already-actual parts of `lease_up` (rents in place, expenses to date, expense lines, loan
// maturity). For a `development` project there are no actual results, so it returns no flags. It never changes the stage or
// any value: it only reports.

import { guardModule, missingDataFlag, sanitizeSettings, DEFAULT_SETTINGS } from '../shared/index.js'
import { CHECKS, MODULE_ID, prepare } from './checks.js'

export { MODULE_ID }

const settingsOf = (context) => sanitizeSettings(context?.settings ?? DEFAULT_SETTINGS)
const reviews = (stage) => stage === 'completed' || stage === 'lease_up'

// Every check as a row, for the screen. Empty for a development project, which has no actual results to review.
export function checklist(project, context) {
  if (!reviews(project?.data?.stage?.stage)) return []
  const ctx = prepare(project, context, settingsOf(context))
  return CHECKS.map((check) => check(ctx))
}

function runChecks(project, context) {
  const stage = project?.data?.stage?.stage
  if (!stage) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'completed', check: 'stage', checkTitle: 'The completed risk checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the completed risk checks did not run.'],
    }
  }
  if (!reviews(stage)) return { flags: [], notes: ['M3C reviews completed and lease-up projects. This project is still in development, so M3D reviews it instead.'] }

  const rows = checklist(project, context)
  const count = (s) => rows.filter((r) => r.status === s).length
  const notes = [`${rows.length} completed risk checks: ${count('pass')} passed, ${count('fail')} raised a flag, ${count('not_checked')} could not run, ${count('not_applicable')} not applicable.`]
  if (stage === 'lease_up') notes.push('Lease-up project: only what is already actual ran (rents in place, expenses, expense lines, loan maturity). Income vs. underwriting and vacancy are left to M3T.')
  return { flags: rows.flatMap((r) => r.flags), notes }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
