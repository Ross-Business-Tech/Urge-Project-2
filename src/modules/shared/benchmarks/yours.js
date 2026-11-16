// "Your benchmarks": ranges the team types in themselves, so every comparison is against a number someone chose and can defend.
// Nothing here is assumed. A figure with no benchmark entered is simply not compared.
//
// One benchmark is a metric and a range:
//   { id, metric, low, high, typical?, unitType?, ami? }      e.g. interest rate, between 5.5% and 6.75%
// Dollar amounts are dollars, shares and rates are decimals (6.5% is 0.065), coverage is a plain number (1.25).
//
// Most metrics are checked by the same code that always compared rents, expenses and costs, so those entries are turned into the
// "benchmark sets" that code reads (toBenchmarkSets). The others (interest rate, coverage, and so on) are compared by
// compareYours in the M2 folder. The same entries feed M2, M3D and M3T; there is one set for every stage, because the team
// chooses the numbers and does not have to split them by stage.

import { STAGE_VALUES } from '../projectStage.js'
import { normalizeUnitType, normalizeAmi } from './index.js'

// `kind: 'set'` metrics are compared by the original rent / expense / cost / contingency code. `risky` is the side that
// matters most: a value past that edge is the more serious finding. The other side is still shown, as a lesser one.
export const METRICS = [
  { id: 'rent', slug: 'rent', label: 'Monthly rent per unit', unit: 'dollars', kind: 'set', qualifiers: ['unitType', 'ami'], help: 'For one unit type. Add the income level too if you want to compare restricted units.' },
  { id: 'expense', slug: 'expenses', label: 'Operating expenses per unit, per year', unit: 'dollars', kind: 'set' },
  { id: 'costHard', slug: 'hard-cost', label: 'Hard cost per sq ft', unit: 'dollars', kind: 'set' },
  { id: 'costSoft', slug: 'soft-cost', label: 'Soft cost per sq ft', unit: 'dollars', kind: 'set' },
  { id: 'costTotal', slug: 'total-cost', label: 'Total cost per sq ft', unit: 'dollars', kind: 'set' },
  { id: 'contingency', slug: 'contingency', label: 'Contingency, as a share of hard cost', unit: 'percent', kind: 'set' },
  { id: 'interestRate', slug: 'interest-rate', label: 'Interest rate (average of the loans)', unit: 'percent', kind: 'ratio', risky: 'above' },
  { id: 'dscr', slug: 'coverage', label: 'Debt service coverage', unit: 'times', kind: 'ratio', risky: 'below' },
  { id: 'debtToCost', slug: 'loan-to-cost', label: 'Loans as a share of total cost', unit: 'percent', kind: 'ratio', risky: 'above' },
  { id: 'equityShare', slug: 'equity-share', label: 'Equity as a share of total cost', unit: 'percent', kind: 'ratio', risky: 'below' },
  { id: 'breakEven', slug: 'break-even', label: 'Break-even occupancy', unit: 'percent', kind: 'ratio', risky: 'above' },
  { id: 'yieldOnCost', slug: 'yield-on-cost', label: 'Yield on cost', unit: 'percent', kind: 'ratio', risky: 'below' },
  { id: 'debtYield', slug: 'debt-yield', label: 'Debt yield', unit: 'percent', kind: 'ratio', risky: 'below' },
  { id: 'vacancy', slug: 'vacancy', label: 'Vacancy assumed', unit: 'percent', kind: 'ratio', risky: 'below' },
]

export const metricOf = (id) => METRICS.find((m) => m.id === id) ?? null

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// The key that makes two entries "the same benchmark": the metric, and for rent the unit type and income level.
export function keyOf(entry) {
  if (entry?.metric !== 'rent') return String(entry?.metric)
  const ami = normalizeAmi(entry.ami)
  return `rent|${normalizeUnitType(entry.unitType)}|${ami === undefined ? `?${entry.ami}` : (ami ?? 'market')}`
}

// Everything wrong with one entry, as plain sentences. An empty list means it can be used.
export function checkEntry(entry) {
  const problems = []
  const metric = metricOf(entry?.metric)
  if (!metric) return ['Choose what to compare.']
  const { low, high, typical } = entry
  if (!isNum(low) || !isNum(high)) problems.push('Enter both a low and a high figure.')
  else {
    if (low < 0 || high < 0) problems.push('Figures cannot be negative.')
    if (low > high) problems.push('The low figure is above the high figure.')
    if (metric.unit === 'percent' && (low > 1 || high > 1)) problems.push('A percentage cannot be above 100%.')
    if (typical !== null && typical !== undefined) {
      if (!isNum(typical)) problems.push('The typical figure is not a number.')
      else if (isNum(low) && isNum(high) && (typical < low || typical > high)) problems.push('The typical figure should sit between the low and the high.')
    }
  }
  if (metric.id === 'rent') {
    if (!normalizeUnitType(entry.unitType)) problems.push('Enter the unit type, such as studio, 1br or 2br.')
    if (normalizeAmi(entry.ami) === undefined) problems.push('The income level could not be read. Use a percentage such as 60, or leave it blank.')
  }
  return problems
}

// The entries that can be used: each valid, and the first of any that repeat. Everything else is ignored, never guessed at.
export function usableEntries(entries) {
  const seen = new Set()
  const out = []
  for (const e of Array.isArray(entries) ? entries : []) {
    if (checkEntry(e).length) continue
    const key = keyOf(e)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

// Problems across the whole list, keyed by entry id (including "repeats an earlier benchmark").
export function problemsByEntry(entries) {
  const out = {}
  const seen = new Set()
  for (const e of Array.isArray(entries) ? entries : []) {
    const own = checkEntry(e)
    if (!own.length) {
      const key = keyOf(e)
      if (seen.has(key)) own.push('This repeats an earlier benchmark, so it is not used.')
      seen.add(key)
    }
    if (own.length) out[e?.id] = own
  }
  return out
}

// The typical figure, or the middle of the range when none was given (rounded so 0.05 and 0.1 give 0.075, not 0.07500000000000001).
export const middleOf = (e) => (isNum(e.typical) ? e.typical : Math.round(((e.low + e.high) / 2) * 1e9) / 1e9)
const range = (e) => ({ low: e.low, median: middleOf(e), high: e.high })

// The benchmark sets the existing rent / expense / cost / contingency checks read: one for each stage, built from the entries
// that are usable. A part with no entry is null ("not entered"), and those checks then leave it alone. `madeUp` is false: these
// are the team's own numbers. Completed projects have no cost or contingency benchmark, as before.
export function toBenchmarkSets(entries) {
  const list = usableEntries(entries)
  const by = (id) => list.filter((e) => e.metric === id)
  const rents = by('rent').map((e) => ({ unitType: normalizeUnitType(e.unitType), amiLevel: normalizeAmi(e.ami), range: range(e) }))
  const one = (id) => (by(id)[0] ? range(by(id)[0]) : null)
  const sets = {}
  for (const stage of STAGE_VALUES) {
    const costs = { hard: one('costHard'), soft: one('costSoft'), total: one('costTotal') }
    sets[stage] = {
      stage,
      name: 'Your benchmarks',
      version: 1,
      madeUp: false,
      custom: true,
      rents,
      expensePerUnitYear: one('expense'),
      costPerSqft: stage === 'completed' ? null : costs,
      contingencyShare: stage === 'completed' ? null : one('contingency'),
    }
  }
  return sets
}

// ---------------------------------------------------------------------------------------------
// Saving: to a file the team can share, and back. Nothing is ever sent anywhere.
// ---------------------------------------------------------------------------------------------

export const FILE_KIND = 'deal-review-benchmarks'
export const FILE_VERSION = 1

// A date the ranges were last changed, as an ISO timestamp, or null when it is missing or not a real date.
export function readChangedAt(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function serializeEntries(entries, note = '', changedAt = null) {
  const when = readChangedAt(changedAt)
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, note: String(note).slice(0, 500), ...(when ? { changedAt: when } : {}), benchmarks: (Array.isArray(entries) ? entries : []).map(cleanEntry) }, null, 2)
}

const cleanEntry = (e) => ({
  id: String(e?.id ?? ''),
  metric: String(e?.metric ?? ''),
  ...(e?.metric === 'rent' ? { unitType: String(e.unitType ?? ''), ami: e.ami === null || e.ami === undefined ? '' : String(e.ami) } : {}),
  low: isNum(e?.low) ? e.low : null,
  high: isNum(e?.high) ? e.high : null,
  typical: isNum(e?.typical) ? e.typical : null,
})

// Read a saved file. Returns { ok: true, entries, changedAt } (changedAt is null when the file has no date) or { ok: false, reason }. A file with some bad entries is still read: the
// bad ones come back as they are, so the editor can show what is wrong with them, and they are never used.
export function parseEntries(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'That file is not a benchmarks file (it could not be read).' }
  }
  if (!data || data.kind !== FILE_KIND) return { ok: false, reason: 'That file is not a benchmarks file from this tool.' }
  if (data.version !== FILE_VERSION) return { ok: false, reason: `That benchmarks file is version ${data.version}, and this tool reads version ${FILE_VERSION}.` }
  if (!Array.isArray(data.benchmarks)) return { ok: false, reason: 'That benchmarks file has no list of benchmarks.' }
  if (data.benchmarks.length > 200) return { ok: false, reason: 'That benchmarks file has too many entries.' }
  const entries = data.benchmarks.filter((e) => e && typeof e === 'object').map(cleanEntry).map((e, i) => ({ ...e, id: e.id || `b${i + 1}` }))
  return { ok: true, entries, changedAt: readChangedAt(data.changedAt) }
}

export function newEntry(metric, id) {
  const m = metricOf(metric)
  return { id, metric, ...(m?.id === 'rent' ? { unitType: '', ami: '' } : {}), low: null, high: null, typical: null }
}
