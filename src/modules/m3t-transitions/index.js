// M3T: Transition checks (layer 3). "Will this project make the jump to its next stage, and will the debt still work when it does?"
//
//   run(project, context) -> { flags, notes }              the module interface every module shares (section 1d)
//   checklist(project, context) -> [row]                   every check with pass / fail / not checked / not applicable, for the screen
//   summary(project, context) -> { next, rows } | null     the "next transition" summary and the rows, for the timeline
//
// context: { firm, settings, benchmarkSets } (all optional). The settings default to M0's and the benchmark sets to M0's
// made-up sample sets.
//
// Every project is reviewed for its own stage's hand-off: development for delivery (T1), lease-up for stabilization (T2),
// completed for refinance or sale (T3). Every flag carries which transition it is about. It never changes the stage or any
// value: it only reports.

import { guardModule, missingDataFlag, sanitizeSettings, DEFAULT_SETTINGS, STAGE_VALUES } from '../shared/index.js'
import { CHECKS, MODULE_ID, prepare, nextTransition } from './checks.js'

export { MODULE_ID }

const settingsOf = (context) => sanitizeSettings(context?.settings ?? DEFAULT_SETTINGS)
const hasStage = (project) => STAGE_VALUES.includes(project?.data?.stage?.stage)

export function summary(project, context) {
  if (!hasStage(project)) return null
  const ctx = prepare(project, context, settingsOf(context))
  const rows = CHECKS.map((check) => check(ctx))
  return { next: nextTransition(ctx, rows), rows }
}

export function checklist(project, context) {
  return summary(project, context)?.rows ?? []
}

function runChecks(project, context) {
  if (!hasStage(project)) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The stage-change checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the stage-change checks did not run.'],
    }
  }
  const { next, rows } = summary(project, context)
  const count = (s) => rows.filter((r) => r.status === s).length
  const when = next.when ? `${next.when.text}${next.when.monthsAway === null ? '' : next.when.monthsAway >= 0 ? `, about ${next.when.monthsAway} months from the "as of" date` : `, ${-next.when.monthsAway} months before the "as of" date`}` : 'date not known'
  return {
    flags: rows.flatMap((r) => r.flags),
    notes: [
      `${rows.length} stage-change checks: ${count('pass')} passed, ${count('fail')} raised a flag, ${count('not_checked')} could not run, ${count('not_applicable')} belong to another stage.`,
      `Next transition: ${next.transition}, ${next.title} (${when}). Status: ${next.status.replace('_', ' ')}.`,
    ],
  }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
