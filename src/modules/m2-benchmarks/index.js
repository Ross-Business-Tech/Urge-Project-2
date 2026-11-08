// M2: Benchmarking engine (layer 2, shared engine, one benchmark set per stage). "Are these rents, expenses and costs
// reasonable?"
//
//   run(project, context) -> { flags, notes }      the module interface every module shares (section 1d)
//   comparisons(project, context) -> [row]         every comparison, for the table on screen (see engine.js for a row)
//
// context.benchmarks (optional): benchmark sets keyed by stage, { development, lease_up, completed }. The bundled
// made-up sets are used when it is missing. The stage the underwriter chose picks the set; M2 never changes the stage.
//
// Severity: how far outside the range the value is, measured from the nearer end of the range:
//   up to 10% outside: low; up to 25%: medium; more: high.
// Only the direction that flatters the deal gets more than low: rents ABOVE comps, expenses BELOW comps, costs ABOVE
// comps. The other direction (rents below, expenses above, costs below) is shown and flagged low, as a question to ask.

import { BENCHMARK_SETS, createFlagMaker, citeCells, guardModule, loadBenchmarks, missingDataFlag, fmt, STAGE_VALUES } from '../shared/index.js'
import { compareProject, recordProblems } from './engine.js'

export const MODULE_ID = 'M2'

export const SEVERITY_BANDS = { low: 0.1, medium: 0.25 }
// The direction in which each metric makes the deal look better than it may be.
export const RISKY_DIRECTION = { rent: 'above', expenses: 'below', cost: 'above' }

const STAGE_WORDS = { development: 'development', lease_up: 'lease-up', completed: 'completed' }
const MAX_LISTED = 6

const setsFrom = (context) => (context && typeof context.benchmarks === 'object' && context.benchmarks !== null ? context.benchmarks : BENCHMARK_SETS)

// The benchmark set the project's stage picks: { ok, set, stage } or { ok: false, reason, stage }.
export function benchmarkSetFor(project, context) {
  const stage = project?.data?.stage?.stage
  if (!STAGE_VALUES.includes(stage)) return { ok: false, stage: null, reason: 'No stage has been chosen, so there is no benchmark set to use.' }
  const loaded = loadBenchmarks(stage, setsFrom(context))
  return loaded.ok ? { ok: true, set: loaded.set, stage } : { ok: false, reason: loaded.reason, stage }
}

// How serious a comparison row is, or null when it needs no flag of its own.
export function severityFor(row) {
  if (row.status !== 'above' && row.status !== 'below') return null
  if (row.status !== RISKY_DIRECTION[row.metric]) return 'low'
  if (!(typeof row.percentOutside === 'number')) return 'medium'
  if (row.percentOutside <= SEVERITY_BANDS.low) return 'low'
  if (row.percentOutside <= SEVERITY_BANDS.medium) return 'medium'
  return 'high'
}

// Every comparison for the table on screen. Never throws: a project M2 cannot read gives an empty list.
export function comparisons(project, context) {
  try {
    if (recordProblems(project).length) return []
    const chosen = benchmarkSetFor(project, context)
    if (!chosen.ok) return []
    return compareProject(project, chosen.set, chosen.stage).map((row) => Object.freeze({ ...row, severity: severityFor(row) }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

export function formatValue(row, value = row.value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'not entered'
  if (row.metric === 'rent') return `${fmt.usd(value)} a month`
  if (row.metric === 'expenses') return `${fmt.usd(value)} a year`
  return `${fmt.usd(value)} per sq ft`
}

// A dollar amount alone, for ranges ("$1,260 to $1,650").
export const formatAmount = (value) => (typeof value === 'number' && Number.isFinite(value) ? fmt.usd(value) : 'not entered')

export function formatRange(row) {
  if (!row.range) return 'no range'
  const { low, median, high } = row.range
  return `a range of ${formatAmount(low)} to ${formatAmount(high)} (middle ${formatAmount(median)})`
}

const pctText = (p) => `${Math.round(p * 100)}%`

function line(row) {
  const name = row.metric === 'rent' ? row.label.replace(/^Rent: /, '') : row.label
  const outside = typeof row.percentOutside === 'number' ? `, ${pctText(row.percentOutside)} ${row.status} the ${row.status === 'above' ? 'top' : 'bottom'} of the range` : ''
  return `${name}: ${formatValue(row)} vs. ${formatRange(row)}${outside}`
}

const listOf = (items) => (items.length <= MAX_LISTED ? items : [...items.slice(0, MAX_LISTED), `and ${items.length - MAX_LISTED} more`]).join('; ')

const setLine = (set, stage) => `Compared with the ${STAGE_WORDS[stage]} benchmark set${set.madeUp ? ' (made-up sample numbers, not market data)' : ` "${set.name}"`}.`

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

const worst = (rows) => rows.map(severityFor).sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b))[0]

const cells = (project, rows) => citeCells(project, [...new Set(rows.flatMap((r) => r.cellPaths ?? []))]).slice(0, 50)

// ---------------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------------

const TEXT = {
  rent: {
    above: {
      title: 'Rents are above what comparable properties charge.',
      follow_up: 'Which comparable properties and recent leases support these rents, and how long do you expect it to take to lease at them?',
    },
    below: {
      title: 'Rents are below what comparable properties charge.',
      follow_up: 'Please confirm these rents. Are they limited by a program or agreement, or is there room to raise them?',
    },
  },
  expenses: {
    above: {
      title: 'Operating expenses per unit are above comparable properties.',
      follow_up: 'What makes operating expenses higher than at comparable properties, and is any of it one-time?',
    },
    below: {
      title: 'Operating expenses per unit are below comparable properties.',
      follow_up: 'How will the property run at this expense level? Please share expenses from comparable properties you manage.',
    },
  },
  cost: {
    above: {
      title: (row) => `${row.label} is above comparable projects.`,
      follow_up: 'What drives the cost above comparable projects? Please share the contractor bid or cost estimate.',
    },
    below: {
      title: (row) => `${row.label} is below comparable projects.`,
      follow_up: 'Is the budget complete? Please share the contractor bid or cost estimate that supports these costs.',
    },
  },
}

function outsideFlag(maker, project, set, stage, id, rows, text) {
  const title = typeof text.title === 'function' ? text.title(rows[0]) : text.title
  return maker.flag({
    id,
    severity: worst(rows),
    title,
    evidence: clip(`${listOf(rows.map(line))}. ${setLine(set, stage)}`, 1000),
    cell_refs: cells(project, rows),
    follow_up: text.follow_up,
  })
}

function rentFlags(maker, project, set, stage, rows) {
  const flags = []
  const rent = rows.filter((r) => r.metric === 'rent')
  for (const dir of ['above', 'below']) {
    const hit = rent.filter((r) => r.status === dir)
    if (hit.length) flags.push(outsideFlag(maker, project, set, stage, `M2-rent-${dir}-comps`, hit, TEXT.rent[dir]))
  }
  const none = rent.filter((r) => r.status === 'no-benchmark')
  if (none.length) {
    flags.push(
      maker.flag({
        id: 'M2-rent-no-benchmark',
        severity: 'low',
        title: 'Some rents have no comparable benchmark, so they were not compared.',
        evidence: clip(`${listOf(none.map((r) => `${r.label.replace(/^Rent: /, '')} at ${formatValue(r)}: ${r.note}`))} Units with an affordability level are only compared with the same level, never with market rent. ${setLine(set, stage)}`, 1000),
        cell_refs: cells(project, none),
        follow_up: 'What rent limits or comparable rents apply to these units at their affordability level?',
      }),
    )
  }
  return flags
}

function otherFlags(maker, project, set, stage, rows) {
  const flags = []
  for (const row of rows.filter((r) => r.metric !== 'rent' && (r.status === 'above' || r.status === 'below'))) {
    const id = row.metric === 'cost' ? `M2-cost-${row.part}-${row.status}-comps` : `M2-${row.metric}-${row.status}-comps`
    flags.push(outsideFlag(maker, project, set, stage, id, [row], TEXT[row.metric][row.status]))
  }
  return flags
}

const CHECK_TITLES = { rent: 'The rent comparison', expenses: 'The expense comparison', cost: 'The cost-per-square-foot comparison' }

function missingFlags(project, stage, rows) {
  const flags = []
  for (const metric of ['rent', 'expenses', 'cost']) {
    const gaps = rows.filter((r) => r.metric === metric && r.status === 'missing')
    if (!gaps.length) continue
    const missing = [...new Set(gaps.map((r) => r.note))]
    const fill = [...new Set(gaps.flatMap((r) => r.missingFill ?? []))]
    flags.push(
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: metric,
        checkTitle: CHECK_TITLES[metric],
        // The follow-up repeats this list and is capped at 500 characters, so keep it short.
        missing: clip([listOf(missing), ...(fill.length ? [`fill in: ${fill.join(', ')}`] : [])].join('; '), 400),
        cell_refs: cells(project, gaps),
      }),
    )
  }
  return flags
}

function runBenchmarks(project, context) {
  const stage = project?.data?.stage?.stage
  if (!STAGE_VALUES.includes(stage)) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The market comparison', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so M2 could not pick a benchmark set.'],
    }
  }
  const problems = recordProblems(project)
  if (problems.length) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: stage, check: 'record', checkTitle: 'The market comparison', missing: `the project record is incomplete (${problems.join(', ')})` })],
      notes: ['The project record could not be read, so nothing was compared.'],
    }
  }
  const chosen = benchmarkSetFor(project, context)
  if (!chosen.ok) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: stage, check: 'benchmarks', checkTitle: 'The market comparison', missing: chosen.reason })],
      notes: [`No usable benchmark set for the ${STAGE_WORDS[stage]} stage.`],
    }
  }

  const maker = createFlagMaker(MODULE_ID, project)
  const { set } = chosen
  const rows = compareProject(project, set, stage)
  const flags = [...rentFlags(maker, project, set, stage, rows), ...otherFlags(maker, project, set, stage, rows), ...missingFlags(project, stage, rows)]
  const counted = rows.filter((r) => ['within', 'above', 'below'].includes(r.status))
  const within = counted.filter((r) => r.status === 'within').length
  return {
    flags,
    notes: [
      `Stage used: ${stage}. Benchmark set: ${set.name} (version ${set.version}${set.madeUp ? ', made-up sample' : ''}).`,
      `${counted.length} comparison${counted.length === 1 ? '' : 's'} made: ${within} within the range, ${counted.length - within} outside.`,
    ],
  }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runBenchmarks)
