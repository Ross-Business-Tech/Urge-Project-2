// M2: the benchmarking engine (layer 2, shared engine, stage-specific benchmark sets).
//
//   run(project, context) -> { flags, notes }      the module interface every module shares (section 1d)
//   compareProject(project, context)               the full comparison table, for the screen (engine.js)
//
// context.benchmarkSets (optional): sets keyed by stage. M0's bundled, made-up sets are used if it is missing.
// M2 never calls another module and never changes the project.

import { guardModule, missingDataFlag } from '../shared/index.js'
import { compareProject } from './engine.js'

export { compareProject, UNITS } from './engine.js'

function runBenchmarks(project, context) {
  if (!project?.data?.stage?.stage) {
    return {
      flags: [missingDataFlag({ module: 'M2', stage_used: 'development', check: 'stage', checkTitle: 'Benchmarking', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so there is no benchmark set to compare against.'],
    }
  }
  const result = compareProject(project, context)
  const notes = result.ok
    ? [`Compared ${result.rows.length} figures with "${result.set.name}"${result.set.madeUp ? ' (made-up sample numbers, not market data)' : ''}.`]
    : [result.reason]
  return { flags: result.flags, notes }
}

export const run = guardModule('M2', runBenchmarks)
