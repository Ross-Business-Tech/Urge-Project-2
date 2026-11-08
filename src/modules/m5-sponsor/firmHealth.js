// M5-a: sponsor firm health. "Does this sponsor have the cash and earnings to deliver, and can it absorb a miss?"
//
// Four measures are worked out from the firm record (and, for global coverage, from the sponsor's projects), each
// scored 0 to 100, then combined into one firm health score:
//
//   Liquidity cover   firm cash and investments against what the firm owes within a year       weight 40%
//   Global DSCR       the firm's earnings plus its projects' income, against all debt payments  weight 30%
//   Fee dependence    how much of the firm's income is one fee, and whether income is shrinking weight 15%
//   Leverage          firm debt against firm equity                                              weight 15%
//
// Rules, the same as the shared calculators (M0):
//  - A missing input is never guessed as zero. The measure is "not available" with the reason and the form to fill in.
//  - A number that is not believable is refused the same way, naming the value.
//  - A measure that is not available is left out of the score, and the result says how many of the four were used.
//
// Each measure is { id, title, ok, value, text, score, weight, detail, notes } when it could be worked out, or
// { id, title, ok: false, reason, needs, weight } when it could not.

import { firmSchema } from '../shared/schema.js'
import { sanitizeSettings } from '../shared/settings.js'
import { noi, annualDebtService, fmt } from '../shared/calculators.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const entered = (list) => list.some(isNum)

export const WEIGHTS = { liquidity: 0.4, globalDscr: 0.3, feeDependence: 0.15, leverage: 0.15 }

// Score bands for the overall number.
export const LABELS = [
  { min: 75, label: 'Strong', plain: 'The firm looks able to deliver and to absorb a miss.' },
  { min: 55, label: 'Adequate', plain: 'No serious concern, but not much room for error.' },
  { min: 35, label: 'Weak', plain: 'The firm may struggle to cover its own commitments if something goes wrong.' },
  { min: 0, label: 'Failing', plain: 'The firm shows signs it could not cover its obligations.' },
]
export const labelFor = (score) => LABELS.find((l) => score >= l.min)

// ---------------------------------------------------------------------------------------------
// Reading the record safely
// ---------------------------------------------------------------------------------------------

const GROUPS = Object.fromEntries(firmSchema.map((g) => [g.id, { group: g.id, label: g.title }]))
const need = (...ids) => ids.map((id) => GROUPS[id])
const ok = (extra) => ({ ok: true, ...extra })
const na = (reason, needs = []) => ({ ok: false, reason, needs })

class Reject extends Error {
  constructor(reason, group) {
    super(reason)
    this.group = group
  }
}

// Labels as the applicant's workbook words them, for messages.
const rowLabels = (groupId) => Object.fromEntries(firmSchema.find((g) => g.id === groupId).rows.map((r) => [r.key, r.label]))
const columnLabels = (groupId) => Object.fromEntries(firmSchema.find((g) => g.id === groupId).columns.map((c) => [c.key, c.label]))
const BS_LABEL = rowLabels('balanceSheet')
const PFS_LABEL = rowLabels('principalStatement')
const EARN_LABEL = columnLabels('earnings')

// One number from the record. Blank gives null; a number that cannot be believed stops the measure with a reason.
function read(value, label, group) {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Reject(`${label} is ${value}, which is outside the believable range.`, group)
  return value
}

const safe = (fn) => (...args) => {
  try {
    return fn(...args)
  } catch (e) {
    if (e instanceof Reject) return na(e.message, need(e.group))
    throw e
  }
}

const balance = (firm, key, period = 'current') => read(firm.data.balanceSheet.lines[key]?.[period] ?? null, `Balance sheet "${BS_LABEL[key]}"`, 'balanceSheet')
const personal = (firm, key) => read(firm.data.principalStatement.lines[key]?.amount ?? null, `Personal statement "${PFS_LABEL[key]}"`, 'principalStatement')

// Linear score between points, held flat outside them. points: [[value, score], ...] in rising order of value.
export function interpolate(x, points) {
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]
    if (x <= x1) {
      const [x0, y0] = points[i - 1]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return points[points.length - 1][1]
}

// ---------------------------------------------------------------------------------------------
// Which fiscal years to use
// ---------------------------------------------------------------------------------------------

const FEE_KEYS = ['developerFee', 'propertyManagementFee', 'gcFee', 'assetManagementFee', 'otherFee1', 'otherFee2', 'otherFee3']
const EXPENSE_KEYS = ['salariesWages', 'leaseExpense', 'utilities', 'marketing', 'insurance', 'mealsEntertainment', 'travel', 'technologyTelecom', 'officeSupplies', 'legalProfessional', 'otherExpense1', 'otherExpense2']
const DEBT_PAYMENT_KEYS = ['existingInterestExpense', 'costOfOtherCapital']

const periodYear = (text) => {
  const years = String(text ?? '').match(/(?:19|20)\d\d/g)
  return years ? Number(years[years.length - 1]) : null
}

// The earnings table holds history and projections without saying which is which. The balance sheet's current period
// tells us where "now" is, so years after it are left out. With no period, every year is used.
function fiscalYears(firm) {
  const all = firm.data.earnings.rows.filter((r) => isNum(r.fiscalYear)).sort((a, b) => a.fiscalYear - b.fiscalYear)
  const limit = periodYear(firm.data.balanceSheet.currentPeriod)
  const upTo = limit === null ? all : all.filter((r) => r.fiscalYear <= limit)
  return { rows: upTo.length ? upTo : all, limit }
}

const earn = (row, key) => read(row[key] ?? null, `Fiscal ${row.fiscalYear} "${EARN_LABEL[key]}"`, 'earnings')

function income(row) {
  const fees = FEE_KEYS.map((k) => earn(row, k))
  const other = earn(row, 'nonFeeIncome')
  const distributions = earn(row, 'operatingCashDistributions')
  return {
    developer: earn(row, 'developerFee'),
    fees: sum(fees),
    other: sum([other]),
    distributions: sum([distributions]),
    total: sum([...fees, other, distributions]),
    entered: entered([...fees, other, distributions]),
  }
}

// ---------------------------------------------------------------------------------------------
// The four measures
// ---------------------------------------------------------------------------------------------

const LIQUID_FIRM = ['cash', 'pettyCash', 'temporaryInvestments']
const OWED_NOW = ['accountsPayable', 'businessCreditCards', 'salesTaxPayable', 'payrollLiabilities', 'otherLiabilities', 'currentPortionLongTermDebt']
const LIQUID_PERSONAL = ['cashChecking', 'cashSavings', 'certificatesOfDeposit', 'securities']
const FIRM_DEBT = ['notesPayable', 'mortgagePayable', 'currentPortionLongTermDebt']

const LIQUIDITY_POINTS = [[0, 0], [0.5, 30], [1, 60], [2, 100]]

// Firm cash and investments against what the firm owes within a year. The principal's own liquid assets are shown
// beside it, because a principal often guarantees, but they do not raise the score: the firm itself must be liquid.
export const liquidityCover = safe((firm) => {
  const liquid = LIQUID_FIRM.map((k) => balance(firm, k))
  const owed = OWED_NOW.map((k) => balance(firm, k))
  if (!entered(liquid)) return na('No cash or investments entered on the firm balance sheet.', need('balanceSheet'))
  if (!entered(owed)) return na('No current liabilities (payables, cards, taxes, payroll) entered on the firm balance sheet.', need('balanceSheet'))
  const cash = sum(liquid)
  const owing = sum(owed)
  const detail = [`Firm cash and investments ${fmt.usd(cash)} against ${fmt.usd(owing)} owed within a year`]

  const priorCash = sum(LIQUID_FIRM.map((k) => balance(firm, k, 'prior')))
  if (entered(LIQUID_FIRM.map((k) => balance(firm, k, 'prior'))) && priorCash !== cash) {
    detail.push(`Cash ${cash < priorCash ? 'fell' : 'rose'} from ${fmt.usd(priorCash)} in the prior period`)
  }
  const personalLiquid = LIQUID_PERSONAL.map((k) => personal(firm, k))
  if (entered(personalLiquid)) detail.push(`The principal also holds ${fmt.usd(sum(personalLiquid))} in cash and securities (not counted in the score)`)

  if (owing <= 0) return ok({ id: 'liquidity', title: 'Liquidity cover', value: null, text: 'No current obligations', score: 100, weight: WEIGHTS.liquidity, detail, notes: [], cash, owing })
  const value = cash / owing
  return ok({ id: 'liquidity', title: 'Liquidity cover', value, score: interpolate(value, LIQUIDITY_POINTS), weight: WEIGHTS.liquidity, detail, notes: [], cash, owing })
})

// Fee dependence: how much of the firm's income is the developer fee, and whether income is shrinking.
export const feeDependence = safe((firm) => {
  const { rows } = fiscalYears(firm)
  if (rows.length === 0) return na('No firm earnings by year entered.', need('earnings'))
  const window = rows.slice(-3).map((row) => ({ year: row.fiscalYear, ...income(row) }))
  const known = window.filter((w) => w.entered)
  if (known.length === 0) return na('No income entered in the firm earnings.', need('earnings'))

  const latest = window[window.length - 1]
  const detail = [`Income by year: ${window.map((w) => `${w.year} ${w.entered ? fmt.usd(w.total) : 'blank'}`).join(', ')}`]
  const scores = []
  let value = null
  let text = null

  if (latest.entered && latest.total > 0) {
    value = latest.developer / latest.total
    scores.push(interpolate(value, [[0.75, 100], [1, 0]]))
    detail.push(`The developer fee is ${fmt.pct(value, 0)} of ${latest.year} income`)
  } else if (latest.entered) {
    text = `No income in ${latest.year}`
  } else {
    text = `No income entered for ${latest.year}`
  }

  const first = known[0]
  const last = known[known.length - 1]
  if (known.length >= 2 && first.total > 0) {
    const change = (last.total - first.total) / first.total
    scores.push(interpolate(change, [[-0.5, 0], [0, 100]]))
    detail.push(`Income ${change < 0 ? 'fell' : 'rose'} ${fmt.pct(Math.abs(change), 0)} from ${first.year} to ${last.year}`)
  }
  if (scores.length === 0) return na('There is not enough income history to judge fee dependence.', need('earnings'))
  return ok({ id: 'feeDependence', title: 'Fee dependence', value, text, score: Math.min(...scores), weight: WEIGHTS.feeDependence, detail, notes: [] })
})

// Firm debt against firm equity, from the firm balance sheet.
export const leverage = safe((firm) => {
  const debt = FIRM_DEBT.map((k) => balance(firm, k))
  const equityEntered = balance(firm, 'partnersEquity')
  if (!entered(debt)) return na('No firm debt (notes, mortgage) entered on the firm balance sheet.', need('balanceSheet'))
  if (equityEntered === null) return na("No capital stock or partner's equity entered on the firm balance sheet.", need('balanceSheet'))
  const owing = sum(debt)
  const detail = [`Firm debt ${fmt.usd(owing)} against equity of ${fmt.usd(equityEntered)}`]
  if (equityEntered <= 0) return ok({ id: 'leverage', title: 'Leverage', value: null, text: 'No positive equity', score: 0, weight: WEIGHTS.leverage, detail, notes: [] })
  const value = owing / equityEntered
  return ok({ id: 'leverage', title: 'Leverage', value, score: interpolate(value, [[0.5, 100], [1, 70], [2, 30], [4, 0]]), weight: WEIGHTS.leverage, detail, notes: [] })
})

// Global DSCR: what the firm earns plus what its projects earn (each at the firm's share), against every debt payment.
// The principal's personal debt payments are not in the workbook, so they are not counted, and the result says so.
export const globalDscr = safe((firm, projects = [], settings) => {
  const { rows, limit } = fiscalYears(firm)
  if (rows.length === 0) return na('No firm earnings by year entered.', need('earnings'))
  const row = rows[rows.length - 1]
  const inc = income(row)
  if (!inc.entered) return na(`No income entered in the firm earnings for ${row.fiscalYear}.`, need('earnings'))

  // Money that flows from the projects to the firm is left out of the firm's own income: the projects' income is
  // added below, and counting both would count the same dollars twice.
  const firmIncome = inc.fees + inc.other
  const overhead = sum(EXPENSE_KEYS.map((k) => earn(row, k)))
  const firmDebtPayments = sum(DEBT_PAYMENT_KEYS.map((k) => earn(row, k)))
  const firmCashFlow = firmIncome - overhead

  const notes = []
  const detail = [`Firm cash flow in ${row.fiscalYear}: ${fmt.usd(firmIncome)} of fee and other income less ${fmt.usd(overhead)} of overhead = ${fmt.usd(firmCashFlow)}`]
  if (inc.distributions > 0) notes.push(`Operating cash distributions from projects (${fmt.usd(inc.distributions)}) are left out of the firm's income so the projects' income is not counted twice.`)
  if (!entered(DEBT_PAYMENT_KEYS.map((k) => earn(row, k)))) {
    notes.push("The firm's own interest expense and cost of capital are blank, so only the projects' loans are counted.")
  }
  const funded = sum(['securedDebt', 'unsecuredDebt'].map((k) => read(firm.data.capital.lines[k]?.funded ?? null, `Cap table "${k}" funded`, 'capital')))
  if (funded > 0 && firmDebtPayments === 0) notes.push(`The cap table shows ${fmt.usd(funded)} of funded firm debt but no payments on it.`)
  if (limit !== null && row.fiscalYear < limit) notes.push(`The latest firm earnings year is ${row.fiscalYear}, older than the balance sheet period (${limit}).`)

  const shares = new Map(firm.data.projects.rows.map((r) => [r.projectId, r.ownershipPct]))
  let projectNoi = 0
  let projectDebt = 0
  let counted = 0
  const skipped = []
  let assumedFull = 0
  for (const p of projects) {
    const name = p.data?.identity?.name || p.meta?.projectId || 'a project'
    const n = noi(p)
    const d = annualDebtService(p)
    if (!n.ok || !d.ok) {
      skipped.push(`${name} (${(!n.ok ? n : d).reason})`)
      continue
    }
    const share = shares.get(p.meta?.projectId)
    const use = isNum(share) && share >= 0 && share <= 1 ? share : 1
    if (use === 1 && !(isNum(share) && share === 1)) assumedFull++
    projectNoi += n.value * use
    projectDebt += d.value * use
    counted++
  }
  detail.push(counted ? `${counted} of ${projects.length} project${projects.length === 1 ? '' : 's'} counted: income ${fmt.usd(projectNoi)} against loan payments of ${fmt.usd(projectDebt)}` : 'No project had enough data to count')
  if (assumedFull) notes.push(`The firm's ownership share is blank for ${assumedFull} project${assumedFull === 1 ? '' : 's'}, so the whole project is counted.`)
  if (skipped.length) notes.push(`Left out for lack of data: ${skipped.join('; ')}.`)

  const debtService = firmDebtPayments + projectDebt
  if (counted === 0 && skipped.length) return na(`None of the sponsor's projects could be counted: ${skipped.join('; ')}.`, need('projects'))
  if (debtService <= 0) return na('No debt payments were found for the firm or its projects, so coverage cannot be worked out.', need('earnings'))
  const value = (firmCashFlow + projectNoi) / debtService
  const min = Math.max(sanitizeSettings(settings).minDscr, 1.05)
  const score = interpolate(value, [[0.8, 0], [1, 40], [min, 70], [min + 0.3, 100]])
  detail.push(`All debt payments ${fmt.usd(debtService)} a year`)
  return ok({ id: 'globalDscr', title: 'Global DSCR', value, score, weight: WEIGHTS.globalDscr, detail, notes, counted, total: projects.length, firmCashFlow, debtService })
})

// ---------------------------------------------------------------------------------------------
// The firm health score
// ---------------------------------------------------------------------------------------------

// firmHealth(firm, projects, settings) -> { ok, score, label, plain, parts, used, total, notes }
// `projects` are the sponsor's project records (hidden tabs included). Without a firm there is nothing to judge.
export function firmHealth(firm, projects = [], settings) {
  if (!firm?.data) return { ok: false, reason: 'No firm record is loaded.', parts: [], used: 0, total: 4, notes: [] }
  const parts = [liquidityCover(firm), globalDscr(firm, projects, settings), feeDependence(firm), leverage(firm)].map((p, i) => ({
    ...p,
    id: p.id ?? ['liquidity', 'globalDscr', 'feeDependence', 'leverage'][i],
    title: p.title ?? ['Liquidity cover', 'Global DSCR', 'Fee dependence', 'Leverage'][i],
    weight: p.weight ?? Object.values(WEIGHTS)[i],
  }))
  const scored = parts.filter((p) => p.ok)
  const notes = [`The score is based on ${scored.length} of 4 measures.`, ...parts.filter((p) => !p.ok).map((p) => `${p.title} not available: ${p.reason}`)]
  if (scored.length === 0) return { ok: false, reason: 'None of the four measures could be worked out from the firm record.', parts, used: 0, total: 4, notes }
  const weightUsed = sum(scored.map((p) => p.weight))
  const score = Math.round(sum(scored.map((p) => p.score * p.weight)) / weightUsed)
  const band = labelFor(score)
  return { ok: true, score, label: band.label, plain: band.plain, parts, used: scored.length, total: 4, notes }
}
