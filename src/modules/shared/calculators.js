// The shared calculators and key ratios from section 1g of the module spec. Built by M0.
//
// Every module uses these and never recomputes them. They read only what is stored in a project record, never today's
// date. When an input is missing a calculator does NOT guess a zero: it returns "not available" with the reason and the
// groups the underwriter needs to fill in. Nothing here changes a record.
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

// The first failed result among those given, or null if all worked.
const firstFailure = (...results) => results.find((r) => !r.ok) ?? null
const passFailure = (failure) => na(failure.reason, failure.needs)

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const SOFT_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Soft costs')).map((r) => r.key)
const HARD_CONTINGENCY = ['constructionContingency', 'ownersContingency']
const SOFT_CONTINGENCY = ['softCostContingency']

const budgetAmount = (record, key) => record.data.budget.lines[key]?.amount ?? null
const budgetSum = (record, keys) => sum(keys.map((k) => budgetAmount(record, k)))
const budgetEntered = (record) => BUDGET_ROWS.some((r) => isNum(budgetAmount(record, r.key)))

// ---- Formatting used in the details the ratios return
export const fmt = {
  usd: (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`,
  pct: (n, digits = 1) => `${(n * 100).toFixed(digits)}%`,
  times: (n) => `${n.toFixed(2)}×`,
}

// =============================================================================================
// BASE CALCULATORS
// =============================================================================================

export function totalSources(record) {
  const amounts = record.data.sources.rows.map((r) => r.amount).filter(isNum)
  if (amounts.length === 0) return na('No sources of money entered.', need('sources'))
  return ok(sum(amounts))
}

// Total uses and total development cost are the same number: every acquisition, hard cost and soft cost line.
export function totalUses(record) {
  if (!budgetEntered(record)) return na('No development budget entered.', need('budget'))
  return ok(sum(BUDGET_ROWS.map((r) => budgetAmount(record, r.key))))
}
export const totalDevelopmentCost = totalUses

// Monthly payment on a loan: the standard formula, with a zero rate meaning amount / term.
export function monthlyPayment(amount, annualRate, termMonths) {
  if (!isNum(amount) || !isNum(annualRate) || !isNum(termMonths) || termMonths <= 0) return null
  if (annualRate === 0) return amount / termMonths
  const r = annualRate / 12
  return (amount * r) / (1 - Math.pow(1 + r, -termMonths))
}

// For each source, 12 x its monthly payment. A typed payment wins; otherwise the standard loan payment.
// Debt sources need a term and a rate (or a typed payment). Other sources with a term and a rate count too, as in
// the applicant workbook; without them they have no payment.
export function annualDebtService(record) {
  const rows = record.data.sources.rows
  if (!rows.some((r) => isNum(r.amount))) return na('No sources of money entered.', need('sources'))
  const problems = []
  const nonDebt = []
  let total = 0
  let payments = 0
  rows.forEach((row, i) => {
    if (!isNum(row.amount) || row.amount <= 0) return
    const name = row.name || `source ${i + 1}`
    if (isNum(row.paymentOverride) && row.paymentOverride > 0) {
      total += row.paymentOverride * 12
      payments++
      return
    }
    const isDebt = DEBT_SOURCE_TYPES.includes(row.type)
    if (!isNum(row.termMonths) || row.termMonths <= 0) {
      if (isDebt) problems.push(`The loan "${name}" has no term.`)
      return
    }
    if (!isNum(row.interestRate)) {
      if (isDebt) problems.push(`The loan "${name}" has no interest rate.`)
      return
    }
    total += monthlyPayment(row.amount, row.interestRate, row.termMonths) * 12
    payments++
    if (!isDebt) nonDebt.push(name)
  })
  if (problems.length) return na(problems.join(' '), need('sources'))
  // Say so when payments come from sources that are not typed as debt, so it is never a silent assumption.
  const notes = nonDebt.length ? [`Includes payments on ${nonDebt.map((n) => `"${n}"`).join(', ')}, which ${nonDebt.length === 1 ? 'is' : 'are'} not typed as debt (the applicant's workbook counts these too).`] : []
  return ok(total, { payments, notes })
}

export function totalDebt(record) {
  const amounts = record.data.sources.rows.filter((r) => DEBT_SOURCE_TYPES.includes(r.type)).map((r) => r.amount)
  const total = sum(amounts)
  if (total <= 0) return na('No debt entered (hard, government or mezzanine debt).', need('sources'))
  return ok(total)
}

// Net operating income at stabilization: income after vacancy, minus operating expenses (replacement reserves included).
// Also returns the pieces other ratios need.
export function noi(record) {
  const { residentialIncome: res, commercialIncome: com, otherIncome: oth, operatingExpenses: opx, otherExpenses: oex } = record.data
  const resRows = res.rows.filter((r) => isNum(r.units) && isNum(r.monthlyRent))
  const comRows = com.rows.filter((r) => isNum(r.sqft) && isNum(r.rentPerSqft))
  const othRows = oth.rows.filter((r) => isNum(r.monthlyIncome))
  if (resRows.length + comRows.length + othRows.length === 0) {
    return na('No income entered.', need('residentialIncome', 'commercialIncome', 'otherIncome'))
  }

  const resGross = sum(resRows.map((r) => r.units * r.monthlyRent * 12))
  const comGross = sum(comRows.map((r) => r.sqft * r.rentPerSqft))
  const othGross = sum(othRows.map((r) => r.monthlyIncome * 12))
  if (resGross > 0 && !isNum(res.stabilizedVacancy)) return na('Residential vacancy is not entered.', need('residentialIncome'))
  if (comGross > 0 && !isNum(com.stabilizedVacancy)) return na('Commercial vacancy is not entered.', need('commercialIncome'))

  const expenseValues = [...Object.values(opx.lines).map((l) => l.amount), ...oex.rows.map((r) => r.amount)]
  if (!expenseValues.some(isNum)) return na('No operating expenses entered.', need('operatingExpenses'))

  const resNet = resGross * (1 - (res.stabilizedVacancy ?? 0))
  const comNet = comGross * (1 - (com.stabilizedVacancy ?? 0))
  const grossPotential = resGross + comGross + othGross
  const expenses = sum(expenseValues)

  const notes = []
  const incompleteRes = res.rows.length - resRows.length
  const incompleteCom = com.rows.length - comRows.length
  if (incompleteRes > 0) notes.push(`${incompleteRes} residential row${incompleteRes === 1 ? ' is' : 's are'} missing units or rent and not counted.`)
  if (incompleteCom > 0) notes.push(`${incompleteCom} commercial row${incompleteCom === 1 ? ' is' : 's are'} missing square feet or rent and not counted.`)
  return ok(resNet + comNet + othGross - expenses, { grossPotential, expenses, income: resNet + comNet + othGross, notes })
}

// NOI divided by annual debt service.
export function dscr(record) {
  const n = noi(record)
  const ds = annualDebtService(record)
  const failure = firstFailure(n, ds)
  if (failure) return passFailure(failure)
  if (ds.value <= 0) return na('There are no loan payments to cover.', need('sources'))
  return ok(n.value / ds.value)
}

// =============================================================================================
// T-12 (monthly actuals) helpers
// =============================================================================================

// One T-12 row as numbers: potential income, what was actually collected, expenses, and NOI.
function monthFigures(row, opexKeys) {
  const revenue = [row.residentialRevenue, row.commercialRevenue, row.otherRevenue]
  const revenueEntered = revenue.some(isNum)
  const potential = sum(revenue)
  const effective = potential - Math.abs(row.vacancyLoss ?? 0) - Math.abs(row.concessions ?? 0)
  const expenseValues = [...opexKeys.map((k) => row[k]), row.otherExpenses]
  const expensesEntered = expenseValues.some(isNum)
  const expenses = sum(expenseValues)
  const computed = revenueEntered && expensesEntered ? effective - expenses : null
  return {
    month: row.month,
    potential,
    effective,
    expenses,
    expensesEntered,
    revenueEntered,
    noi: computed ?? (isNum(row.noiReported) ? row.noiReported : null),
    debtService: isNum(row.debtService) ? row.debtService : null,
    occupancy: isNum(row.occupancy) ? row.occupancy : null,
  }
}

const OPEX_KEYS = projectSchema.find((g) => g.id === 'operatingExpenses').rows.map((r) => r.key)

// The T-12 months in date order. Rows with no month are left out and counted.
function t12Months(record) {
  const rows = record.data.t12.rows
  const dated = rows.filter((r) => typeof r.month === 'string' && r.month !== '')
  const months = dated.map((r) => monthFigures(r, OPEX_KEYS)).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  return { months, undated: rows.length - dated.length }
}

function t12Needed(record) {
  const { months, undated } = t12Months(record)
  if (record.data.t12.rows.length === 0) return { fail: na('No T-12 months entered.', need('t12')) }
  if (months.length === 0) return { fail: na('The T-12 rows have no month entered.', need('t12')) }
  return { months, undated }
}

// =============================================================================================
// KEY RATIOS
// =============================================================================================

const ratio = (id, title, unit, result, extra = {}) => ({ id, title, unit, ...result, ...extra })

function dscrRatio(record, settings) {
  const r = dscr(record)
  if (!r.ok) return ratio('dscr', 'Debt service coverage (DSCR)', 'times', r)
  const status = r.value >= settings.minDscr ? 'ok' : r.value >= 1 ? 'watch' : 'concern'
  const detail = [`Lender's minimum: ${fmt.times(settings.minDscr)}`, ...(annualDebtService(record).notes ?? []), ...(noi(record).notes ?? [])]
  // The T-12 actual, when there is one.
  // A month without its own debt service figure uses the loan payments from the sources table, as the stability streak does.
  const t = t12Needed(record)
  const ds = annualDebtService(record)
  if (!t.fail) {
    const monthlyDs = (m) => m.debtService ?? (ds.ok && ds.value > 0 ? ds.value / 12 : null)
    const usable = t.months.filter((m) => isNum(m.noi) && monthlyDs(m) !== null && monthlyDs(m) > 0)
    if (usable.length) detail.push(`T-12 actual: ${fmt.times(sum(usable.map((m) => m.noi)) / sum(usable.map(monthlyDs)))}`)
  }
  return ratio('dscr', 'Debt service coverage (DSCR)', 'times', r, { status, detail })
}

function cushionRatio(record, settings) {
  const n = noi(record)
  const ds = annualDebtService(record)
  const failure = firstFailure(n, ds)
  if (failure) return ratio('noiCushion', 'NOI cushion', 'percent', passFailure(failure))
  if (n.value <= 0) return ratio('noiCushion', 'NOI cushion', 'percent', na('NOI is zero or negative, so there is no cushion.', []))
  if (ds.value <= 0) return ratio('noiCushion', 'NOI cushion', 'percent', na('There are no loan payments to cover.', need('sources')))
  const toMinimum = (n.value - settings.minDscr * ds.value) / n.value
  const toOne = (n.value - ds.value) / n.value
  return ratio('noiCushion', 'NOI cushion', 'percent', ok(toMinimum), {
    detail: [
      `NOI can fall ${fmt.pct(Math.max(toMinimum, 0))} before DSCR hits ${fmt.times(settings.minDscr)}${toMinimum < 0 ? ' (it is already below)' : ''}`,
      `and ${fmt.pct(Math.max(toOne, 0))} before it hits 1.00×${toOne < 0 ? ' (it is already below)' : ''}`,
    ],
  })
}

function breakEvenRatio(record) {
  const n = noi(record)
  const ds = annualDebtService(record)
  const failure = firstFailure(n, ds)
  if (failure) return ratio('breakEven', 'Break-even occupancy', 'percent', passFailure(failure))
  const value = (n.expenses + ds.value) / n.grossPotential
  return ratio('breakEven', 'Break-even occupancy', 'percent', ok(value), {
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

function equityShareRatio(record) {
  const cost = totalDevelopmentCost(record)
  const sources = totalSources(record)
  const failure = firstFailure(cost, sources)
  if (failure) return ratio('equityShare', 'Equity share', 'percent', passFailure(failure))
  const byType = (types) => sum(record.data.sources.rows.filter((r) => types.includes(r.type)).map((r) => r.amount))
  const equity = byType(['developer_equity', 'tax_credit_equity'])
  const other = byType(['other'])
  return ratio('equityShare', 'Equity share', 'percent', ok(equity / cost.value), {
    detail: [`Typed as "Other": ${fmt.pct(other / cost.value)} of cost (deferred fees and the like can hide here)`],
  })
}

function yieldOnCostRatio(record) {
  const n = noi(record)
  const cost = totalDevelopmentCost(record)
  const failure = firstFailure(n, cost)
  if (failure) return ratio('yieldOnCost', 'Yield on cost', 'percent', passFailure(failure))
  return ratio('yieldOnCost', 'Yield on cost', 'percent', ok(n.value / cost.value), { detail: [`Stabilized NOI ${fmt.usd(n.value)} on ${fmt.usd(cost.value)} of cost`] })
}

// Contingency as a share of hard costs (before the contingency itself) and of soft costs (before its own contingency).
function contingencyRatio(record) {
  if (!budgetEntered(record)) return ratio('contingency', 'Contingency', 'percent', na('No development budget entered.', need('budget')))
  const hardTotal = budgetSum(record, HARD_KEYS)
  const hardBase = hardTotal - budgetSum(record, HARD_CONTINGENCY)
  if (hardBase <= 0) return ratio('contingency', 'Contingency', 'percent', na('No hard costs entered.', need('budget')))
  const hard = budgetSum(record, HARD_CONTINGENCY) / hardBase
  const softBase = budgetSum(record, SOFT_KEYS) - budgetSum(record, SOFT_CONTINGENCY)
  const detail = [`On hard costs of ${fmt.usd(hardBase)}`]
  if (softBase > 0) detail.push(`Soft-cost contingency: ${fmt.pct(budgetSum(record, SOFT_CONTINGENCY) / softBase)} of soft costs`)
  return ratio('contingency', 'Contingency', 'percent', ok(hard), { detail })
}

function collectedRentRatio(record) {
  const t = t12Needed(record)
  if (t.fail) return ratio('collectedRent', 'Collected vs. potential rent', 'percent', t.fail)
  const withRevenue = t.months.filter((m) => m.revenueEntered)
  const potential = sum(withRevenue.map((m) => m.potential))
  if (potential <= 0) return ratio('collectedRent', 'Collected vs. potential rent', 'percent', na('No revenue entered in the T-12.', need('t12')))
  const collected = sum(withRevenue.map((m) => m.effective))
  return ratio('collectedRent', 'Collected vs. potential rent', 'percent', ok(collected / potential), {
    detail: [`Over ${withRevenue.length} month${withRevenue.length === 1 ? '' : 's'}, after vacancy and free rent`],
  })
}

// T-12 NOI against the underwritten NOI, and how many of the latest months in a row pass the DSCR and NOI tests.
function trailingRatio(record, settings) {
  const title = 'T-12 vs. underwritten, and stability'
  const t = t12Needed(record)
  if (t.fail) return ratio('trailing', title, 'percent', t.fail)
  const underwritten = noi(record)
  if (!underwritten.ok) return ratio('trailing', title, 'percent', passFailure(underwritten))
  const ds = annualDebtService(record)
  const withNoi = t.months.filter((m) => isNum(m.noi))
  if (withNoi.length === 0) return ratio('trailing', title, 'percent', na('The T-12 has no NOI and not enough lines to work it out.', need('t12')))

  const annualized = (sum(withNoi.map((m) => m.noi)) / withNoi.length) * 12
  const versus = annualized / underwritten.value
  const detail = [
    `T-12 NOI ${fmt.usd(annualized)} a year${withNoi.length < 12 ? ` (from ${withNoi.length} month${withNoi.length === 1 ? '' : 's'})` : ''} against ${fmt.usd(underwritten.value)} underwritten`,
  ]
  if (t.undated > 0) detail.push(`${t.undated} T-12 row${t.undated === 1 ? ' has' : 's have'} no month and ${t.undated === 1 ? 'is' : 'are'} not counted.`)

  // Stability streak: each month must meet the NOI share and the DSCR minimum.
  let streak = 0
  let testable = true
  for (let i = t.months.length - 1; i >= 0; i--) {
    const m = t.months[i]
    const monthlyDs = m.debtService ?? (ds.ok && ds.value > 0 ? ds.value / 12 : null)
    if (!isNum(m.noi) || monthlyDs === null) {
      testable = false
      break
    }
    const passes = m.noi >= (settings.noiVsUnderwritten * underwritten.value) / 12 && m.noi / monthlyDs >= settings.minDscr
    if (!passes) break
    streak++
  }
  const needed = settings.consecutiveMonths
  if (!testable && streak === 0) {
    detail.push('Stability streak not available: a month is missing its NOI or its debt service.')
  } else {
    detail.push(`Stability streak: ${streak} month${streak === 1 ? '' : 's'} in a row (needs ${needed}) at ${fmt.times(settings.minDscr)} DSCR and ${fmt.pct(settings.noiVsUnderwritten, 0)} of underwritten NOI`)
    if (t.months.length < needed) detail.push(`Only ${t.months.length} month${t.months.length === 1 ? '' : 's'} of data, fewer than the ${needed} needed.`)
  }
  const latest = [...t.months].reverse().find((m) => m.occupancy !== null)
  if (latest) detail.push(`Latest occupancy ${fmt.pct(latest.occupancy, 0)} (floor ${fmt.pct(settings.occupancyFloor, 0)})${latest.occupancy < settings.occupancyFloor ? ': below the floor' : ''}`)

  const status = streak >= needed && (!latest || latest.occupancy >= settings.occupancyFloor) ? 'ok' : streak > 0 ? 'watch' : 'concern'
  return ratio('trailing', title, 'percent', ok(versus), { status, detail, streak })
}

// How many months the budgeted reserves last at the recent monthly shortfall.
function runwayRatio(record) {
  const reserves = budgetAmount(record, 'rentUpReserve') ?? null
  const operating = budgetAmount(record, 'operatingReserve') ?? null
  if (!isNum(reserves) && !isNum(operating)) {
    return ratio('runway', 'Operating runway', 'months', na('No rent-up or operating reserve in the budget.', need('budget')))
  }
  const t = t12Needed(record)
  if (t.fail) return ratio('runway', 'Operating runway', 'months', t.fail)
  const ds = annualDebtService(record)
  const recent = t.months.slice(-3)
  const shortfalls = []
  for (const m of recent) {
    const monthlyDs = m.debtService ?? (ds.ok ? ds.value / 12 : null)
    if (!m.revenueEntered || !m.expensesEntered || monthlyDs === null) {
      return ratio('runway', 'Operating runway', 'months', na('A recent T-12 month is missing revenue, expenses or debt service.', need('t12', 'sources')))
    }
    shortfalls.push(m.expenses + monthlyDs - m.effective)
  }
  const average = sum(shortfalls) / shortfalls.length
  const held = sum([reserves, operating])
  const detail = [`${fmt.usd(held)} of budgeted rent-up and operating reserves`]
  if (average <= 0) return ratio('runway', 'Operating runway', 'text', ok('Not burning cash'), { detail: [...detail, `Recent months cover their costs (${fmt.usd(-average)} a month to spare)`] })
  return ratio('runway', 'Operating runway', 'months', ok(held / average), { detail: [...detail, `Average shortfall ${fmt.usd(average)} a month over the last ${shortfalls.length}`] })
}

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
