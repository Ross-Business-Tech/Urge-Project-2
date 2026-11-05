// The benchmark loader. Benchmark sets are plain data keyed by stage (see sets.js); this file checks them and answers
// the lookups M2 needs. Nothing here guesses: when no comparable benchmark exists, it says so with a reason.

import { STAGE_VALUES } from '../projectStage.js'
import { BENCHMARK_SETS } from './sets.js'

const isRange = (x) =>
  x !== null && typeof x === 'object' &&
  [x.low, x.median, x.high].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
  x.low <= x.median && x.median <= x.high

// Everything wrong with a set, as plain sentences. An empty list means the set is sound.
export function checkBenchmarkSet(set, expectedStage) {
  const problems = []
  if (set === null || typeof set !== 'object') return ['The benchmark set is missing.']
  if (!STAGE_VALUES.includes(set.stage)) problems.push(`Unknown stage "${set.stage}".`)
  else if (expectedStage && set.stage !== expectedStage) problems.push(`The set is for "${set.stage}", not "${expectedStage}".`)
  if (typeof set.name !== 'string' || !set.name) problems.push('The set has no name.')
  if (!Number.isInteger(set.version) || set.version < 1) problems.push('The set has no version number.')
  if (typeof set.madeUp !== 'boolean') problems.push('The set does not say whether its numbers are made up.')
  if (!Array.isArray(set.rents) || set.rents.length === 0) problems.push('The set has no rents.')
  else {
    const seen = new Set()
    for (const [i, row] of set.rents.entries()) {
      const label = `Rent row ${i + 1}`
      if (!row || typeof row.unitType !== 'string' || !row.unitType) problems.push(`${label} has no unit type.`)
      else if (normalizeUnitType(row.unitType) !== row.unitType) problems.push(`${label}: unit type "${row.unitType}" is not in its standard form.`)
      if (row && row.amiLevel !== null && !(Number.isInteger(row.amiLevel) && row.amiLevel > 0 && row.amiLevel <= 200)) problems.push(`${label} has an AMI level that is not a whole number from 1 to 200.`)
      if (!row || !isRange(row.range)) problems.push(`${label} has a range that is not low <= median <= high.`)
      const key = `${row?.unitType}|${row?.amiLevel}`
      if (seen.has(key)) problems.push(`${label} repeats ${row?.unitType} at AMI ${row?.amiLevel ?? 'market'}.`)
      seen.add(key)
    }
  }
  if (!isRange(set.expensePerUnitYear)) problems.push('The expense range is not low <= median <= high.')
  if (set.costPerSqft !== null && !(set.costPerSqft && ['hard', 'soft', 'total'].every((k) => isRange(set.costPerSqft[k])))) problems.push('The cost ranges (hard, soft, total) are not all low <= median <= high, or null.')
  if (set.contingencyShare !== null && !(isRange(set.contingencyShare) && set.contingencyShare.high <= 1)) problems.push('The contingency range is not a share between 0 and 1.')
  return problems
}

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

// The benchmark set for a stage. Returns { ok: true, set } or { ok: false, reason }. Never throws.
// `sets` lets a test or a later phase supply its own sets; it defaults to the bundled ones.
export function loadBenchmarks(stage, sets = BENCHMARK_SETS) {
  if (!STAGE_VALUES.includes(stage)) return { ok: false, reason: 'No stage has been chosen, so there is no benchmark set to use.' }
  if (!Object.hasOwn(sets, stage)) return { ok: false, reason: `There is no benchmark set for the "${stage}" stage.` }
  const set = sets[stage]
  const problems = checkBenchmarkSet(set, stage)
  if (problems.length) return { ok: false, reason: `The benchmark set for "${stage}" is not usable: ${problems[0]}` }
  return { ok: true, set: deepFreeze(structuredClone(set)) }
}

// "1 BR", "1-bdr", "One bedroom", "Studio" -> "1br"; anything else is returned lower-cased and trimmed.
export function normalizeUnitType(text) {
  const t = String(text ?? '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()
  if (!t) return ''
  if (/^(studio|efficiency|0 ?(br|bdr|bd|bed|bedroom)s?)$/.test(t)) return 'studio'
  // A bedroom count needs its word ("1 br", "two bedroom"); a bare "1" is not guessed at. Extra words ("1 bed 1 bath") are ignored.
  const words = { one: 1, two: 2, three: 3, four: 4 }
  const m = t.match(/^(\d|one|two|three|four)\s*(br|bdr|bd|bed|beds|bedroom|bedrooms)\b/)
  if (m) return `${words[m[1]] ?? m[1]}br`
  return t
}

// "60%", "60% AMI", 60, 0.6 -> 60. Blank or "market" -> null (a market-rate unit). Anything unreadable -> undefined.
export function normalizeAmi(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined
    const ami = value <= 1 ? Math.round(value * 100) : Math.round(value)
    return ami >= 1 && ami <= 200 ? ami : undefined
  }
  const t = String(value).toLowerCase().trim()
  if (t === '' || /^(market|market rate|mkt|none|n\/a|na|-)$/.test(t)) return null
  const m = t.match(/^(\d+(?:\.\d+)?)\s*%?\s*(ami)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  return n > 0 && n <= 200 ? Math.round(n) : undefined
}

const NO_BENCHMARK = (reason) => ({ ok: false, kind: 'no-comparable-benchmark', reason })

// The rent range for one unit type. A unit with an AMI level is compared only against that AMI level, never against market rent.
export function rentBenchmark(set, unitType, amiLevel) {
  const type = normalizeUnitType(unitType)
  if (!type) return NO_BENCHMARK('The unit type is blank, so there is nothing to compare.')
  const ami = normalizeAmi(amiLevel)
  if (ami === undefined) return NO_BENCHMARK(`The affordability level "${amiLevel}" could not be read as a percentage of AMI.`)
  const row = set.rents.find((x) => x.unitType === type && x.amiLevel === ami)
  if (!row) {
    return NO_BENCHMARK(ami === null ? `No market-rent benchmark for "${unitType}" units.` : `No benchmark for "${unitType}" units at ${ami}% AMI, and market rent is not a fair comparison for them.`)
  }
  return { ok: true, range: row.range, basis: ami === null ? 'market' : `${ami}% AMI` }
}

export function expenseBenchmark(set) {
  return { ok: true, range: set.expensePerUnitYear }
}

// metric: 'hard' | 'soft' | 'total'. Completed projects have no cost benchmark.
export function costBenchmark(set, metric) {
  if (!set.costPerSqft) return { ok: false, kind: 'not-applicable', reason: `Cost per square foot is not compared for the "${set.stage}" stage.` }
  const range = Object.hasOwn(set.costPerSqft, metric) ? set.costPerSqft[metric] : null
  return range ? { ok: true, range } : { ok: false, kind: 'unknown-metric', reason: `"${metric}" is not a cost benchmark (use hard, soft or total).` }
}

export function contingencyBenchmark(set) {
  if (!set.contingencyShare) return { ok: false, kind: 'not-applicable', reason: `Contingency is not compared for the "${set.stage}" stage.` }
  return { ok: true, range: set.contingencyShare }
}

// Where a value sits against a range. `percentFromMedian` is signed (+0.2 is 20% above the median).
export function compareToRange(value, range) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'The value is not a number.' }
  if (!isRange(range)) return { ok: false, reason: 'The range is not usable.' }
  const position = value < range.low ? 'below' : value > range.high ? 'above' : 'within'
  return { ok: true, position, percentFromMedian: range.median === 0 ? null : value / range.median - 1 }
}
