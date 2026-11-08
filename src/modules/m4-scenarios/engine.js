// The scenario engine (M4, layer 4). One mechanism for every stage: apply a set of levers to a COPY of the project, then
// ask the shared calculators (M0) for the results. Nothing here recomputes NOI, debt service, DSCR or debt yield; it only
// changes the inputs and reads the answers, so a scenario can never disagree with the key ratios on the project card.
//
// A case result is either { ok: true, ... } or { ok: false, reason, needs } like the shared calculators.

import {
  projectSchema,
  noi,
  annualDebtService,
  totalDebt,
  totalDevelopmentCost,
  keyRatios,
  DEFAULT_SETTINGS,
  DEBT_SOURCE_TYPES,
} from '../shared/index.js'
import { CASES, FILL_OCCUPANCY, resolveLevers } from './levers.js'
import { t12Basis } from './actuals.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const CONTINGENCY_KEYS = ['constructionContingency', 'ownersContingency']
const OVERRUN_KEYS = HARD_KEYS.filter((k) => !CONTINGENCY_KEYS.includes(k)) // the contingency is what absorbs an overrun
const RESERVE_KEYS = ['rentUpReserve', 'operatingReserve'] // the same reserves the "Operating runway" ratio uses

const amountOf = (record, key) => {
  const v = record.data.budget.lines[key]?.amount
  return isNum(v) ? v : null
}

// ---------------------------------------------------------------------------------------------
// Applying the levers to a copy of the record
// ---------------------------------------------------------------------------------------------

// Returns { record, notes }: a changed copy (the original is never touched) and anything the reviewer should know
// about a lever that could not be fully applied.
export function applyLevers(original, lv) {
  const record = structuredClone(original)
  const d = record.data
  const notes = []

  const rentChange = lv.rentChange ?? 0
  if (rentChange !== 0) {
    for (const r of d.residentialIncome.rows) if (isNum(r.monthlyRent)) r.monthlyRent = Math.max(0, r.monthlyRent * (1 + rentChange))
    for (const r of d.commercialIncome.rows) if (isNum(r.rentPerSqft)) r.rentPerSqft = Math.max(0, r.rentPerSqft * (1 + rentChange))
  }

  const vacancyChange = lv.vacancyChange ?? 0
  if (vacancyChange !== 0) {
    for (const g of [d.residentialIncome, d.commercialIncome]) if (isNum(g.stabilizedVacancy) && g.stabilizedVacancy >= 0 && g.stabilizedVacancy <= 1) g.stabilizedVacancy = clamp(g.stabilizedVacancy + vacancyChange, 0, 1)
  }

  const expenseGrowth = lv.expenseGrowth ?? 0
  if (expenseGrowth !== 0) {
    for (const line of Object.values(d.operatingExpenses.lines)) if (isNum(line.amount)) line.amount = Math.max(0, line.amount * (1 + expenseGrowth))
    for (const r of d.otherExpenses.rows) if (isNum(r.amount)) r.amount = Math.max(0, r.amount * (1 + expenseGrowth))
  }

  const rateChange = lv.takeoutRate ?? 0
  if (rateChange !== 0) {
    const fixed = []
    for (const [i, r] of d.sources.rows.entries()) {
      // A rate outside 0% to 100% (6.5 typed instead of 6.5%) is left alone, so the calculators still refuse it.
      if (!DEBT_SOURCE_TYPES.includes(r.type) || !isNum(r.amount) || r.amount <= 0 || !isNum(r.interestRate) || r.interestRate < 0 || r.interestRate > 1) continue
      if (isNum(r.paymentOverride) && r.paymentOverride > 0) fixed.push(r.name || `source ${i + 1}`)
      else r.interestRate = clamp(r.interestRate + rateChange, 0, 1)
    }
    if (fixed.length) notes.push(`The rate change was not applied to ${fixed.map((n) => `"${n}"`).join(', ')}: a yearly payment was typed in, so the payment stays as typed.`)
  }

  const overrun = lv.costOverrun ?? 0
  if (overrun !== 0) {
    for (const key of OVERRUN_KEYS) {
      const line = d.budget.lines[key]
      if (isNum(line?.amount)) line.amount = line.amount * (1 + overrun)
    }
  }

  return { record, notes }
}

// ---------------------------------------------------------------------------------------------
// Results for one case
// ---------------------------------------------------------------------------------------------

// What each extra month costs while the building is not yet paying its way.
//  - Delay before delivery on a development project: nothing is earning, so a month of loan payments.
//  - Everything else (extra lease-up months): loan payments plus running costs, less what a half-full building earns.
function monthlyCarry({ stage, kind }, n, ds) {
  const loan = ds / 12
  if (stage === 'development' && kind === 'delay') return loan
  return Math.max(0, loan + n.expenses / 12 - (FILL_OCCUPANCY * n.income) / 12)
}

// The one-time money a stressed project needs: cost overruns beyond the contingency, and months of carrying costs beyond
// the budgeted reserves. Returns null for a stage that has none (a completed project is already built).
function fundingGap({ stage, original, stressed, n, ds, lv }) {
  if (stage === 'completed') return null
  const notes = []
  const overrun = lv.costOverrun ?? 0
  let overrunCost = 0
  if (overrun !== 0) {
    const before = totalDevelopmentCost(original)
    const after = totalDevelopmentCost(stressed)
    if (!before.ok || !after.ok) return { ok: false, reason: `The cost overrun cannot be priced: ${before.ok ? after.reason : before.reason}` }
    overrunCost = after.value - before.value
  }
  const contingency = sum(CONTINGENCY_KEYS.map((k) => amountOf(original, k)))
  const reservesEntered = RESERVE_KEYS.some((k) => amountOf(original, k) !== null)
  const reserves = sum(RESERVE_KEYS.map((k) => amountOf(original, k)))
  const carry = (lv.delayMonths ?? 0) * monthlyCarry({ stage, kind: 'delay' }, n, ds) + (lv.absorptionMonths ?? 0) * monthlyCarry({ stage, kind: 'absorption' }, n, ds)

  if (overrunCost > 0 && contingency === 0) notes.push('No contingency is budgeted, so the whole overrun is a funding gap.')
  if (carry > 0 && !reservesEntered) notes.push('No rent-up or operating reserve is budgeted, so all the carrying cost is a funding gap.')

  const overrunUncovered = Math.max(0, overrunCost - contingency)
  const carryUncovered = Math.max(0, carry - reserves)
  return {
    ok: true,
    overrunCost,
    contingency,
    overrunUncovered,
    carry,
    reserves,
    carryUncovered,
    gap: overrunUncovered + carryUncovered,
    notes,
  }
}

// Run one case. `lv` holds a value for every lever offered for the stage.
export function evaluateCase(original, stage, settings, lv) {
  const { record: stressed, notes } = applyLevers(original, lv)
  const n = noi(stressed)
  const ds = annualDebtService(stressed)
  const failure = !n.ok ? n : !ds.ok ? ds : null
  if (failure) return { ok: false, reason: failure.reason, needs: failure.needs }

  const ratios = Object.fromEntries(keyRatios(stressed, settings).map((r) => [r.id, r]))
  const valueOf = (id) => (ratios[id]?.ok && isNum(ratios[id].value) ? ratios[id].value : null)

  const result = {
    ok: true,
    noi: n.value,
    income: n.income,
    expenses: n.expenses,
    debtService: ds.value,
    cashFlow: n.value - ds.value, // yearly income left after loan payments (negative: not covered)
    yearlyShortfall: Math.max(0, ds.value - n.value), // how much a year the loan payments are not covered
    dscr: valueOf('dscr'),
    debtYield: valueOf('debtYield'),
    breakEven: valueOf('breakEven'),
    oneTime: fundingGap({ stage, original, stressed, n, ds: ds.value, lv }),
    exit: null,
    notes: [...notes, ...(ds.notes ?? []), ...(n.notes ?? [])],
  }

  if (stage === 'development' && isNum(lv.exitCapRate) && lv.exitCapRate > 0) {
    const debt = totalDebt(stressed)
    if (n.value > 0 && debt.ok) {
      const value = n.value / lv.exitCapRate
      result.exit = { capRate: lv.exitCapRate, value, loanToValue: debt.value / value }
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// All three cases
// ---------------------------------------------------------------------------------------------

// What the cases start from (decided with the underwriter):
//  - completed:   the T-12 actuals, when there is a usable one; otherwise the applicant's projection, with the reason.
//  - lease_up:    the projection (a building still filling has actuals that are low because it is not full yet), with the
//                 T-12 shown beside it as a reference.
//  - development: the projection (there is no T-12).
// options.basis = 'projection' forces the projection for a completed project, so the two can be compared.
function chooseBasis(project, stage, settings, wanted) {
  if (stage === 'development') return { kind: 'projection', record: project, reason: null, reference: null, t12Usable: false }
  const t = t12Basis(project, settings)
  if (stage === 'lease_up') {
    const reference = t.ok ? { summary: t.summary, annualNoi: t.annualNoi, months: t.months } : { reason: t.reason }
    return { kind: 'projection', record: project, reason: null, reference, t12Usable: t.ok }
  }
  if (t.ok && wanted !== 'projection') return { kind: 'actuals', record: t.record, months: t.months, annualNoi: t.annualNoi, summary: t.summary, rowIndexes: t.rowIndexes, t12Usable: true }
  const reason = !t.ok ? `There is no usable T-12, so the applicant's projection is used. ${t.reason}` : 'You chose to start from the applicant\'s projection.'
  return { kind: 'projection', record: project, reason, reference: null, t12Usable: t.ok }
}

// Runs downside, base and upside for a project. `requested` can change any lever for any case (see resolveLevers).
// Returns { ok: false, reason } when the project has no stage, otherwise { ok: true, stage, defs, levers, cases, basis, notes }.
export function runScenarios(project, { settings = DEFAULT_SETTINGS, levers: requested, basis: wanted = 'auto' } = {}) {
  const stage = project?.data?.stage?.stage
  if (!stage) return { ok: false, reason: 'Choose the project’s stage first. The stage decides which levers apply.', needs: [{ group: 'stage', label: 'Stage and review date' }] }
  const { defs, cases: levers, problems } = resolveLevers(stage, requested)
  const basis = chooseBasis(project, stage, settings, wanted)
  const start = basis.record
  const cases = Object.fromEntries(CASES.map((c) => [c.id, evaluateCase(start, stage, settings, levers[c.id])]))
  // A stress test on a project whose own numbers cannot be worked out would be a guess dressed up as a result. The levers
  // are applied to the project as entered, so if that is refused, every case says so, whatever its sliders are.
  const asEntered = evaluateCase(start, stage, settings, Object.fromEntries(defs.map((d) => [d.id, d.neutral])))
  if (!asEntered.ok) {
    for (const c of CASES) cases[c.id] = { ok: false, reason: `The project as entered cannot be worked out, so it cannot be stress-tested. ${asEntered.reason}`, needs: asEntered.needs }
  }
  const { record: _record, ...basisInfo } = basis
  return { ok: true, stage, defs, levers, cases, basis: basisInfo, notes: problems }
}
