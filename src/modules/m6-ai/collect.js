// Gathers what the fixed checks found, from every module, for one project. The AI never sees anything the rules did not
// already produce, plus a reduced table of the entered values (see payload.js).

import { run as runIntegrity } from '../m1-integrity/index.js'
import { run as runBenchmarks } from '../m2-benchmarks/index.js'
import { run as runDevelopment } from '../m3d-development/index.js'
import { run as runCompleted } from '../m3c-completed/index.js'
import { run as runTransitions } from '../m3t-transitions/index.js'
import { run as runScenarios } from '../m4-scenarios/index.js'
import { run as runSponsor } from '../m5-sponsor/index.js'
import { compareSeverity } from '../shared/index.js'

const MODULES = [
  ['M1', runIntegrity],
  ['M2', runBenchmarks],
  ['M3D', runDevelopment],
  ['M3C', runCompleted],
  ['M3T', runTransitions],
  ['M4', runScenarios],
  ['M5', runSponsor],
]

// Run every module on one project. A module that crashes is reported in the notes and does not stop the others
// (each module is already guarded, so this is a second safety net).
export function collectFlags(record, { firm, settings, result }) {
  const context = { firm, settings, facts: result?.facts, report: result?.report, projects: result?.projects }
  const flags = []
  const notes = []
  for (const [id, run] of MODULES) {
    try {
      const out = run(record, context)
      for (const f of out.flags ?? []) flags.push(f)
      for (const n of out.notes ?? []) notes.push(`${id}: ${n}`)
    } catch {
      notes.push(`${id}: this module could not be run.`)
    }
  }
  flags.sort((a, b) => compareSeverity(a.severity, b.severity))
  return { flags, notes }
}
