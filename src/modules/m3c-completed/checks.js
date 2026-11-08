// M3C: Completed risk (layer 3). "Is this operating property performing as promised, and what happens when its loan comes due?"
//
// Eight checks in four groups (actuals vs. underwriting, expense normalization, vacancy, debt maturity). Each reads the project
// record and the shared calculators and settings from M0. Nothing here changes a record or works out the stage.
//
// Each check returns one checklist row:
//   { id, title, group, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, cells, flags }
//
// A completed project runs every check. A lease-up project runs only what is already actual: the rents in place, the expenses
// to date, the expense lines, and the loan maturity. It skips the comparison of income with underwriting and the vacancy test,
// because a project still filling is expected to fall short of both; M3T reviews its pace instead.
//
// Rules of thumb that are NOT in the shared sets are in THRESHOLDS. They are working assumptions for a first screen, not
// market data, and every flag that uses one says so.

import {
  projectSchema,
  keyRatios,
  ratioIdsForStage,
  noi,
  annualDebtService,
  totalSources,
  missingDataFlag,
  flagFromUnavailable,
  citeCells,
  createFlagMaker,
  fmt,
  DEBT_SOURCE_TYPES,
} from '../shared/index.js'

export const MODULE_ID = 'M3C'

export const THRESHOLDS = {
  noiVsUnderwritten: { medium: 0.95, high: 0.8 }, // T-12 NOI as a share of underwritten NOI
  rentVsUnderwritten: { medium: 0.9, high: 0.75 },
  expenseOverUnderwritten: { medium: 1.1, high: 1.25 }, // T-12 expenses as a multiple of underwritten
  vacancyOverUnderwritten: { medium: 0.03, high: 0.08 }, // percentage points
  reservesPerUnitYear: 250,
  reassessedTaxRate: 0.012, // property tax as a share of what the property cost, if it were reassessed
  reassessmentTrigger: 0.7, // flagged when taxes are under this share of the reassessed amount
  maturityMonths: { high: 12, medium: 24 },
  keyExpenseLines: ['propertyManagement', 'propertyLiabilityInsurance', 'propertyTaxes', 'replacementReserves'],
  expectedExpenseLines: ['propertyManagement', 'propertyLiabilityInsurance', 'propertyTaxes', 'replacementReserves', 'electricHeatCommon', 'waterSewer', 'garbage', 'contractRepairs', 'groundsMaintenance'],
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const amount = (v) => (isNum(v) && v >= 0 ? v : 0)
const usd = (n) => fmt.usd(n)
const share = (n) => `${Number((n * 100).toFixed(1))}%`
const points = (n) => `${Number((n * 100).toFixed(1))} points`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const sum = (list) => list.reduce((t, v) => t + v, 0)

const OPEX_ROWS = projectSchema.find((g) => g.id === 'operatingExpenses').rows
const OPEX_KEYS = OPEX_ROWS.map((r) => r.key)
const OPEX_LABEL = Object.fromEntries(OPEX_ROWS.map((r) => [r.key, r.label.toLowerCase()]))

// ---------------------------------------------------------------------------------------------
// Dates and months. A bare year counts as January and is treated as approximate.
// ---------------------------------------------------------------------------------------------

export function parseMonth(value) {
  if (isNum(value) && Number.isInteger(value) && value >= 1900 && value <= 2200) return { idx: value * 12, yearOnly: true, text: String(value) }
  if (typeof value !== 'string') return null
  const t = value.trim()
  let m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(t)
  if (m) return { idx: Number(m[1]) * 12 + Number(m[2]) - 1, yearOnly: false, text: t.slice(0, 7) }
  m = /^(\d{4})$/.exec(t)
  if (m) return { idx: Number(m[1]) * 12, yearOnly: true, text: t }
  return null
}

// ---------------------------------------------------------------------------------------------
// Rows and flags
// ---------------------------------------------------------------------------------------------

const row = (id, title, group, status, detail, { cells = [], flags = [] } = {}) => ({ id, title, group, status, detail, cells, flags })

function notChecked(ctx, id, title, group, missing, cells = []) {
  const flag = missingDataFlag({ module: MODULE_ID, stage_used: 'completed', check: id, checkTitle: title, missing, cell_refs: cells })
  return row(id, title, group, 'not_checked', Array.isArray(missing) ? missing.join(' ') : missing, { cells, flags: [flag] })
}

function unavailable(ctx, id, title, group, result, cells = []) {
  const flag = flagFromUnavailable(result, { module: MODULE_ID, stage_used: 'completed', check: id, checkTitle: title })
  return row(id, title, group, 'not_checked', result.reason, { cells, flags: [flag] })
}

const notApplicable = (id, title, group, why) => row(id, title, group, 'not_applicable', why)

// The T-12 is what makes most of these checks possible. When it is missing, the first check that needs it carries ONE flag,
// and the others say the same thing without repeating it.
function needsT12(ctx, id, title, group, cells = []) {
  const detail = 'No T-12 is loaded, so there are no actual results to check.'
  if (ctx.reportedNoT12) return row(id, title, group, 'not_checked', detail, { cells })
  ctx.reportedNoT12 = true
  const flag = ctx.flag({
    id: 'M3C-missing-data',
    severity: 'low',
    title: 'The actuals checks could not run because no T-12 is loaded.',
    evidence: 'Missing: the trailing 12 months (T-12) of rent, expenses and occupancy. Checks that compare actual results with underwriting were skipped.',
    cell_refs: cells,
    follow_up: 'Please provide the trailing 12 months (monthly rent, expenses and occupancy) for this property.',
  })
  return row(id, title, group, 'not_checked', detail, { cells, flags: [flag] })
}

// Every M3C flag ran under the completed rules, even for a lease-up project's already-actual parts.
const raise = (ctx, fields) => ctx.flag({ ...fields, stage_used: 'completed' })

// ---------------------------------------------------------------------------------------------
// The T-12 and the underwriting, as plain numbers
// ---------------------------------------------------------------------------------------------

// The T-12 months in date order, one per calendar month (a later row for the same month replaces an earlier one).
function t12Months(record) {
  const byMonth = new Map()
  for (const r of record.data.t12.rows) {
    const m = parseMonth(r.month)
    if (m && !m.yearOnly) byMonth.set(m.idx, { ...r, idx: m.idx })
  }
  return [...byMonth.values()].sort((a, b) => a.idx - b.idx)
}

const t12Cells = (record, key, n = 3) => citeCells(record, record.data.t12.rows.slice(0, n).map((_, i) => `t12.rows.${i}.${key}`))
const monthlyExpenses = (r) => sum([...OPEX_KEYS, 'otherExpenses'].map((k) => amount(r[k])))

const totalUnits = (record) => record.data.residentialIncome.rows.reduce((t, r) => t + amount(r.units), 0)

// Underwritten rent per unit per month, weighted by units.
function underwrittenRent(record) {
  const rows = record.data.residentialIncome.rows.filter((r) => isNum(r.units) && r.units > 0 && isNum(r.monthlyRent))
  const units = sum(rows.map((r) => r.units))
  return units > 0 ? sum(rows.map((r) => r.units * r.monthlyRent)) / units : null
}

// Expense lines per year. From the T-12 when there is one (averaged over its months), otherwise as underwritten.
function expenseView(record, months) {
  const lines = {}
  if (months.length) {
    for (const k of OPEX_KEYS) lines[k] = (sum(months.map((m) => amount(m[k]))) / months.length) * 12
    return { source: `the T-12 (${plural(months.length, 'month')})`, lines, annualOther: (sum(months.map((m) => amount(m.otherExpenses))) / months.length) * 12 }
  }
  for (const k of OPEX_KEYS) lines[k] = amount(record.data.operatingExpenses.lines[k]?.amount)
  return { source: 'the underwriting', lines, annualOther: sum(record.data.otherExpenses.rows.map((r) => amount(r.amount))) }
}

// =============================================================================================
// 1. ACTUALS VS. UNDERWRITING
// =============================================================================================

function actuals(ctx) {
  const { record } = ctx
  const [id, title, group] = ['actuals', 'Actual income is at least what was underwritten', 'Actuals vs. underwriting']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'A project still filling is expected to earn less than at stabilization. M3T reviews its pace instead.')
  if (ctx.months.length === 0) return needsT12(ctx, id, title, group, t12Cells(record, 'residentialRevenue'))
  const r = ctx.ratios.trailing
  const cells = t12Cells(record, 'noiReported')
  if (!r.ok) return unavailable(ctx, id, title, group, r, cells)
  const t = THRESHOLDS.noiVsUnderwritten
  const detail = `${(r.detail ?? [])[0] ?? ''} That is ${share(r.value)} of underwritten.`.trim()
  if (r.value >= t.medium) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3C-actuals-vs-underwriting',
    severity: r.value < t.high ? 'high' : 'medium',
    title: `The property is earning ${share(r.value)} of what was underwritten.`,
    evidence: `${(r.detail ?? [])[0] ?? ''} ${share(r.value)} of underwritten NOI, vs. a ${share(t.medium)} working floor (an assumption, not market data).`.trim(),
    cell_refs: cells,
    follow_up: 'What explains the gap between actual and underwritten income, and what changes will close it?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

function stability(ctx) {
  const { record, settings } = ctx
  const [id, title, group] = ['stability', 'Income has held up for several months in a row', 'Actuals vs. underwriting']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'A project still filling has not had time to show a steady run. M3T estimates when it will.')
  if (ctx.months.length === 0) return needsT12(ctx, id, title, group, t12Cells(record, 'residentialRevenue'))
  const r = ctx.ratios.trailing
  if (!r.ok) return unavailable(ctx, id, title, group, r)
  const needed = settings.consecutiveMonths
  const line = (r.detail ?? []).find((d) => d.startsWith('Stability streak')) ?? `Stability streak: ${r.streak ?? 0} months.`
  if ((r.streak ?? 0) >= needed) return row(id, title, group, 'pass', line)
  const enough = ctx.months.length >= needed
  const f = raise(ctx, {
    id: 'M3C-stability-streak-short',
    severity: enough ? 'medium' : 'low',
    title: enough ? 'Recent months have not met the lender\'s tests for a steady run.' : 'There are too few months of results to show the property is stable.',
    evidence: `${line}${enough ? '' : ` Only ${plural(ctx.months.length, 'month')} of T-12 data.`}`,
    cell_refs: t12Cells(record, 'noiReported'),
    follow_up: enough ? 'What happened in the months that missed the tests, and is it fixed?' : 'Please provide the full trailing 12 months.',
  })
  return row(id, title, group, 'fail', line, { flags: [f] })
}

function rents(ctx) {
  const { record } = ctx
  const [id, title, group] = ['rents', 'Rents in place match the rents underwritten', 'Actuals vs. underwriting']
  const cells = t12Cells(record, 'residentialRevenue')
  if (ctx.months.length === 0) return needsT12(ctx, id, title, group, cells)
  const units = totalUnits(record)
  const planned = underwrittenRent(record)
  if (units <= 0 || planned === null) return notChecked(ctx, id, title, group, ['the units and monthly rent for each unit type'], citeCells(record, ['residentialIncome.rows.0.units', 'residentialIncome.rows.0.monthlyRent']))
  const recent = ctx.months.slice(-3).filter((m) => isNum(m.residentialRevenue))
  if (recent.length === 0) return notChecked(ctx, id, title, group, ['residential revenue in the T-12'], cells)
  const actual = sum(recent.map((m) => m.residentialRevenue)) / recent.length / units
  const ratio = actual / planned
  const t = THRESHOLDS.rentVsUnderwritten
  const detail = `Rent in place is about ${usd(actual)} per unit a month (last ${plural(recent.length, 'month')}) vs. ${usd(planned)} underwritten: ${share(ratio)}.`
  if (ratio >= t.medium) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3C-rents-below-underwriting',
    severity: ratio < t.high ? 'high' : 'medium',
    title: `Rents in place are ${share(1 - ratio)} below the rents that were underwritten.`,
    evidence: `${detail} A working floor of ${share(t.medium)} (an assumption, not market data). Measured as residential revenue before vacancy and free rent.`,
    cell_refs: [...cells, ...citeCells(record, ['residentialIncome.rows.0.monthlyRent'])],
    follow_up: 'Why are rents below the underwriting, and has the underwriting been updated to what is actually achieved?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

// =============================================================================================
// 2. EXPENSE NORMALIZATION
// =============================================================================================

function expensesVsUnderwriting(ctx) {
  const { record } = ctx
  const [id, title, group] = ['expenses', 'Actual expenses are in line with the underwriting', 'Expense normalization']
  if (ctx.months.length === 0) return needsT12(ctx, id, title, group, t12Cells(record, 'propertyTaxes'))
  const planned = noi(record)
  if (!planned.ok) return unavailable(ctx, id, title, group, planned)
  if (planned.expenses <= 0) return notChecked(ctx, id, title, group, ['operating expenses in the underwriting'], citeCells(record, ['operatingExpenses.lines.propertyTaxes.amount']))
  const withExpenses = ctx.months.filter((m) => monthlyExpenses(m) > 0)
  if (withExpenses.length === 0) return notChecked(ctx, id, title, group, ['expenses in the T-12'], t12Cells(record, 'propertyTaxes'))
  const actual = (sum(withExpenses.map(monthlyExpenses)) / withExpenses.length) * 12
  const ratio = actual / planned.expenses
  const t = THRESHOLDS.expenseOverUnderwritten
  const detail = `Expenses run about ${usd(actual)} a year (from ${plural(withExpenses.length, 'month')}) vs. ${usd(planned.expenses)} underwritten: ${share(ratio)}.`
  const cells = t12Cells(record, 'propertyTaxes')
  if (ratio <= t.medium) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3C-expenses-over-underwriting',
    severity: ratio > t.high ? 'high' : 'medium',
    title: `Actual expenses are running ${share(ratio - 1)} above what was underwritten.`,
    evidence: `${detail} A working limit of ${share(t.medium)} (an assumption, not market data).`,
    cell_refs: cells,
    follow_up: 'Which expense lines are over, and is the underwriting being corrected?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

function expenseLines(ctx) {
  const { record } = ctx
  const [id, title, group] = ['expense-lines', 'No normal operating expense is missing', 'Expense normalization']
  const view = expenseView(record, ctx.months)
  const missing = THRESHOLDS.expectedExpenseLines.filter((k) => !(view.lines[k] > 0))
  const cells = citeCells(record, missing.map((k) => `operatingExpenses.lines.${k}.amount`))
  if (missing.length === 0) return row(id, title, group, 'pass', `Every expected expense line is entered (from ${view.source}).`)
  const critical = missing.filter((k) => THRESHOLDS.keyExpenseLines.includes(k))
  const names = missing.map((k) => OPEX_LABEL[k])
  const detail = `From ${view.source}, nothing entered for: ${names.join(', ')}.`
  const f = raise(ctx, {
    id: 'M3C-expense-lines-missing',
    severity: critical.length >= 3 ? 'medium' : 'low',
    title: 'Some normal operating expenses are missing, so costs may be understated.',
    evidence: `${detail} ${critical.length ? `Of the key lines (management, insurance, taxes, reserves), missing: ${critical.map((k) => OPEX_LABEL[k]).join(', ')}.` : 'None of the key lines is missing.'}`,
    cell_refs: cells,
    follow_up: 'Are these costs really zero, or are they paid elsewhere or left out? Please give a full expense statement.',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

function reserves(ctx) {
  const { record } = ctx
  const [id, title, group] = ['reserves', 'Replacement reserves are set aside at a normal level', 'Expense normalization']
  const units = totalUnits(record)
  const cells = citeCells(record, ['operatingExpenses.lines.replacementReserves.amount'])
  if (units <= 0) return notChecked(ctx, id, title, group, ['the number of units'], citeCells(record, ['residentialIncome.rows.0.units']))
  const view = expenseView(record, ctx.months)
  const perUnit = view.lines.replacementReserves / units
  const floor = THRESHOLDS.reservesPerUnitYear
  const detail = `Replacement reserves are ${usd(perUnit)} per unit a year (from ${view.source}); a working minimum is ${usd(floor)}.`
  if (perUnit >= floor) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3C-reserves-low',
    severity: 'medium',
    title: perUnit > 0 ? 'Replacement reserves are below a normal level, so income may be overstated.' : 'No replacement reserve is set aside, so income may be overstated.',
    evidence: `${detail} (An assumption, not market data.) A lender would normally require reserves, which lowers NOI.`,
    cell_refs: cells,
    follow_up: 'What replacement reserve does the lender require, and is it in the expenses?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

function taxReassessment(ctx) {
  const { record, settings } = ctx
  const [id, title, group] = ['tax-reassessment', 'Property taxes would hold up if reassessed', 'Expense normalization']
  const view = expenseView(record, ctx.months)
  const taxes = view.lines.propertyTaxes
  const cells = citeCells(record, ['operatingExpenses.lines.propertyTaxes.amount'])
  const basis = totalSources(record)
  if (!basis.ok) return unavailable(ctx, id, title, group, basis, cells)
  if (!(taxes > 0)) return notChecked(ctx, id, title, group, ['property taxes'], cells)
  const rate = taxes / basis.value
  const reassessed = THRESHOLDS.reassessedTaxRate * basis.value
  const detail = `Taxes of ${usd(taxes)} are ${share(rate)} of the ${usd(basis.value)} the property cost (from ${view.source}); reassessed at about ${share(THRESHOLDS.reassessedTaxRate)} they would be ${usd(reassessed)}.`
  if (taxes >= THRESHOLDS.reassessmentTrigger * reassessed) return row(id, title, group, 'pass', detail, { cells })
  const n = noi(record)
  const ds = annualDebtService(record)
  let effect = ''
  if (n.ok && ds.ok && ds.value > 0) {
    const newNoi = n.value - (reassessed - taxes)
    effect = ` Underwritten NOI would fall from ${usd(n.value)} to ${usd(newNoi)}, taking DSCR from ${fmt.times(n.value / ds.value)} to ${fmt.times(newNoi / ds.value)} (minimum ${fmt.times(settings.minDscr)}).`
  }
  const f = raise(ctx, {
    id: 'M3C-tax-reassessment-risk',
    severity: 'medium',
    title: 'Property taxes look low and could rise sharply if the property is reassessed.',
    evidence: `${detail}${effect} The reassessed rate is an assumption, not market data.`,
    cell_refs: cells,
    follow_up: 'When was the property last assessed, and what would taxes be after a sale or refinance reassessment?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

// =============================================================================================
// 3. VACANCY
// =============================================================================================

function vacancy(ctx) {
  const { record } = ctx
  const [id, title, group] = ['vacancy', 'The vacancy assumed is supported by the actual history', 'Vacancy']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'A project still filling has high vacancy by design. M3T reviews its pace and occupancy trend.')
  if (ctx.months.length === 0) return needsT12(ctx, id, title, group, t12Cells(record, 'occupancy'))
  const assumed = record.data.residentialIncome.stabilizedVacancy
  const cells = [...citeCells(record, ['residentialIncome.stabilizedVacancy']), ...t12Cells(record, 'occupancy', 2)]
  if (!isNum(assumed) || assumed < 0 || assumed > 1) return notChecked(ctx, id, title, group, ['the stabilized residential vacancy assumption'], citeCells(record, ['residentialIncome.stabilizedVacancy']))
  const vacancyOf = (m) => {
    if (isNum(m.occupancy) && m.occupancy >= 0 && m.occupancy <= 1) return 1 - m.occupancy
    const potential = amount(m.residentialRevenue)
    return potential > 0 && isNum(m.vacancyLoss) ? Math.min(1, Math.abs(m.vacancyLoss) / potential) : null
  }
  const known = ctx.months.map((m) => ({ m, v: vacancyOf(m) })).filter((x) => x.v !== null)
  if (known.length === 0) return notChecked(ctx, id, title, group, ['occupancy or vacancy loss in the T-12'], cells)
  const actual = sum(known.map((x) => x.v)) / known.length
  const latest = known.slice(-3)
  const recent = sum(latest.map((x) => x.v)) / latest.length
  const gap = Math.max(actual, recent) - assumed
  const t = THRESHOLDS.vacancyOverUnderwritten
  const detail = `Vacancy assumed ${share(assumed)}; actual averages ${share(actual)} over ${plural(known.length, 'month')} and ${share(recent)} in the latest ${plural(latest.length, 'month')}.`
  if (gap <= t.medium) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3C-vacancy-above-assumption',
    severity: gap > t.high ? 'high' : 'medium',
    title: `Actual vacancy is ${points(gap)} above the vacancy that was assumed.`,
    evidence: `${detail} A working tolerance of ${points(t.medium)} (an assumption, not market data).`,
    cell_refs: cells,
    follow_up: 'Why is vacancy above the assumption, and what is the plan to fill the empty units?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

// =============================================================================================
// 4. DEBT MATURITY
// =============================================================================================

function debtMaturity(ctx) {
  const { record } = ctx
  const [id, title, group] = ['maturity', 'No loan comes due soon without a plan', 'Debt maturity or reset']
  const loans = record.data.sources.rows
    .map((r, i) => ({ r, i, name: r.name || `source ${i + 1}` }))
    .filter(({ r }) => DEBT_SOURCE_TYPES.includes(r.type) && isNum(r.amount) && r.amount > 0)
  if (loans.length === 0) return notChecked(ctx, id, title, group, ['a loan in the sources of money'], citeCells(record, ['sources.rows.0.type']))
  const start = parseMonth(record.data.timeline.constructionCompletion)
  const startCells = citeCells(record, ['timeline.constructionCompletion'])
  const asOf = parseMonth(record.data.stage.asOfDate)
  if (!start || !asOf) return notChecked(ctx, id, title, group, ['the construction completion date and the "as of" date, to date the loan'], startCells)

  const dated = loans
    .filter(({ r }) => isNum(r.termMonths) && r.termMonths > 0)
    .map((l) => ({ ...l, left: start.idx + l.r.termMonths - asOf.idx }))
    .sort((a, b) => a.left - b.left)
  if (dated.length === 0) return notChecked(ctx, id, title, group, ['the term of each loan'], citeCells(record, loans.map(({ i }) => `sources.rows.${i}.termMonths`)))

  const terms = (l) => `"${l.name}" ${l.r.interestRate !== null && l.r.interestRate !== undefined ? `at ${share(l.r.interestRate)}` : 'rate not given'} over ${plural(l.r.termMonths, 'month')}`
  const first = dated[0]
  const cells = citeCells(record, [`sources.rows.${first.i}.termMonths`, `sources.rows.${first.i}.interestRate`, 'timeline.constructionCompletion'])
  const when = first.left <= 0 ? `reached its maturity ${plural(-first.left, 'month')} ago` : `matures in about ${plural(first.left, 'month')}`
  const detail = `The first loan to come due is ${terms(first)}; it ${when}. The loan is assumed to start at construction completion (${start.text}), which is an estimate.`
  const t = THRESHOLDS.maturityMonths
  if (first.left > t.medium) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3C-loan-maturity-near',
    severity: first.left <= t.high ? 'high' : 'medium',
    title: first.left <= 0 ? 'A loan appears to have reached its maturity.' : `A loan comes due in about ${plural(first.left, 'month')}.`,
    evidence: `${detail} Loans due within ${t.high} months are high, within ${t.medium} medium (working limits, not market data).`,
    cell_refs: cells,
    follow_up: 'What is the plan to repay or refinance this loan, and what terms is the lender offering?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

// =============================================================================================
// The list, in the order they appear on screen
// =============================================================================================

export const CHECKS = [actuals, stability, rents, expensesVsUnderwriting, expenseLines, reserves, taxReassessment, vacancy, debtMaturity]

export function prepare(project, context = {}, settings) {
  const maker = createFlagMaker(MODULE_ID, project)
  const used = maker.stage
  // Matched by position, not by the id on the result: some of M0's ratios return a result with no id when an input is refused.
  const results = keyRatios(project, settings)
  const ratios = Object.fromEntries(ratioIdsForStage(used).map((id, i) => [id, results[i]]))
  return {
    record: project,
    used,
    stage: used,
    flag: maker.flag,
    settings,
    firm: context.firm ?? null,
    ratios,
    months: t12Months(project),
    reportedNoT12: false,
  }
}
