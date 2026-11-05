// The shared calculators and key ratios from section 1g of the module spec. Built by M0.
//
// Every module uses these and never recomputes them. They read only what is stored in a project record, never today's
// date, and never change the record.
//
// Rules every calculator follows:
//  - A missing input is never guessed as zero. The result is "not available" with the reason and the groups to fill in.
//  - An input that is not believable (a rate of 650%, a vacancy of 800%, a negative loan, a number that overflows) is
//    refused the same way, with a reason that names the value. A wrong number shown with confidence is worse than none.
//  - A result is never NaN or Infinity: a division by zero gives "not available".
//
// A result is either { ok: true, value, notes? } or { ok: false, reason, needs: [{ group, label }] }.

import { DEBT_SOURCE_TYPES } from './enums.js'
import { DEFAULT_SETTINGS } from './settings.js'
import { projectSchema } from './schema.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const sum = (list) => list.reduce((total, v) => total + (isNum(v) ? v : 0), 0)
const ok = (value, extra = {}) => ({ ok: true, value, ...extra })
const na = (reason, needs = []) => ({ ok: false, reason, needs })

const GROUPS = Object.fromEntries(projectSchema.map((g) => [g.id, { group: g.id, label: g.title }]))
const need = (...ids) => ids.map((id) => GROUPS[id])

const firstFailure = (...results) => results.find((r) => !r.ok) ?? null
const passFailure = (failure) => na(failure.reason, failure.needs)

// ---------------------------------------------------------------------------------------------
// Believable inputs
// ---------------------------------------------------------------------------------------------

const LIMITS = {
  money: [0, 1e12],
  signed: [-1e12, 1e12],
  rate: [0, 1],
  share: [0, 1],
  count: [0, 1e7],
  term: [0, 1200], // 0 months means "no payment", which is how a grant is usually entered
}

class Reject extends Error {
  constructor(reason, ...groups) {
    super(reason)
    this.groups = groups
  }
}

const describe = (kind, v) => {
  if (kind === 'rate' || kind === 'share') return `${v} (${Number((v * 100).toPrecision(6))}%)`
  return String(v)
}

// Read one number from the record. Blank (or not a number at all) means "missing" and gives null. A number that is not
// believable stops the calculation with a reason. `group` names the form to fix.
function reading(value, kind, label, group) {
  if (typeof value !== 'number') return null
  const [lo, hi] = LIMITS[kind]
  const believable = Number.isFinite(value) && value >= lo && value <= hi && (kind !== 'term' || Number.isInteger(value))
  if (believable) return value
  if (kind === 'term') throw new Reject(`${label} is ${describe(kind, value)} months, which is not a believable loan term (a whole number from 1 to ${hi}).`, group)
  const hint = kind === 'rate' || kind === 'share' ? ' Percentages are typed like 6.5%, not 650%.' : ''
  throw new Reject(`${label} is ${describe(kind, value)}, which is outside the believable range (${lo} to ${hi}).${hint}`, group)
}

// A calculator that turns a refused input into a "not available" result.
const safe = (fn) => (...args) => {
  try {
    return fn(...args)
  } catch (e) {
    if (e instanceof Reject) return na(e.message, need(...e.groups))
    throw e
  }
}

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const SOFT_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Soft costs')).map((r) => r.key)
const HARD_CONTINGENCY = ['constructionContingency', 'ownersContingency']
const SOFT_CONTINGENCY = ['softCostContingency']
const BUDGET_LABELS = Object.fromEntries(BUDGET_ROWS.map((r) => [r.key, r.label]))

const budgetAmount = (record, key) => reading(record.data.budget.lines[key]?.amount ?? null, 'money', `Budget line "${BUDGET_LABELS[key]}"`, 'budget')
const budgetSum = (record, keys) => sum(keys.map((k) => budgetAmount(record, k)))
const budgetEntered = (record) => BUDGET_ROWS.some((r) => isNum(budgetAmount(record, r.key)))

// ---- Formatting used in the details the ratios return
export const fmt = {
  usd: (n) => {
    const r = Math.round(n)
    return `${r < 0 ? '-' : ''}$${Math.abs(r).toLocaleString('en-US')}`
  },
  pct: (n, digits = 1) => `${(n * 100).toFixed(digits)}%`,
  times: (n) => `${n.toFixed(2)}×`,
}

const sourceName = (row, i) => row.name || `source ${i + 1}`

// =============================================================================================
// BASE CALCULATORS
// =============================================================================================

export const totalSources = safe((record) => {
  const rows = record.data.sources.rows
  const amounts = rows.map((r, i) => reading(r.amount, 'money', `Amount of "${sourceName(r, i)}"`, 'sources')).filter(isNum)
  if (amounts.length === 0) return na('No sources of money entered.', need('sources'))
  return ok(sum(amounts))
})

// Total uses and total development cost are the same number: every acquisition, hard cost and soft cost line.
export const totalUses = safe((record) => {
  if (!budgetEntered(record)) return na('No development budget entered.', need('budget'))
  const total = sum(BUDGET_ROWS.map((r) => budgetAmount(record, r.key)))
  if (total <= 0) return na('The development budget adds up to zero.', need('budget'))
  return ok(total)
})
export const totalDevelopmentCost = totalUses

// Monthly payment on a loan: the standard formula, with a zero rate meaning amount / term. Returns null for anything
// that is not a believable loan. Uses log1p and expm1 so a very small rate does not lose all its precision.
export function monthlyPayment(amount, annualRate, termMonths) {
  const nums = [amount, annualRate, termMonths]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if (amount < 0 || annualRate < 0 || annualRate > 1 || !Number.isInteger(termMonths) || termMonths < 1 || termMonths > 1200) return null
  if (annualRate === 0) return amount / termMonths
  const r = annualRate / 12
  return (amount * r) / -Math.expm1(-termMonths * Math.log1p(r)) // amount * r / (1 - (1 + r)^-term)
}

// Yearly debt service: the sum of each source's payments over a year. A typed payment is a YEARLY amount that replaces
// the calculated one (this is how the applicant workbook treats it). Otherwise it is 12 times the standard monthly
// payment. Debt sources need a term and a rate (or a typed payment). Other sources with a term and a rate count too, as
// in the applicant workbook, and are announced; without them they have no payment.
export const annualDebtService = safe((record) => {
  const rows = record.data.sources.rows
  const read = rows.map((row, i) => {
    const name = sourceName(row, i)
    return {
      row,
      name,
      amount: reading(row.amount, 'money', `Amount of "${name}"`, 'sources'),
      override: reading(row.paymentOverride, 'money', `Typed payment of "${name}"`, 'sources'),
      term: reading(row.termMonths, 'term', `Term of "${name}"`, 'sources'),
      rate: reading(row.interestRate, 'rate', `Interest rate of "${name}"`, 'sources'),
    }
  })
  if (!read.some((r) => isNum(r.amount))) return na('No sources of money entered.', need('sources'))

  const problems = []
  const nonDebt = []
  const typed = []
  let total = 0
  let payments = 0
  for (const { row, name, amount, override, term, rate } of read) {
    if (!isNum(amount) || amount <= 0) continue
    if (isNum(override) && override > 0) {
      total += override
      payments++
      typed.push(name)
      continue
    }
    const isDebt = DEBT_SOURCE_TYPES.includes(row.type)
    if (!isNum(term) || term === 0) {
      if (isDebt) problems.push(`The loan "${name}" has no term.`)
      continue
    }
    if (!isNum(rate)) {
      if (isDebt) problems.push(`The loan "${name}" has no interest rate.`)
      continue
    }
    total += monthlyPayment(amount, rate, term) * 12
    payments++
    if (!isDebt) nonDebt.push(name)
  }
  if (problems.length) return na(problems.join(' '), need('sources'))
  const notes = []
  if (typed.length) notes.push(`Uses a typed yearly payment for ${typed.map((n) => `"${n}"`).join(', ')} instead of calculating it.`)
  if (nonDebt.length) {
    notes.push(`Includes payments on ${nonDebt.map((n) => `"${n}"`).join(', ')}, which ${nonDebt.length === 1 ? 'is' : 'are'} not typed as debt (the applicant's workbook counts these too).`)
  }
  return ok(total, { payments, notes })
})

export const totalDebt = safe((record) => {
  const rows = record.data.sources.rows
  const amounts = rows.map((r, i) => (DEBT_SOURCE_TYPES.includes(r.type) ? reading(r.amount, 'money', `Amount of "${sourceName(r, i)}"`, 'sources') : null))
  const total = sum(amounts)
  if (total <= 0) return na('No debt entered (hard, government or mezzanine debt).', need('sources'))
  return ok(total)
})

// Net operating income at stabilization: income after vacancy, minus operating expenses (replacement reserves included).
// Also returns the pieces other ratios need.
export const noi = safe((record) => {
  const { residentialIncome: res, commercialIncome: com, otherIncome: oth, operatingExpenses: opx, otherExpenses: oex } = record.data
  const resRows = res.rows
    .map((r, i) => ({ units: reading(r.units, 'count', `Units in residential row ${i + 1}`, 'residentialIncome'), rent: reading(r.monthlyRent, 'money', `Monthly rent in residential row ${i + 1}`, 'residentialIncome') }))
    .filter((r) => isNum(r.units) && isNum(r.rent))
  const comRows = com.rows
    .map((r, i) => ({ sqft: reading(r.sqft, 'count', `Square feet in commercial row ${i + 1}`, 'commercialIncome'), rent: reading(r.rentPerSqft, 'money', `Rent per square foot in commercial row ${i + 1}`, 'commercialIncome') }))
    .filter((r) => isNum(r.sqft) && isNum(r.rent))
  const othRows = oth.rows.map((r, i) => reading(r.monthlyIncome, 'money', `Monthly income in other-income row ${i + 1}`, 'otherIncome')).filter(isNum)
  const resVacancy = reading(res.stabilizedVacancy, 'share', 'Residential vacancy', 'residentialIncome')
  const comVacancy = reading(com.stabilizedVacancy, 'share', 'Commercial vacancy', 'commercialIncome')
  const expenseValues = [
    ...Object.entries(opx.lines).map(([key, l]) => reading(l.amount, 'money', `Expense "${key}"`, 'operatingExpenses')),
    ...oex.rows.map((r, i) => reading(r.amount, 'money', `Other expense ${i + 1}`, 'otherExpenses')),
  ]

  if (resRows.length + comRows.length + othRows.length === 0) return na('No income entered.', need('residentialIncome', 'commercialIncome', 'otherIncome'))
  const resGross = sum(resRows.map((r) => r.units * r.rent * 12))
  const comGross = sum(comRows.map((r) => r.sqft * r.rent))
  const othGross = sum(othRows.map((x) => x * 12))
  if (resGross > 0 && resVacancy === null) return na('Residential vacancy is not entered.', need('residentialIncome'))
  if (comGross > 0 && comVacancy === null) return na('Commercial vacancy is not entered.', need('commercialIncome'))
  if (!expenseValues.some(isNum)) return na('No operating expenses entered.', need('operatingExpenses'))

  const resNet = resGross * (1 - (resVacancy ?? 0))
  const comNet = comGross * (1 - (comVacancy ?? 0))
  const expenses = sum(expenseValues)
  const notes = []
  const incompleteRes = res.rows.length - resRows.length
  const incompleteCom = com.rows.length - comRows.length
  if (incompleteRes > 0) notes.push(`${incompleteRes} residential row${incompleteRes === 1 ? ' is' : 's are'} missing units or rent and not counted.`)
  if (incompleteCom > 0) notes.push(`${incompleteCom} commercial row${incompleteCom === 1 ? ' is' : 's are'} missing square feet or rent and not counted.`)
  return ok(resNet + comNet + othGross - expenses, { grossPotential: resGross + comGross + othGross, expenses, income: resNet + comNet + othGross, notes })
})

// NOI divided by annual debt service.
export const dscr = safe((record) => {
  const n = noi(record)
  const ds = annualDebtService(record)
  const failure = firstFailure(n, ds)
  if (failure) return passFailure(failure)
  if (ds.value <= 0) return na('There are no loan payments to cover.', need('sources'))
  return ok(n.value / ds.value)
})

// =============================================================================================
// T-12 (monthly actuals)
// =============================================================================================

const OPEX_KEYS = projectSchema.find((g) => g.id === 'operatingExpenses').rows.map((r) => r.key)

// A month as a number of months since year 0, so "the next month" is always +1. Accepts 2026-06 and 2026-06-30.
const monthIndex = (text) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof text === 'string' ? text : '')
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}
const monthLabel = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`

// One T-12 row as numbers: potential income, what was actually collected, expenses, and NOI.
function monthFigures(row, idx) {
  const where = `T-12 ${monthLabel(idx)}`
  const revenue = [row.residentialRevenue, row.commercialRevenue, row.otherRevenue].map((v) => reading(v, 'money', `${where}: revenue`, 't12'))
  const vacancy = reading(row.vacancyLoss, 'signed', `${where}: vacancy loss`, 't12')
  const concessions = reading(row.concessions, 'signed', `${where}: concessions`, 't12')
  const expenseValues = [...OPEX_KEYS.map((k) => reading(row[k], 'money', `${where}: expense "${k}"`, 't12')), reading(row.otherExpenses, 'money', `${where}: other expenses`, 't12')]
  const revenueEntered = revenue.some(isNum)
  const expensesEntered = expenseValues.some(isNum)
  const potential = sum(revenue)
  const effective = potential - Math.abs(vacancy ?? 0) - Math.abs(concessions ?? 0)
  const expenses = sum(expenseValues)
  const reported = reading(row.noiReported, 'signed', `${where}: NOI as reported`, 't12')
  return {
    idx,
    potential,
    effective,
    expenses,
    expensesEntered,
    revenueEntered,
    noi: revenueEntered && expensesEntered ? effective - expenses : reported,
    debtService: reading(row.debtService, 'money', `${where}: debt service`, 't12'),
    occupancy: reading(row.occupancy, 'share', `${where}: occupancy`, 't12'),
  }
}

// The T-12 months in date order, one per calendar month (a later row for the same month replaces an earlier one).
function t12Months(record) {
  const byMonth = new Map()
  let undated = 0
  let duplicates = 0
  for (const row of record.data.t12.rows) {
    const idx = monthIndex(row.month)
    if (idx === null) {
      undated++
      continue
    }
    if (byMonth.has(idx)) duplicates++
    byMonth.set(idx, monthFigures(row, idx))
  }
  return { months: [...byMonth.values()].sort((a, b) => a.idx - b.idx), undated, duplicates }
}

function t12Needed(record) {
  try {
    if (record.data.t12.rows.length === 0) return { fail: na('No T-12 months entered.', need('t12')) }
    const t = t12Months(record)
    if (t.months.length === 0) return { fail: na('The T-12 rows have no month entered.', need('t12')) }
    return t
  } catch (e) {
    if (e instanceof Reject) return { fail: na(e.message, need(...e.groups)) }
    throw e
  }
}

// The latest run of back-to-back months, at most `n` long.
function recentRun(months, n) {
  const run = []
  for (let i = months.length - 1; i >= 0 && run.length < n; i--) {
    if (run.length && run[0].idx - months[i].idx !== 1) break
    run.unshift(months[i])
  }
  return run
}

// =============================================================================================
// KEY RATIOS
// =============================================================================================

// Builds a ratio. A numeric result that is not finite becomes "not available" instead of showing NaN or Infinity.
const ratio = (id, title, unit, result, extra = {}) =>
  result.ok && typeof result.value === 'number' && !Number.isFinite(result.value)
    ? { id, title, unit, ...na('The result is not a usable number. Check the inputs.', []) }
    : { id, title, unit, ...result, ...extra }

const divide = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null)

function dscrRatio(record, settings) {
  const r = dscr(record)
  const title = 'Debt service coverage (DSCR)'
  if (!r.ok) return ratio('dscr', title, 'times', r)
  const status = r.value >= settings.minDscr ? 'ok' : r.value >= 1 ? 'watch' : 'concern'
  const ds = annualDebtService(record)
  const detail = [`Lender's minimum: ${fmt.times(settings.minDscr)}`, ...(ds.notes ?? []), ...(noi(record).notes ?? [])]
  // The T-12 actual, when there is one. A month without its own debt service uses the loan payments from the sources table.
  const t = t12Needed(record)
  if (!t.fail) {
    const monthlyDs = (m) => m.debtService ?? (ds.ok && ds.value > 0 ? ds.value / 12 : null)
    const usable = t.months.filter((m) => isNum(m.noi) && monthlyDs(m) !== null && monthlyDs(m) > 0)
    if (usable.length) detail.push(`T-12 actual: ${fmt.times(sum(usable.map((m) => m.noi)) / sum(usable.map(monthlyDs)))}`)
  }
  return ratio('dscr', title, 'times', r, { status, detail })
}

function cushionRatio(record, settings) {
  const title = 'NOI cushion'
  const n = noi(record)
  const ds = annualDebtService(record)
  const failure = firstFailure(n, ds)
  if (failure) return ratio('noiCushion', title, 'percent', passFailure(failure))
  if (n.value <= 0) return ratio('noiCushion', title, 'percent', na('NOI is zero or negative, so there is no cushion.', []))
  if (ds.value <= 0) return ratio('noiCushion', title, 'percent', na('There are no loan payments to cover.', need('sources')))
  const toMinimum = (n.value - settings.minDscr * ds.value) / n.value
  const toOne = (n.value - ds.value) / n.value
  return ratio('noiCushion', title, 'percent', ok(toMinimum), {
    detail: [
      `NOI can fall ${fmt.pct(Math.max(toMinimum, 0))} before DSCR hits ${fmt.times(settings.minDscr)}${toMinimum < 0 ? ' (it is already below)' : ''}`,
      `and ${fmt.pct(Math.max(toOne, 0))} before it hits 1.00×${toOne < 0 ? ' (it is already below)' : ''}`,
    ],
  })
}

function breakEvenRatio(record) {
  const title = 'Break-even occupancy'
  const n = noi(record)
  const ds = annualDebtService(record)
  const failure = firstFailure(n, ds)
  if (failure) return ratio('breakEven', title, 'percent', passFailure(failure))
  const value = divide(n.expenses + ds.value, n.grossPotential)
  if (value === null) return ratio('breakEven', title, 'percent', na('Income at full occupancy is zero, so there is nothing to compare costs with.', need('residentialIncome', 'commercialIncome')))
  return ratio('breakEven', title, 'percent', ok(value), {
    detail: [value > 1 ? 'Above 100%: costs are not covered even when full.' : 'Occupancy at which income only just covers costs and loan payments.'],
  })
}

function debtYieldRatio(record) {
  const n = noi(record)
  const debt = totalDebt(record)
  const failure = firstFailure(n, debt)
  if (failure) return ratio('debtYield', 'Debt yield', 'percent', passFailure(failure))
  return ratio('debtYield', 'Debt yield', 'percent', ok(n.value / debt.value), { detail: [`NOI ${fmt.usd(n.value)} on ${fmt.usd(debt.value)} of debt`] })
}

function debtToCostRatio(record) {
  const debt = totalDebt(record)
  const cost = totalDevelopmentCost(record)
  const failure = firstFailure(debt, cost)
  if (failure) return ratio('debtToCost', 'Debt-to-cost', 'percent', passFailure(failure))
  return ratio('debtToCost', 'Debt-to-cost', 'percent', ok(debt.value / cost.value), { detail: [`${fmt.usd(debt.value)} of debt on ${fmt.usd(cost.value)} of cost`] })
}

const equityShareRatio = safe((record) => {
  const cost = totalDevelopmentCost(record)
  const sources = totalSources(record)
  const failure = firstFailure(cost, sources)
  if (failure) return ratio('equityShare', 'Equity share', 'percent', passFailure(failure))
  const byType = (types) => sum(record.data.sources.rows.map((r, i) => (types.includes(r.type) ? reading(r.amount, 'money', `Amount of "${sourceName(r, i)}"`, 'sources') : null)))
  return ratio('equityShare', 'Equity share', 'percent', ok(byType(['developer_equity', 'tax_credit_equity']) / cost.value), {
    detail: [`Typed as "Other": ${fmt.pct(byType(['other']) / cost.value)} of cost (deferred fees and the like can hide here)`],
  })
})

function yieldOnCostRatio(record) {
  const n = noi(record)
  const cost = totalDevelopmentCost(record)
  const failure = firstFailure(n, cost)
  if (failure) return ratio('yieldOnCost', 'Yield on cost', 'percent', passFailure(failure))
  return ratio('yieldOnCost', 'Yield on cost', 'percent', ok(n.value / cost.value), { detail: [`Stabilized NOI ${fmt.usd(n.value)} on ${fmt.usd(cost.value)} of cost`] })
}

// Contingency as a share of hard costs (before the contingency itself) and of soft costs (before its own contingency).
const contingencyRatio = safe((record) => {
  const title = 'Contingency'
  if (!budgetEntered(record)) return ratio('contingency', title, 'percent', na('No development budget entered.', need('budget')))
  const hardContingency = budgetSum(record, HARD_CONTINGENCY)
  const hardBase = budgetSum(record, HARD_KEYS) - hardContingency
  if (hardBase <= 0) return ratio('contingency', title, 'percent', na('No hard costs entered.', need('budget')))
  const softBase = budgetSum(record, SOFT_KEYS) - budgetSum(record, SOFT_CONTINGENCY)
  const detail = [`On hard costs of ${fmt.usd(hardBase)}`]
  if (softBase > 0) detail.push(`Soft-cost contingency: ${fmt.pct(budgetSum(record, SOFT_CONTINGENCY) / softBase)} of soft costs`)
  return ratio('contingency', title, 'percent', ok(hardContingency / hardBase), { detail })
})

function collectedRentRatio(record) {
  const title = 'Collected vs. potential rent'
  const t = t12Needed(record)
  if (t.fail) return ratio('collectedRent', title, 'percent', t.fail)
  const withRevenue = t.months.filter((m) => m.revenueEntered)
  const potential = sum(withRevenue.map((m) => m.potential))
  if (potential <= 0) return ratio('collectedRent', title, 'percent', na('No revenue entered in the T-12.', need('t12')))
  return ratio('collectedRent', title, 'percent', ok(sum(withRevenue.map((m) => m.effective)) / potential), {
    detail: [`Over ${withRevenue.length} month${withRevenue.length === 1 ? '' : 's'}, after vacancy and free rent`],
  })
}

// T-12 NOI against the underwritten NOI, and how many of the latest back-to-back months pass the DSCR and NOI tests.
function trailingRatio(record, settings) {
  const title = 'T-12 vs. underwritten, and stability'
  const t = t12Needed(record)
  if (t.fail) return ratio('trailing', title, 'percent', t.fail)
  const underwritten = noi(record)
  if (!underwritten.ok) return ratio('trailing', title, 'percent', passFailure(underwritten))
  if (underwritten.value <= 0) return ratio('trailing', title, 'percent', na('The underwritten NOI is zero or negative, so the T-12 cannot be compared with it.', need('residentialIncome', 'operatingExpenses')))
  const ds = annualDebtService(record)
  const withNoi = t.months.filter((m) => isNum(m.noi))
  if (withNoi.length === 0) return ratio('trailing', title, 'percent', na('The T-12 has no NOI and not enough lines to work it out.', need('t12')))

  const annualized = (sum(withNoi.map((m) => m.noi)) / withNoi.length) * 12
  const detail = [
    `T-12 NOI ${fmt.usd(annualized)} a year${withNoi.length < 12 ? ` (from ${withNoi.length} month${withNoi.length === 1 ? '' : 's'})` : ''} against ${fmt.usd(underwritten.value)} underwritten`,
  ]
  if (t.undated > 0) detail.push(`${t.undated} T-12 row${t.undated === 1 ? ' has' : 's have'} no month and ${t.undated === 1 ? 'is' : 'are'} not counted.`)
  if (t.duplicates > 0) detail.push(`${t.duplicates} month${t.duplicates === 1 ? ' appears' : 's appear'} more than once; the later entry is used.`)

  // Stability streak: each month must meet the NOI share and the DSCR minimum, and the months must be back to back.
  let streak = 0
  let testable = true
  let gapAfter = null
  for (let i = t.months.length - 1; i >= 0; i--) {
    const m = t.months[i]
    if (i < t.months.length - 1 && t.months[i + 1].idx - m.idx !== 1) {
      gapAfter = m.idx + 1
      break
    }
    const monthlyDs = m.debtService ?? (ds.ok && ds.value > 0 ? ds.value / 12 : null)
    if (!isNum(m.noi) || monthlyDs === null) {
      testable = false
      break
    }
    if (!(m.noi >= (settings.noiVsUnderwritten * underwritten.value) / 12 && m.noi / monthlyDs >= settings.minDscr)) break
    streak++
  }
  const needed = settings.consecutiveMonths
  if (!testable && streak === 0) {
    detail.push('Stability streak not available: a month is missing its NOI or its debt service.')
  } else {
    detail.push(`Stability streak: ${streak} month${streak === 1 ? '' : 's'} in a row (needs ${needed}) at ${fmt.times(settings.minDscr)} DSCR and ${fmt.pct(settings.noiVsUnderwritten, 0)} of underwritten NOI`)
    if (gapAfter !== null) detail.push(`There is no data for ${monthLabel(gapAfter)}, which ends the streak.`)
    if (t.months.length < needed) detail.push(`Only ${t.months.length} month${t.months.length === 1 ? '' : 's'} of data, fewer than the ${needed} needed.`)
  }
  const latest = [...t.months].reverse().find((m) => m.occupancy !== null)
  if (latest) detail.push(`Latest occupancy ${fmt.pct(latest.occupancy, 0)} (floor ${fmt.pct(settings.occupancyFloor, 0)})${latest.occupancy < settings.occupancyFloor ? ': below the floor' : ''}`)

  const status = streak >= needed && (!latest || latest.occupancy >= settings.occupancyFloor) ? 'ok' : streak > 0 ? 'watch' : 'concern'
  return ratio('trailing', title, 'percent', ok(annualized / underwritten.value), { status, detail, streak })
}

// How many months the budgeted reserves last at the recent monthly shortfall.
const runwayRatio = safe((record) => {
  const title = 'Operating runway'
  const rentUp = budgetAmount(record, 'rentUpReserve')
  const operating = budgetAmount(record, 'operatingReserve')
  if (!isNum(rentUp) && !isNum(operating)) return ratio('runway', title, 'months', na('No rent-up or operating reserve in the budget.', need('budget')))
  const t = t12Needed(record)
  if (t.fail) return ratio('runway', title, 'months', t.fail)
  const ds = annualDebtService(record)
  const recent = recentRun(t.months, 3)
  const shortfalls = []
  for (const m of recent) {
    const monthlyDs = m.debtService ?? (ds.ok ? ds.value / 12 : null)
    if (!m.revenueEntered || !m.expensesEntered || monthlyDs === null) {
      return ratio('runway', title, 'months', na('A recent T-12 month is missing revenue, expenses or debt service.', need('t12', 'sources')))
    }
    shortfalls.push(m.expenses + monthlyDs - m.effective)
  }
  const average = sum(shortfalls) / shortfalls.length
  const held = sum([rentUp, operating])
  const detail = [`${fmt.usd(held)} of budgeted rent-up and operating reserves`]
  if (average <= 0) return ratio('runway', title, 'text', ok('Not burning cash'), { detail: [...detail, `Recent months cover their costs (${fmt.usd(-average)} a month to spare)`] })
  return ratio('runway', title, 'months', ok(held / average), { detail: [...detail, `Average shortfall ${fmt.usd(average)} a month over the last ${shortfalls.length}`] })
})

const CORE = ['dscr', 'noiCushion', 'breakEven', 'debtYield']
const BY_STAGE = {
  development: [...CORE, 'debtToCost', 'equityShare', 'yieldOnCost', 'contingency'],
  lease_up: [...CORE, 'collectedRent', 'trailing', 'runway'],
  completed: [...CORE, 'collectedRent', 'trailing'],
}

export const ratioIdsForStage = (stage) => BY_STAGE[stage] ?? []

// The key ratios for the stage the underwriter chose, in display order. Empty if no stage has been chosen.
export function keyRatios(record, settings = DEFAULT_SETTINGS) {
  const build = {
    dscr: () => dscrRatio(record, settings),
    noiCushion: () => cushionRatio(record, settings),
    breakEven: () => breakEvenRatio(record),
    debtYield: () => debtYieldRatio(record),
    debtToCost: () => debtToCostRatio(record),
    equityShare: () => equityShareRatio(record),
    yieldOnCost: () => yieldOnCostRatio(record),
    contingency: () => contingencyRatio(record),
    collectedRent: () => collectedRentRatio(record),
    trailing: () => trailingRatio(record, settings),
    runway: () => runwayRatio(record),
  }
  return ratioIdsForStage(record.data.stage.stage).map((id) => build[id]())
}
