// M2 engine: works out each comparison row (rents, expenses per unit, cost per square foot) for one project against one
// benchmark set. The same engine runs for every stage; only the set and where the project's numbers come from change.
//
// A row is:
//   { id, metric, label, basis, stage, setName, madeUp, unit, value, range, status, percentOutside, cellPaths, note,
//     direction, unitType?, amiLevel? }
// status: 'within' | 'above' | 'below' | 'no-benchmark' | 'missing' | 'not-applicable'
// Nothing here guesses: a blank or unbelievable input gives status 'missing' with the reason, never zero.

import { projectSchema, normalizeAmi, normalizeUnitType, rentBenchmark, expenseBenchmark, costBenchmark, compareToRange, noi, totalDevelopmentCost } from '../shared/index.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const believable = (v, max = 1e12) => isNum(v) && v >= 0 && v <= max
const sum = (list) => list.reduce((t, v) => t + v, 0)

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const SOFT_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Soft costs')).map((r) => r.key)
const OPEX_KEYS = projectSchema.find((g) => g.id === 'operatingExpenses').rows.map((r) => r.key)

export const UNITS = {
  rent: 'per unit per month',
  expense: 'per unit per year',
  sqft: 'per square foot',
}

// Which project numbers are compared at each stage, in plain words.
const RENT_BASIS = {
  development: 'Projected rent from the application',
  lease_up: 'Rent on the application rent roll',
  completed: 'In-place rent on the rent roll',
}

// Is the record shaped like a project record, enough for M2 to read? Returns the list of what is missing.
export function recordProblems(project) {
  const d = project?.data
  if (!d || typeof d !== 'object') return ['the project record']
  const problems = []
  const table = (g) => d[g] && Array.isArray(d[g].rows)
  const grid = (g) => d[g] && d[g].lines && typeof d[g].lines === 'object'
  if (!table('residentialIncome')) problems.push('the residential income table')
  if (!table('commercialIncome')) problems.push('the commercial income table')
  if (!table('otherIncome')) problems.push('the other income table')
  if (!grid('operatingExpenses')) problems.push('the operating expenses')
  if (!table('otherExpenses')) problems.push('the other operating expenses')
  if (!grid('budget')) problems.push('the development budget')
  if (!table('t12')) problems.push('the T-12 table')
  if (!table('sources')) problems.push('the sources of money')
  return problems
}

const rowLabel = (row, i) => {
  const type = typeof row.unitType === 'string' && row.unitType.trim() ? row.unitType.trim() : `row ${i + 1}`
  const ami = normalizeAmi(row.amiLevel)
  const level = ami === null ? 'market rate' : ami === undefined ? `"${row.amiLevel}" AMI` : `${ami}% AMI`
  return `${type} (${level})`
}

function compared(base, value, range) {
  const c = compareToRange(value, range)
  if (!c.ok) return { ...base, value, range: null, status: 'missing', note: c.reason }
  const percentOutside = c.position === 'above' ? (range.high > 0 ? value / range.high - 1 : null) : c.position === 'below' ? (range.low > 0 ? 1 - value / range.low : null) : 0
  return { ...base, value, range, status: c.position, percentOutside }
}

// ---------------------------------------------------------------------------------------------
// Rents
// ---------------------------------------------------------------------------------------------

function residentialRows(project) {
  return project.data.residentialIncome.rows.map((row, i) => ({ row: row ?? {}, i }))
}

function rentRows(project, set, ctx) {
  const out = []
  const rows = residentialRows(project)
  if (rows.length === 0) {
    out.push({ ...ctx, id: 'rent', metric: 'rent', label: 'Rents', basis: RENT_BASIS[ctx.stage], unit: UNITS.rent, value: null, range: null, status: 'missing', note: 'No unit types are entered in the residential income table.', cellPaths: [] })
    return out
  }
  for (const { row, i } of rows) {
    const p = (k) => `residentialIncome.rows.${i}.${k}`
    const base = {
      ...ctx,
      id: `rent-${i}`,
      metric: 'rent',
      label: `Rent: ${rowLabel(row, i)}`,
      basis: RENT_BASIS[ctx.stage],
      unit: UNITS.rent,
      unitType: row.unitType ?? null,
      amiLevel: row.amiLevel ?? null,
      cellPaths: [p('unitType'), p('amiLevel'), p('monthlyRent')],
    }
    const hasType = normalizeUnitType(row.unitType) !== ''
    if (!hasType) {
      out.push({ ...base, value: null, range: null, status: 'missing', note: `The unit type in residential row ${i + 1} is blank.` })
      continue
    }
    if (!believable(row.monthlyRent, 1e7)) {
      const what = row.monthlyRent === null || row.monthlyRent === undefined || row.monthlyRent === '' ? 'blank' : `${row.monthlyRent}, which is not a believable rent`
      out.push({ ...base, value: null, range: null, status: 'missing', note: `The monthly rent for ${rowLabel(row, i)} is ${what}.` })
      continue
    }
    const b = rentBenchmark(set, row.unitType, row.amiLevel)
    if (!b.ok) {
      out.push({ ...base, value: row.monthlyRent, range: null, status: 'no-benchmark', note: b.reason })
      continue
    }
    out.push({ ...compared(base, row.monthlyRent, b.range), comparedTo: b.basis })
  }
  return out
}

// T-12 months, one per calendar month (a later row for the same month replaces an earlier one), oldest first.
function t12Months(project) {
  const byMonth = new Map()
  project.data.t12.rows.forEach((row, i) => {
    const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof row?.month === 'string' ? row.month : '')
    if (m) byMonth.set(`${m[1]}-${m[2]}`, { row, i, month: `${m[1]}-${m[2]}` })
  })
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
}

// Lease-up looks at the latest 3 months (the run rate); completed looks at the whole T-12.
const recentMonths = (months, stage) => (stage === 'lease_up' ? months.slice(-3) : months)

// Achieved rent from the T-12: residential revenue net of concessions, per unit per month, against the unit-weighted
// benchmark for the project's unit mix. Lease-up and completed only, and only when a T-12 is loaded.
function achievedRentRow(project, set, ctx) {
  if (ctx.stage === 'development') return null
  const months = recentMonths(t12Months(project), ctx.stage).filter(({ row }) => isNum(row.residentialRevenue))
  if (months.length === 0) return null
  const base = {
    ...ctx,
    id: 'rent-achieved',
    metric: 'rent',
    label: 'Achieved rent from the T-12 (all units, after free rent)',
    basis: `Average of ${months.length} month${months.length === 1 ? '' : 's'} of the T-12 (${months[0].month} to ${months.at(-1).month})`,
    unit: UNITS.rent,
    cellPaths: months.flatMap(({ i }) => [`t12.rows.${i}.residentialRevenue`, `t12.rows.${i}.concessions`]),
  }
  const bad = months.find(({ row }) => !believable(row.residentialRevenue) || (row.concessions !== null && row.concessions !== undefined && !(isNum(row.concessions) && Math.abs(row.concessions) <= 1e12)))
  if (bad) return { ...base, value: null, range: null, status: 'missing', note: `The T-12 for ${bad.month} has a revenue or concessions figure that is not believable.` }

  const rows = residentialRows(project).filter(({ row }) => believable(row.units, 1e7) && row.units > 0)
  const units = sum(rows.map(({ row }) => row.units))
  if (units <= 0) return { ...base, value: null, range: null, status: 'missing', note: 'The number of units is not entered, so rent per unit cannot be worked out.' }
  base.cellPaths = [...base.cellPaths, ...rows.map(({ i }) => `residentialIncome.rows.${i}.units`)]

  const monthly = sum(months.map(({ row }) => row.residentialRevenue - Math.abs(isNum(row.concessions) ? row.concessions : 0))) / months.length
  const value = monthly / units

  // Weighted benchmark for the unit mix. Every unit type must have a comparable benchmark.
  const weighted = { low: 0, median: 0, high: 0 }
  for (const { row, i } of rows) {
    const b = rentBenchmark(set, row.unitType, row.amiLevel)
    if (!b.ok) return { ...base, value, range: null, status: 'no-benchmark', note: `${rowLabel(row, i)}: ${b.reason}` }
    for (const k of ['low', 'median', 'high']) weighted[k] += (b.range[k] * row.units) / units
  }
  const range = { low: Math.round(weighted.low), median: Math.round(weighted.median), high: Math.round(weighted.high) }
  return { ...compared(base, value, range), comparedTo: rows.length === 1 ? rentBenchmark(set, rows[0].row.unitType, rows[0].row.amiLevel).basis : 'the unit mix' }
}

// ---------------------------------------------------------------------------------------------
// Expenses per unit per year
// ---------------------------------------------------------------------------------------------

function unitCount(project) {
  const rows = residentialRows(project).filter(({ row }) => isNum(row.units))
  if (rows.some(({ row }) => !believable(row.units, 1e7))) return { ok: false, reason: 'A number of units is not believable (negative or too large).' }
  const units = sum(rows.map(({ row }) => row.units))
  if (units <= 0) return { ok: false, reason: 'The number of residential units is not entered.' }
  return { ok: true, value: units, paths: rows.map(({ i }) => `residentialIncome.rows.${i}.units`) }
}

const expensePaths = (project) => [
  ...OPEX_KEYS.filter((k) => isNum(project.data.operatingExpenses.lines[k]?.amount)).map((k) => `operatingExpenses.lines.${k}.amount`),
  ...project.data.otherExpenses.rows.map((r, i) => (isNum(r?.amount) ? `otherExpenses.rows.${i}.amount` : null)).filter(Boolean),
]

// Yearly expenses from the T-12 (lease-up: the latest 3 months; completed: every month), or null if there is no T-12.
function t12Expenses(project, stage) {
  const months = recentMonths(t12Months(project), stage).filter(({ row }) => [...OPEX_KEYS, 'otherExpenses'].some((k) => isNum(row[k])))
  if (months.length === 0) return null
  let total = 0
  const paths = []
  for (const { row, i, month } of months) {
    for (const k of [...OPEX_KEYS, 'otherExpenses']) {
      if (row[k] === null || row[k] === undefined) continue
      if (!believable(row[k])) return { ok: false, reason: `The T-12 for ${month} has an expense that is not believable (${row[k]}).` }
      total += row[k]
      paths.push(`t12.rows.${i}.${k}`)
    }
  }
  return { ok: true, value: (total / months.length) * 12, paths, basis: `${stage === 'lease_up' ? 'Run rate from the latest' : 'T-12 expenses over'} ${months.length} month${months.length === 1 ? '' : 's'} (${months[0].month} to ${months.at(-1).month}), times 12 ÷ ${months.length}` }
}

function expenseRow(project, set, ctx) {
  const base = { ...ctx, id: 'expenses', metric: 'expenses', label: 'Operating expenses per unit', unit: UNITS.expense, cellPaths: [] }
  const units = unitCount(project)

  let total
  if (ctx.stage !== 'development') {
    total = t12Expenses(project, ctx.stage)
    if (total === null && ctx.stage === 'completed') {
      return { ...base, basis: 'T-12 expenses', value: null, range: null, status: 'missing', note: 'No T-12 with expenses is loaded, so actual expenses cannot be compared.', missingFill: ['the T-12 (monthly expenses)'] }
    }
  }
  if (!total) {
    const n = noi(project) // the shared calculator adds up the expense lines
    total = n.ok
      ? { ok: true, value: n.expenses, paths: expensePaths(project), basis: ctx.stage === 'lease_up' ? 'Underwritten expenses (no T-12 expenses yet)' : 'Underwritten expenses from the application' }
      : { ok: false, reason: n.reason, needs: n.needs }
  }
  base.basis = total.basis ?? 'Operating expenses'
  if (!total.ok) return { ...base, value: null, range: null, status: 'missing', note: total.reason, missingFill: (total.needs ?? []).map((x) => x.label) }
  if (!units.ok) return { ...base, value: null, range: null, status: 'missing', note: units.reason, missingFill: ['Residential income (number of units)'] }
  base.cellPaths = [...total.paths, ...units.paths]
  base.basis = `${base.basis}, across ${units.value} unit${units.value === 1 ? '' : 's'}`
  return compared(base, total.value / units.value, expenseBenchmark(set).range)
}

// ---------------------------------------------------------------------------------------------
// Cost per square foot (development and lease-up only)
// ---------------------------------------------------------------------------------------------

function squareFeet(project) {
  const res = residentialRows(project).filter(({ row }) => isNum(row.units) && row.units > 0)
  const com = project.data.commercialIncome.rows.map((row, i) => ({ row: row ?? {}, i })).filter(({ row }) => isNum(row.sqft))
  const noSqft = res.filter(({ row }) => !believable(row.sqft, 1e7))
  if (noSqft.length) return { ok: false, reason: `Square feet per unit is missing or not believable for ${noSqft.map(({ row, i }) => rowLabel(row, i)).join(', ')}.` }
  if (com.some(({ row }) => !believable(row.sqft, 1e9))) return { ok: false, reason: 'A commercial square footage is not believable.' }
  const total = sum(res.map(({ row }) => row.units * row.sqft)) + sum(com.map(({ row }) => row.sqft))
  if (!(total > 0)) return { ok: false, reason: 'No square feet are entered (residential square feet per unit or commercial square feet).' }
  return {
    ok: true,
    value: total,
    paths: [...res.flatMap(({ i }) => [`residentialIncome.rows.${i}.units`, `residentialIncome.rows.${i}.sqft`]), ...com.map(({ i }) => `commercialIncome.rows.${i}.sqft`)],
  }
}

function budgetPart(project, keys) {
  const lines = project.data.budget.lines
  const entered = keys.filter((k) => lines[k]?.amount !== null && lines[k]?.amount !== undefined)
  const bad = entered.find((k) => !believable(lines[k].amount))
  if (bad) return { ok: false, reason: `Budget line "${BUDGET_ROWS.find((r) => r.key === bad).label}" is ${lines[bad].amount}, which is not believable.` }
  const total = sum(entered.map((k) => lines[k].amount))
  if (!(total > 0)) return { ok: false, reason: 'No amounts are entered for these budget lines.' }
  return { ok: true, value: total, paths: entered.map((k) => `budget.lines.${k}.amount`) }
}

const COST_PARTS = [
  { part: 'hard', label: 'Hard cost per square foot', what: 'hard cost lines' },
  { part: 'soft', label: 'Soft cost per square foot', what: 'soft cost lines' },
  { part: 'total', label: 'Total development cost per square foot', what: 'the development budget' },
]

function costRows(project, set, ctx) {
  const area = squareFeet(project)
  const basis =
    ctx.stage === 'lease_up'
      ? 'The development budget (the tool does not track remaining cost separately, so the whole budget is used), over rentable square feet'
      : 'The development budget, over rentable square feet (residential units × square feet per unit, plus commercial)'
  return COST_PARTS.map(({ part, label, what }) => {
    const base = { ...ctx, id: `cost-${part}`, metric: 'cost', part, label, basis, unit: UNITS.sqft, cellPaths: [] }
    const b = costBenchmark(set, part)
    if (!b.ok) return { ...base, value: null, range: null, status: 'not-applicable', note: b.reason }
    let amount
    if (part === 'total') {
      const t = totalDevelopmentCost(project) // the shared calculator
      amount = t.ok ? { ok: true, value: t.value, paths: budgetPart(project, BUDGET_ROWS.map((r) => r.key)).paths ?? [] } : { ok: false, reason: t.reason }
    } else amount = budgetPart(project, part === 'hard' ? HARD_KEYS : SOFT_KEYS)
    if (!amount.ok) return { ...base, value: null, range: null, status: 'missing', note: `${label}: ${amount.reason}`, missingFill: [`Development budget (${what})`] }
    if (!area.ok) return { ...base, value: null, range: null, status: 'missing', note: area.reason, missingFill: ['Residential income (square feet per unit)'] }
    return { ...compared({ ...base, cellPaths: [...amount.paths, ...area.paths] }, amount.value / area.value, b.range), dollars: amount.value, squareFeet: area.value }
  })
}

// Every comparison row for a project against a set. `stage` is the project's stage.
export function compareProject(project, set, stage) {
  const ctx = { stage, setName: set.name, madeUp: set.madeUp }
  const rows = rentRows(project, set, ctx)
  const achieved = achievedRentRow(project, set, ctx)
  if (achieved) rows.push(achieved)
  rows.push(expenseRow(project, set, ctx))
  rows.push(...costRows(project, set, ctx))
  return rows
}
