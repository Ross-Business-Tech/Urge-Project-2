// M3C: Completed risk (layer 3). "What can go wrong with a property that is already operating?"
//
//   run(project, context) -> { flags, notes }   the module interface every module shares (section 1d), wrapped in the guard
//   checklist(project, context) -> [row]        the four checks with pass / fail / not checked / not applicable, for the screen
//
// context.settings: the lender's thresholds (section 1f); the defaults are used for anything missing or out of range.
// Runs in full for `completed`. For `lease_up` it runs only what is already actual (the rent roll and expenses to date)
// and says so in the notes. For `development` there is nothing actual yet, so every check is "not applicable".

import { createFlagMaker, guardModule, sanitizeSettings, STAGE_VALUES } from '../shared/index.js'
import { CHECKS, CHECK_INFO, APPLIES, prepare, MODULE_ID, LIMITS } from './checks.js'

export { MODULE_ID, LIMITS, CHECK_INFO }

const placeholderRows = (status, detail) => CHECK_INFO.map((c) => ({ ...c, status, detail, cells: [], flags: [] }))

const hasStage = (project) => STAGE_VALUES.includes(project?.data?.stage?.stage)

export function checklist(project, context) {
  if (!hasStage(project)) return placeholderRows('not_checked', 'Choose the project\'s stage first.')
  const stage = project.data.stage.stage
  if (!APPLIES[stage]) return placeholderRows('not_applicable', 'These checks run for completed and lease-up projects. A project in development has no actual results yet.')
  const maker = createFlagMaker(MODULE_ID, project)
  const ctx = prepare(project, sanitizeSettings(context?.settings), maker.flag)
  return CHECKS.map((check) => check(ctx))
}

function runChecks(project, context) {
  if (!hasStage(project)) return { flags: [], notes: ['No stage chosen, so the completed-risk checks did not run.'] }
  const stage = project.data.stage.stage
  if (!APPLIES[stage]) return { flags: [], notes: [`Stage used: ${stage}. The completed-risk checks run only for completed and lease-up projects.`] }

  const rows = checklist(project, context)
  const notes = [`Stage used: ${stage}.`]
  if (stage === 'lease_up') {
    notes.push('Lease-up: only the parts that are already actual were checked (the rent roll and expenses to date). The NOI comparison, vacancy and loan maturity wait until the project is completed; the lease-up checks (M3T) and development checks (M3D) cover what is still projected.')
  }
  const seen = new Set()
  const flags = []
  for (const f of rows.flatMap((r) => r.flags)) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    flags.push(f)
  }
  const count = (s) => rows.filter((r) => r.status === s).length
  notes.push(`${rows.length} completed-risk checks: ${count('pass')} passed, ${count('fail')} raised a concern, ${count('not_checked')} could not run, ${count('not_applicable')} not applicable.`)
  return { flags, notes: [...notes, ...t12Notes(project)] }
}

// What the T-12 looked like, so a reader knows what the actuals checks were based on.
function t12Notes(project) {
  const rows = Array.isArray(project.data.t12?.rows) ? project.data.t12.rows : []
  if (!rows.length) return ['No T-12 is loaded.']
  const months = new Set()
  let undated = 0
  for (const r of rows) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof r?.month === 'string' ? r.month.trim() : '')
    if (m) months.add(`${m[1]}-${m[2]}`)
    else undated++
  }
  const out = [`T-12: ${months.size} month${months.size === 1 ? '' : 's'} used${months.size < 12 ? ' (fewer than 12, so yearly figures are annualized from what is there)' : ''}.`]
  if (undated) out.push(`${undated} T-12 row${undated === 1 ? ' has' : 's have'} no real month and ${undated === 1 ? 'was' : 'were'} left out.`)
  if (rows.length - undated > months.size) out.push('A month appears more than once in the T-12; the later row was used.')
  return out
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
