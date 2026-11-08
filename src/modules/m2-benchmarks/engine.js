// M2: the benchmarking engine (layer 2). "Are these rents, expenses and costs reasonable?"
//
// One engine for every stage. Only the benchmark set changes (M0's loader picks it by stage), and what "the project's
// number" means:
//
//   metric          development                lease_up                               completed
//   rents           projected rents (rent roll)  achieved rents from the T-12, net of     in-place rents (rent roll)
//                                                concessions (projected if no T-12)
//   expenses/unit   underwritten expenses        run-rate: last 3 T-12 months x 12        T-12 expenses, annualized
//                                                (underwritten if no T-12)               (underwritten if no T-12)
//   cost per sq ft  hard, soft, total            remaining cost: not in the workbook      not compared
//
// compareProject(project, context) returns { ok, stage, set, rows } where each row is one line of the table on screen:
//   { id, metric, label, basis, unit, value, range, position, percentFromMedian, status, detail, cells, flags }
// status: 'within' | 'above' | 'below' | 'no_benchmark' | 'not_available' | 'not_applicable'

import {
  projectSchema,
  loadBenchmarks,
  rentBenchmark,
  expenseBenchmark,
  costBenchmark,
  compareToRange,
  normalizeUnitType,
  normalizeAmi,
  createFlagMaker,
  missingDataFlag,
  citeCells,
  fmt,
} from '../shared/index.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const pos = (v) => isNum(v) && v > 0
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const T12_REF = 'T-12 template'

export const UNITS = {
  rent: { short: '/unit/month', format: (n) => fmt.usd(n) },
  expense: { short: '/unit/year', format: (n) => fmt.usd(n) },
  cost: { short: '/sq ft', format: (n) => fmt.usd(n) },
}

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const SOFT_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Soft costs')).map((r) => r.key)
const OPEX_KEYS = projectSchema.find((g) => g.id === 'operatingExpenses').rows.map((r) => r.key)

const monthIdx = (text) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof text === 'string' ? text : '')
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

// T-12 months in date order, one per calendar month (a later row for the same month wins, as in the calculators).
function t12Months(record) {
  const byMonth = new Map()
  for (const row of record.data.t12.rows) {
    const idx = monthIdx(row.month)
    if (idx !== null) byMonth.set(idx, row)
  }
  return [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row)
}

const residentialUnits = (record) => sum(record.data.residentialIncome.rows.map((r) => (pos(r.units) ? r.units : 0)))

// ---------------------------------------------------------------------------------------------
// Severity: which direction is the risk, and how far outside the range is the value?
// ---------------------------------------------------------------------------------------------

// How far past the nearer edge of the range, as a share of that edge (0.1 = 10% past it).
const beyondEdge = (value, range) => (value > range.high ? value / range.high - 1 : value < range.low ? 1 - value / range.low : 0)

// Rents above the market overstate income; expenses below the market understate costs. Those are the risky directions.
// The other direction is worth a mention but rarely a concern. Cost per square foot below the range is a question about
// scope (missing lines, a thin budget), which M3D's budget checks own in detail, so M2 only notes it.
const RISKY = { rent: 'above', expense: 'below', cost: 'above' }

function severityFor(metric, position, past) {
  // A value just past the edge (under 5%) is within the noise of any benchmark: worth a note, not a warning.
  if (position === RISKY[metric]) return past >= 0.2 ? 'high' : past >= 0.05 ? 'medium' : 'low'
  if (metric === 'cost') return 'low'
  return past >= 0.25 ? 'medium' : 'low'
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

function compared({ id, metric, label, basis, value, range, cells, rangeBasis }) {
  const c = compareToRange(value, range)
  const unit = UNITS[metric]
  const where = c.position === 'within' ? 'within' : `${c.position}`
  return {
    id,
    metric,
    label,
    basis,
    unit: unit.short,
    value,
    range,
    rangeBasis,
    position: c.position,
    percentFromMedian: c.percentFromMedian,
    status: c.position,
    past: beyondEdge(value, range),
    detail: `${unit.format(value)}${unit.short} vs. ${unit.format(range.low)} to ${unit.format(range.high)} (median ${unit.format(range.median)})${rangeBasis ? `, ${rangeBasis}` : ''}: ${where} the range.`,
    cells,
  }
}

const unavailable = (id, metric, label, status, detail, cells = []) => ({ id, metric, label, status, detail, cells, unit: UNITS[metric].short })

// Rents row by row (rent roll), against the stage's set. AMI units only against their own AMI level.
function rentRollRows(record, set, basis) {
  const rows = record.data.residentialIncome.rows
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => pos(r.monthlyRent))
    .map(({ r, i }) => {
      const ami = normalizeAmi(r.amiLevel)
      const label = `Rent: ${r.unitType || `row ${i + 1}`}${ami ? ` at ${ami}% AMI` : ami === null ? ' (market)' : ` (AMI "${r.amiLevel}")`}`
      const cells = citeCells(record, [`residentialIncome.rows.${i}.monthlyRent`, `residentialIncome.rows.${i}.unitType`, ...(r.amiLevel !== null && r.amiLevel !== undefined ? [`residentialIncome.rows.${i}.amiLevel`] : [])])
      const b = rentBenchmark(set, r.unitType, r.amiLevel)
      if (!b.ok) return { ...unavailable(`rent-${i}`, 'rent', label, 'no_benchmark', `${fmt.usd(r.monthlyRent)}/unit/month. ${b.reason}`, cells), value: r.monthlyRent }
      return compared({ id: `rent-${i}`, metric: 'rent', label, basis, value: r.monthlyRent, range: b.range, rangeBasis: b.basis === 'market' ? 'market comps' : `${b.basis} comps`, cells })
    })
}

// Lease-up: achieved rent per unit from the latest T-12 months (residential revenue less concessions, per unit), against
// the unit-mix-weighted range of the stage's set.
function achievedRentRow(record, set) {
  const label = 'Rent: achieved, all units'
  const basis = 'Achieved rent from the T-12, net of concessions'
  const months = t12Months(record).filter((m) => isNum(m.residentialRevenue)).slice(-3)
  const units = residentialUnits(record)
  if (!months.length || !units) return null
  const mix = record.data.residentialIncome.rows.filter((r) => pos(r.units))
  const benches = mix.map((r) => ({ units: r.units, b: rentBenchmark(set, r.unitType, r.amiLevel), r }))
  const missing = benches.filter((x) => !x.b.ok)
  const perMonth = months.map((m) => (m.residentialRevenue - Math.abs(isNum(m.concessions) ? m.concessions : 0)) / units)
  const value = sum(perMonth) / perMonth.length
  const cells = [T12_REF, ...citeCells(record, mix.map((_, i) => `residentialIncome.rows.${i}.units`))]
  if (missing.length) {
    return { ...unavailable('rent-achieved', 'rent', label, 'no_benchmark', `${fmt.usd(value)}/unit/month achieved. ${missing[0].b.reason}`, cells), value, basis }
  }
  const weight = (k) => sum(benches.map((x) => x.units * x.b.range[k])) / units
  const range = { low: weight('low'), median: weight('median'), high: weight('high') }
  const types = [...new Set(mix.map((r) => normalizeUnitType(r.unitType)))].join(', ')
  return compared({ id: 'rent-achieved', metric: 'rent', label, basis: `${basis} (last ${plural(months.length, 'month')})`, value, range, rangeBasis: `weighted by the unit mix (${types})`, cells })
}

function rentRows(record, set, stage) {
  if (!record.data.residentialIncome.rows.some((r) => pos(r.monthlyRent))) {
    return [unavailable('rent', 'rent', 'Rents', 'not_available', 'No residential rents entered, so there is nothing to compare.', citeCells(record, ['residentialIncome.rows']))]
  }
  if (stage === 'lease_up') {
    const achieved = achievedRentRow(record, set)
    if (achieved) return [achieved]
    return rentRollRows(record, set, 'Projected rents (no T-12 loaded, so achieved rents are not known yet)')
  }
  return rentRollRows(record, set, stage === 'completed' ? 'In-place rents from the rent roll' : 'Projected rents')
}

// Expenses per residential unit per year.
function expenseRow(record, set, stage) {
  const label = 'Operating expenses per unit'
  const units = residentialUnits(record)
  const range = expenseBenchmark(set).range
  if (!units) return unavailable('expenses', 'expense', label, 'not_available', 'No residential units entered, so expenses per unit cannot be worked out.', citeCells(record, ['residentialIncome.rows']))

  const monthExpense = (m) => {
    const vals = [...OPEX_KEYS.map((k) => m[k]), m.otherExpenses]
    return vals.some(isNum) ? sum(vals) : null
  }
  if (stage !== 'development') {
    const all = t12Months(record).map(monthExpense).filter(isNum)
    const used = stage === 'lease_up' ? all.slice(-3) : all
    if (used.length) {
      const yearly = (sum(used) / used.length) * 12
      return compared({
        id: 'expenses',
        metric: 'expense',
        label,
        basis: stage === 'lease_up' ? `Run-rate from the last ${plural(used.length, 'T-12 month')}, times 12` : `T-12 expenses${used.length < 12 ? ` (${plural(used.length, 'month')}, annualized)` : ''}`,
        value: yearly / units,
        range,
        rangeBasis: `${fmt.usd(yearly)} a year over ${plural(units, 'unit')}`,
        cells: [T12_REF, ...citeCells(record, record.data.residentialIncome.rows.map((_, i) => `residentialIncome.rows.${i}.units`))],
      })
    }
  }
  const lines = OPEX_KEYS.filter((k) => isNum(record.data.operatingExpenses.lines[k]?.amount))
  const other = record.data.otherExpenses.rows.map((r, i) => ({ r, i })).filter(({ r }) => isNum(r.amount))
  if (!lines.length && !other.length) return unavailable('expenses', 'expense', label, 'not_available', 'No operating expenses entered.', citeCells(record, ['operatingExpenses.lines']))
  const yearly = sum(lines.map((k) => record.data.operatingExpenses.lines[k].amount)) + sum(other.map(({ r }) => r.amount))
  const KEY_LINES = { propertyTaxes: 'property taxes', propertyLiabilityInsurance: 'insurance', propertyManagement: 'property management' }
  const blank = Object.entries(KEY_LINES).filter(([k]) => !isNum(record.data.operatingExpenses.lines[k]?.amount)).map(([, t]) => t)
  const row = compared({
    id: 'expenses',
    metric: 'expense',
    label,
    basis: stage === 'development' ? 'Underwritten expenses at stabilization' : 'Underwritten expenses (no T-12 loaded, so actuals are not known)',
    value: yearly / units,
    range,
    rangeBasis: `${fmt.usd(yearly)} a year over ${plural(units, 'unit')}`,
    cells: citeCells(record, [...lines.map((k) => `operatingExpenses.lines.${k}.amount`), ...other.map(({ i }) => `otherExpenses.rows.${i}.amount`)]),
  })
  if (blank.length) row.detail += ` Note: no amount for ${blank.join(', ')}, so the total may be understated.`
  return row
}

// Cost per square foot: hard, soft and total, over residential plus commercial square feet.
function costRows(record, set, stage, budgetTab) {
  const titles = { hard: 'Hard cost per sq ft', soft: 'Soft cost per sq ft', total: 'Total cost per sq ft' }
  if (stage === 'completed' || !set.costPerSqft) return [unavailable('cost', 'cost', 'Cost per sq ft', 'not_applicable', 'Not compared for completed projects: the cost is already spent.')]
  if (stage === 'lease_up') {
    return [unavailable('cost', 'cost', 'Remaining cost per sq ft', 'not_available', 'The workbook does not record how much of the budget is already spent, so the remaining cost cannot be compared. Ask the sponsor for the latest draw report.')]
  }
  const resSqft = sum(record.data.residentialIncome.rows.map((r) => (pos(r.units) && pos(r.sqft) ? r.units * r.sqft : 0)))
  const comSqft = sum(record.data.commercialIncome.rows.map((r) => (pos(r.sqft) ? r.sqft : 0)))
  const sqft = resSqft + comSqft
  const amount = (k) => record.data.budget.lines[k]?.amount
  const hard = sum(HARD_KEYS.map(amount).filter((v) => isNum(v) && v >= 0))
  const soft = sum(SOFT_KEYS.map(amount).filter((v) => isNum(v) && v >= 0))
  const total = sum(BUDGET_ROWS.map((r) => amount(r.key)).filter((v) => isNum(v) && v >= 0))
  if (!sqft) return [unavailable('cost', 'cost', 'Cost per sq ft', 'not_available', 'No square footage entered (residential sq ft per unit or commercial sq ft).', citeCells(record, ['residentialIncome.rows']))]
  if (!total) return [unavailable('cost', 'cost', 'Cost per sq ft', 'not_available', 'No development budget entered.', citeCells(record, ['budget.lines']))]
  const sqftText = `${Math.round(sqft).toLocaleString('en-US')} sq ft${comSqft ? ` (${Math.round(resSqft).toLocaleString('en-US')} residential, ${Math.round(comSqft).toLocaleString('en-US')} commercial)` : ''}`
  const totals = { hard, soft, total }
  const cellsFor = { hard: budgetTab ? [`${budgetTab}!G44`] : [], soft: budgetTab ? [`${budgetTab}!G99`] : [], total: budgetTab ? [`${budgetTab}!G102`] : [] }
  return ['hard', 'soft', 'total'].map((k) => {
    const b = costBenchmark(set, k)
    if (!b.ok) return unavailable(`cost-${k}`, 'cost', titles[k], 'no_benchmark', b.reason)
    if (!totals[k]) return unavailable(`cost-${k}`, 'cost', titles[k], 'not_available', `No ${k} costs entered in the budget.`, cellsFor[k])
    return compared({ id: `cost-${k}`, metric: 'cost', label: titles[k], basis: 'Development budget', value: totals[k] / sqft, range: b.range, rangeBasis: `${fmt.usd(totals[k])} over ${sqftText}`, cells: cellsFor[k] })
  })
}

// ---------------------------------------------------------------------------------------------
// Flags: one per finding, combining the table rows behind it.
// ---------------------------------------------------------------------------------------------

const NOUN = { rent: 'rents', expense: 'operating expenses', cost: 'costs per square foot' }
const QUESTIONS = {
  'rent-above': 'What supports rents above the comparable properties (signed leases, amenities, a recent rent survey)? Please send the evidence.',
  'rent-below': 'Why are rents below comparable properties? Is there room to raise them, or something holding them down?',
  'expense-below': 'Operating expenses look low against comparable properties. Please send the expense budget line by line and explain any savings.',
  'expense-above': 'Why are operating expenses higher than at comparable properties?',
  'cost-above': 'Why does the budget cost more per square foot than comparable projects? Please send the contractor bid or cost estimate.',
  'cost-below': 'The budget costs less per square foot than comparable projects. Is the scope complete? Please send the contractor bid or cost estimate.',
}

function flagsFor(rows, flag, ctx) {
  const flags = []
  for (const metric of ['rent', 'expense', 'cost']) {
    for (const position of ['above', 'below']) {
      const all = rows.filter((r) => r.metric === metric && r.status === position)
      // One flag per metric and direction; it lists every table row behind it.
      const groups = all.length ? [all] : []
      for (const hits of groups) {
      const worst = hits.reduce((a, b) => (b.past > a.past ? b : a))
      const severity = severityFor(metric, position, worst.past)
      const id = `M2-${{ rent: 'rent', expense: 'expenses', cost: 'cost' }[metric]}-${position}-comps`
      flags.push(
        flag({
          id,
          severity,
          title: `The project's ${NOUN[metric]} are ${position} the comparable range${worst.past >= 0.2 ? ' by a wide margin' : ''}.`,
          evidence: hits.map((h) => `${h.label}: ${h.detail}`).join(' ') + ` Benchmark: ${ctx.set.name}.`,
          cell_refs: [...new Set(hits.flatMap((h) => h.cells))].slice(0, 50),
          follow_up: QUESTIONS[`${metric}-${position}`],
        }),
      )
      }
    }
  }
  const noBench = rows.filter((r) => r.status === 'no_benchmark')
  if (noBench.length) {
    flags.push(
      flag({
        id: 'M2-no-comparable-benchmark',
        severity: 'low',
        title: 'Some figures have no comparable benchmark, so they were not compared.',
        evidence: noBench.map((r) => `${r.label}: ${r.detail}`).join(' '),
        cell_refs: [...new Set(noBench.flatMap((r) => r.cells))].slice(0, 50),
        follow_up: 'Please send rent comparables for these unit types and affordability levels.',
      }),
    )
  }
  for (const r of rows.filter((x) => x.status === 'not_available')) {
    flags.push(missingDataFlag({ module: 'M2', stage_used: ctx.stage, check: r.metric === 'expense' ? 'expenses' : r.metric, checkTitle: `${r.label} against the market`, missing: r.detail, cell_refs: r.cells }))
  }
  return flags
}

// ---------------------------------------------------------------------------------------------

export function compareProject(project, context = {}) {
  const maker = createFlagMaker('M2', project)
  const stage = maker.stage
  const loaded = loadBenchmarks(stage, context.benchmarkSets)
  if (!loaded.ok) {
    return { ok: false, stage, reason: loaded.reason, rows: [], flags: [missingDataFlag({ module: 'M2', stage_used: stage, check: 'benchmarks', checkTitle: 'Benchmarking', missing: loaded.reason })] }
  }
  const set = loaded.set
  const details = project.meta?.sourceTab
  const budgetTab = details && /^Development /.test(details) ? details.replace(/ Details$/, ' Budget') : null
  const rows = [...rentRows(project, set, stage), expenseRow(project, set, stage), ...costRows(project, set, stage, budgetTab)]
  return { ok: true, stage, set, rows, flags: flagsFor(rows, maker.flag, { set, stage }) }
}
