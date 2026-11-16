// Compares a project with the benchmark ranges the team typed in, for the figures the original rent / expense / cost checks
// never covered: the interest rate, debt service coverage, loan-to-cost, equity share, break-even occupancy, yield on cost, debt
// yield and the vacancy assumed. (Rents, expenses, costs and contingency are compared by the original code, which reads the same
// entries through toBenchmarkSets.)
//
// Nothing is guessed. A figure that cannot be worked out is shown as "not available" with the reason, never as a finding, and a
// figure with no benchmark entered is not in the list at all.

import { keyRatios, fmt, citeCells, createFlagMaker, metricOf, usableEntries, middleOf, DEBT_SOURCE_TYPES, DEFAULT_SETTINGS } from '../shared/index.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const RATIO = new Set(['dscr', 'debtToCost', 'equityShare', 'breakEven', 'yieldOnCost', 'debtYield'])

// How far past the nearer edge of the range a value is, as a share of that edge (0.1 is 10% past it).
function beyondEdge(value, range) {
  if (value > range.high) return range.high === 0 ? Infinity : value / range.high - 1
  if (value < range.low) return range.low === 0 ? 1 : 1 - value / range.low
  return 0
}

const show = (unit, v, digits) => (unit === 'percent' ? fmt.pct(v, digits) : unit === 'times' ? fmt.times(v) : fmt.usd(v))
const digitsFor = (metric) => (metric.id === 'interestRate' || metric.id === 'vacancy' ? 2 : 1)

// An entered range in words, such as "5.00% to 6.50%" or "$1,400 to $1,800".
export function rangeText(entry) {
  const metric = metricOf(entry?.metric)
  if (!metric || !isNum(entry.low) || !isNum(entry.high)) return ''
  const digits = digitsFor(metric)
  return `${show(metric.unit, entry.low, digits)} to ${show(metric.unit, entry.high, digits)}`
}

// The value to compare, or why there is none. { ok: true, value, note?, paths } or { ok: false, reason }.
function valueOf(metric, record, ratios) {
  if (metric.id === 'interestRate') {
    const rows = record.data.sources.rows.map((r, i) => ({ r, i })).filter(({ r }) => DEBT_SOURCE_TYPES.includes(r.type) && isNum(r.amount) && r.amount > 0)
    if (rows.length === 0) return { ok: false, reason: 'No loans with an amount are entered.' }
    const usable = rows.filter(({ r }) => isNum(r.interestRate) && r.interestRate >= 0 && r.interestRate <= 1)
    if (usable.length === 0) return { ok: false, reason: 'No loan has a believable interest rate (between 0% and 100%).' }
    const total = usable.reduce((a, { r }) => a + r.amount, 0)
    const value = usable.reduce((a, { r }) => a + r.amount * r.interestRate, 0) / total
    const left = rows.length - usable.length
    return { ok: true, value, note: left ? `${left} loan${left === 1 ? '' : 's'} without a believable rate ${left === 1 ? 'is' : 'are'} left out.` : '', paths: usable.flatMap(({ i }) => [`sources.rows.${i}.interestRate`, `sources.rows.${i}.amount`]) }
  }
  if (metric.id === 'vacancy') {
    const v = record.data.residentialIncome.stabilizedVacancy
    return isNum(v) && v >= 0 && v <= 1 ? { ok: true, value: v, paths: ['residentialIncome.stabilizedVacancy'] } : { ok: false, reason: 'No residential vacancy is entered.' }
  }
  if (RATIO.has(metric.id)) {
    const r = ratios.find((x) => x.id === metric.id)
    if (!r) return { ok: false, reason: 'That figure is not worked out for this project.' }
    if (!r.ok || !isNum(r.value)) return { ok: false, reason: r.reason ?? 'It cannot be worked out from what is entered.' }
    // Only the sources with an amount, and for the loan-based figures the rate and term of the loans themselves.
    const paths = record.data.sources.rows.flatMap((row, i) => {
      if (!isNum(row.amount) || row.amount <= 0) return []
      if (metric.id === 'equityShare' || !DEBT_SOURCE_TYPES.includes(row.type)) return [`sources.rows.${i}.amount`]
      return [`sources.rows.${i}.amount`, `sources.rows.${i}.interestRate`, `sources.rows.${i}.termMonths`]
    })
    return { ok: true, value: r.value, paths }
  }
  return { ok: false, reason: 'Unknown figure.' }
}

// rows: one for every entry that applies, for the table. flags: one for every figure outside its range.
export function compareYours(project, entries, { settings = DEFAULT_SETTINGS } = {}) {
  const maker = createFlagMaker('M2', project)
  let ratios = []
  try {
    ratios = keyRatios(project, settings)
  } catch {
    ratios = []
  }
  const rows = []
  const flags = []
  for (const e of usableEntries(entries)) {
    const metric = metricOf(e.metric)
    if (!metric || metric.kind !== 'ratio') continue // rents, expenses, costs and contingency are compared by the original code
    const range = { low: e.low, median: middleOf(e), high: e.high }
    const digits = digitsFor(metric)
    const wanted = `${show(metric.unit, range.low, digits)} to ${show(metric.unit, range.high, digits)}`
    const v = valueOf(metric, project, ratios)
    const base = { id: `yours-${e.id}`, metric: 'yours', slug: metric.slug, label: metric.label, range, wanted, unit: metric.unit }
    if (!v.ok) {
      rows.push({ ...base, status: 'not_available', value: null, detail: `Your range is ${wanted}. ${v.reason}`, cells: [] })
      continue
    }
    const position = v.value < range.low ? 'below' : v.value > range.high ? 'above' : 'within'
    const cells = citeCells(project, v.paths)
    const past = beyondEdge(v.value, range)
    const detail = `${show(metric.unit, v.value, digits)} against your range of ${wanted}: ${position === 'within' ? 'within' : position} the range.${v.note ? ` ${v.note}` : ''}`
    rows.push({ ...base, status: position, value: v.value, past, detail, cells })
    if (position === 'within') continue

    // The side that matters most is more serious the further past it the value is; the other side is a lesser finding.
    const risky = position === metric.risky
    const severity = risky ? (past >= 0.2 ? 'high' : past >= 0.05 ? 'medium' : 'low') : past >= 0.25 ? 'medium' : 'low'
    flags.push(
      maker.flag({
        id: `M2-yours-${metric.slug}-${position}`,
        severity,
        title: `${metric.label} is ${position} your benchmark range.`,
        evidence: `${metric.label}: ${show(metric.unit, v.value, digits)} against your range of ${wanted} (${position} it).${v.note ? ` ${v.note}` : ''}`,
        cell_refs: cells.slice(0, 50),
        follow_up: `${metric.label} is ${position} the range you set (${wanted}). What explains it, and is the benchmark still the right one for this project?`,
      }),
    )
  }
  return { rows, flags }
}
