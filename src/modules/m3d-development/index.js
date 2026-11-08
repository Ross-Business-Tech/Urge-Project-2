// M3D: Development risk (layer 3, stage-specific). "What can go wrong while the project is being built?"
//
//   run(project, context) -> { flags, notes }      the module interface every module shares (section 1d)
//   checklist(project, context) -> [row]           the four checks with pass / fail / not checked / not applicable, for the screen
//
// Runs for `development`. For `lease_up` it runs only what is still projected: the remaining schedule (completion to
// stabilization) and the capital stack (reserves left, takeout); the budget and the construction team are not applicable.
// For `completed` nothing applies (M3C covers completed projects).
//
// context (all optional):
//   settings    the section 1f settings (the lender's minimum DSCR is used); defaults if missing
//   benchmarks  benchmark sets keyed by stage (defaults to the bundled made-up sets)
//   firm        the firm record, used to name the developer when the team table leaves it out
// M3D never calls another module and never changes the record or the stage.

import {
  createFlagMaker,
  guardModule,
  missingDataFlag,
  sanitizeSettings,
  loadBenchmarks,
  keyRatios,
  isValidDate,
  BENCHMARK_SETS,
  STAGE_VALUES,
} from '../shared/index.js'
import { CHECKS, CHECK_TITLES } from './checks.js'

export const MODULE_ID = 'M3D'
export { LIMITS, CHECK_TITLES } from './checks.js'

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// The project as a development project, so the development key ratios (contingency, debt yield) can be read from the
// shared calculators for a lease-up project too. A copy: the record itself is never changed.
const asDevelopment = (record) => ({ ...record, data: { ...record.data, stage: { ...record.data.stage, stage: 'development' } } })

function prepare(project, context) {
  const ctx = isObject(context) ? context : {}
  const maker = createFlagMaker(MODULE_ID, project)
  const settings = sanitizeSettings(ctx.settings)
  const sets = isObject(ctx.benchmarks) ? ctx.benchmarks : BENCHMARK_SETS
  const asOfDate = project.data.stage.asOfDate
  let ratios = null
  return {
    record: project,
    stage: maker.stage,
    flag: (fields) => maker.flag({ stage_used: 'development', ...fields }),
    settings,
    set: loadBenchmarks(maker.stage, sets),
    firm: isObject(ctx.firm) ? ctx.firm : null,
    asOf: isValidDate(asOfDate) ? Number(asOfDate.slice(0, 4)) * 12 + Number(asOfDate.slice(5, 7)) - 1 : null,
    ratio: (id) => {
      ratios ??= keyRatios(asDevelopment(project), settings)
      return ratios.find((r) => r.id === id) ?? { ok: false, reason: `The ${id} ratio is not available.`, needs: [] }
    },
  }
}

const ROW_IDS = ['budget', 'schedule', 'capital', 'team']

// One checklist row per check. A check that stops with an error becomes a "could not check" row with a medium flag,
// so one broken check never hides the other three.
export function checklist(project, context) {
  const stage = project?.data?.stage?.stage
  const blankRow = (id, status, detail) => ({ id, title: CHECK_TITLES[id], status, detail, items: [], cells: [], flags: [] })
  if (stage === 'completed') return ROW_IDS.map((id) => blankRow(id, 'not_applicable', 'Development risk is not checked for a completed project.'))
  if (!STAGE_VALUES.includes(stage)) return ROW_IDS.map((id) => blankRow(id, 'not_checked', 'Choose a stage for this project first.'))
  const ctx = prepare(project, context)
  return CHECKS.map((check, n) => {
    try {
      return check(ctx)
    } catch {
      const id = ROW_IDS[n]
      return {
        id,
        title: CHECK_TITLES[id],
        status: 'not_checked',
        detail: 'This check stopped because some of the project data could not be read.',
        items: [],
        cells: [],
        flags: [
          ctx.flag({
            id: `M3D-${id}-check-failed`,
            severity: 'medium',
            title: `The ${CHECK_TITLES[id].toLowerCase()} check could not be completed.`,
            evidence: 'The check stopped because some of the project data could not be read, so findings may be missing.',
            follow_up: 'Review this part of the project by hand, and ask whoever maintains this tool to look at the data.',
          }),
        ],
      }
    }
  })
}

function runChecks(project, context) {
  const stage = project?.data?.stage?.stage
  if (!STAGE_VALUES.includes(stage)) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'Development risk', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the development risk checks did not run.'],
    }
  }
  if (stage === 'completed') {
    return { flags: [], notes: ['Stage used: completed. Development risk applies only to development and lease-up projects, so nothing was checked.'] }
  }
  const rows = checklist(project, context)
  const count = (s) => rows.filter((r) => r.status === s).length
  const notes = [
    stage === 'lease_up'
      ? 'Stage used: lease_up. Ran the development checks for what is still projected (the lease-up schedule, the reserves left and the takeout). Budget realism and team completeness do not apply once the building is finished.'
      : 'Stage used: development.',
    `${rows.length} development risk checks: ${count('pass')} passed, ${count('fail')} flagged, ${count('not_checked')} could not run fully, ${count('not_applicable')} not applicable.`,
  ]
  return { flags: rows.flatMap((r) => r.flags), notes }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
