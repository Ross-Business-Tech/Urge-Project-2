// M2: the benchmarking engine (layer 2, shared engine, stage-specific benchmark sets).
//
//   run(project, context) -> { flags, notes }      the module interface every module shares (section 1d)
//   compareProject(project, context)               the full comparison table, for the screen (engine.js)
//
// context.benchmarks (optional): the ranges the team typed in (see shared/benchmarks/yours.js). When it is given (even empty),
//   ONLY those are used, and a figure with no benchmark entered is not compared. This is how the app runs.
// context.benchmarkSets (optional): sets keyed by stage. Without either, M0's bundled, made-up sets are used (tests and samples).
// M2 never calls another module and never changes the project.

import { guardModule, missingDataFlag, toBenchmarkSets, usableEntries, sanitizeSettings, DEFAULT_SETTINGS } from '../shared/index.js'
import { compareProject } from './engine.js'
import { compareYours } from './yours.js'

export { compareProject, UNITS } from './engine.js'
export { compareYours } from './yours.js'

function runBenchmarks(project, context) {
  if (!project?.data?.stage?.stage) {
    return {
      flags: [missingDataFlag({ module: 'M2', stage_used: 'development', check: 'stage', checkTitle: 'Benchmarking', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so there is no benchmark set to compare against.'],
    }
  }
  const entries = Array.isArray(context?.benchmarks) ? context.benchmarks : null
  const withSets = entries ? { ...context, benchmarkSets: context.benchmarkSets ?? toBenchmarkSets(entries) } : context
  const result = compareProject(project, withSets)
  const yours = entries ? compareYours(project, entries, { settings: sanitizeSettings(context?.settings ?? DEFAULT_SETTINGS) }) : { rows: [], flags: [] }
  const notes = result.ok
    ? [`Compared ${result.rows.length + yours.rows.length} figures with "${result.set.name}"${result.set.madeUp ? ' (made-up sample numbers, not market data)' : ''}.`]
    : [result.reason]
  if (entries && usableEntries(entries).length === 0) notes.push('No benchmarks have been entered, so nothing was compared.')
  return { flags: [...result.flags, ...yours.flags], notes }
}

export const run = guardModule('M2', runBenchmarks)
