// The transition checks (M3T): T1 delivery, T2 stabilization, T3 refinance or sale, plus the occupancy screen in 1f.
//
// Each check takes the prepared context `ctx` (see prepare in index.js) and returns a list of flags. Every flag carries
// its transition. A check that cannot run because data is missing returns one low "could not be checked" flag naming
// what is missing, so nothing is skipped silently.
//
// Stress settings are not invented here: the worse takeout or refinance rate and the worse cap rate are M4's downside
// starting values, so the transition checks and the scenario screen stress the same way.

import { annualDebtService, dscr, noi, totalDebt, keyRatios, projectSchema, fmt } from '../shared/index.js'
import { applyLevers } from '../m4-scenarios/engine.js'
import { t12Basis } from '../m4-scenarios/actuals.js'
import { FILL_OCCUPANCY, leversForStage } from '../m4-scenarios/levers.js'
import { timelineMonth, monthText, plural } from './dates.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)

// Lender tests that are not in the section 1f settings. Typical round figures; the underwriter can pass their own in
// context.transitions.
export const TRANSITION_DEFAULTS = Object.freeze({
  minDebtYield: 0.08, // lenders commonly want NOI to be at least 8% of the loan
  maxLoanToValue: 0.75, // and the loan to be at most 75% of the property's value
  concessionShare: 0.05, // free rent above 5% of billed rent deserves a question
})

const downside = (stage, id, fallback) => leversForStage(stage).find((l) => l.id === id)?.values.downside ?? fallback
export const stressRate = (stage) => downside(stage, 'takeoutRate', 0.015)
export const stressCapRate = () => downside('development', 'exitCapRate', 0.075)

const BUDGET_KEYS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_KEYS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const CONTINGENCY_KEYS = ['constructionContingency', 'ownersContingency']
export const RESERVE_KEYS = ['constructionInterest', 'rentUpReserve', 'operatingReserve'] // "interest reserve" (section 1b)
const budget = (p, key) => {
  const v = p.data.budget?.lines?.[key]?.amount
  return isNum(v) && v >= 0 && v <= 1e12 ? v : null
}
const budgetPaths = (p, keys) => keys.map((k) => `budget.lines.${k}.amount`).filter((path, i) => budget(p, keys[i]) !== null)
const loanPaths = (p) => (p.data.sources?.rows ?? []).flatMap((r, i) => (isNum(r?.amount) ? ['amount', 'termMonths', 'interestRate', 'paymentOverride'].filter((k) => isNum(r[k])).map((k) => `sources.rows.${i}.${k}`) : []))
const t12Paths = (p, keys, last = 3) => {
  const rows = p.data.t12?.rows ?? []
  const start = Math.max(0, rows.length - last)
  return rows.slice(start).flatMap((r, j) => keys.filter((k) => isNum(r?.[k])).map((k) => `t12.rows.${start + j}.${k}`))
}

// A "could not be checked" flag that keeps its transition.
function missing(ctx, { check, title, what, transition, cells = [] }) {
  const list = (Array.isArray(what) ? what : [what]).filter(Boolean).map((m) => String(m).replace(/[.\s]+$/, ''))
  return ctx.flag({
    id: `M3T-${check}-missing`,
    severity: 'low',
    title: `${title} could not be checked.`,
    evidence: `Missing: ${list.join('; ')}.`.slice(0, 1000),
    cell_refs: ctx.cite(cells),
    follow_up: `Please provide the missing information: ${list.join('; ')}.`.slice(0, 500),
    transition,
  })
}

// =============================================================================================
// T1: development to lease-up (delivery)
// =============================================================================================

// Is the delivery date realistic, and is the certificate of occupancy slipping?
export function checkDeliveryDate(ctx) {
  const { project: p, asOf } = ctx
  const start = timelineMonth(p.data.timeline?.constructionStart)
  const done = timelineMonth(p.data.timeline?.constructionCompletion)
  const cells = ['timeline.constructionStart', 'timeline.constructionCompletion']
  if (!done) return [missing(ctx, { check: 'delivery-date', title: 'The delivery date', what: 'the construction completion date (Details E21)', transition: 'T1', cells })]
  const flags = []
  if (start && done.idx <= start.idx && !(start.approx || done.approx)) {
    flags.push(ctx.flag({
      id: 'M3T-delivery-schedule-inconsistent',
      severity: 'high',
      title: 'The building is due to be finished before construction starts.',
      evidence: `Construction start ${monthText(start.idx)}, completion ${monthText(done.idx)}.`,
      cell_refs: ctx.cite(cells),
      follow_up: 'Please confirm the construction start and completion dates and send the current construction schedule.',
      transition: 'T1',
    }))
  }
  if (!asOf) return [...flags, missing(ctx, { check: 'delivery-date', title: 'Whether the delivery date has slipped', what: 'the "as of" date of the review', transition: 'T1', cells: ['stage.asOfDate'] })]
  if (done.idx < asOf.idx && !done.approx) {
    const late = asOf.idx - done.idx
    flags.push(ctx.flag({
      id: 'M3T-delivery-late',
      severity: late > 6 ? 'high' : 'medium',
      title: 'The planned delivery date has passed, but the project is still under construction.',
      evidence: `Construction completion was ${monthText(done.idx)}; as of ${monthText(asOf.idx)} the stage is still development, ${plural(late, 'month')} later.`,
      cell_refs: ctx.cite([...cells, 'stage.asOfDate']),
      follow_up: 'What is the new completion date, when will the certificate of occupancy be issued, and who pays the extra months of interest?',
      transition: 'T1',
    }))
  } else if (done.approx && Math.floor(done.idx / 12) < Math.floor(asOf.idx / 12)) {
    flags.push(ctx.flag({
      id: 'M3T-delivery-late',
      severity: 'medium',
      title: 'The planned delivery year has passed, but the project is still under construction.',
      evidence: `Construction completion year ${Math.floor(done.idx / 12)}; the review is as of ${monthText(asOf.idx)}.`,
      cell_refs: ctx.cite([...cells, 'stage.asOfDate']),
      follow_up: 'What is the new completion date, and when will the certificate of occupancy be issued?',
      transition: 'T1',
    }))
  }
  return flags
}

// Will the interest reserve last until the first units lease, and through lease-up?
export function interestReserve(ctx) {
  const { project: p, asOf } = ctx
  const start = timelineMonth(p.data.timeline?.constructionStart)
  const done = timelineMonth(p.data.timeline?.constructionCompletion)
  const stable = timelineMonth(p.data.timeline?.stabilization)
  const ds = annualDebtService(p)
  const needs = []
  if (!done) needs.push('the construction completion date (Details E21)')
  if (!start && !asOf) needs.push('the construction start date (Details E20) or the "as of" date')
  if (!ds.ok) needs.push(ds.reason)
  if (needs.length) return { ok: false, needs }

  const from = Math.max(start?.idx ?? -Infinity, asOf?.idx ?? -Infinity)
  const buildMonths = Math.max(0, done.idx - from)
  const reserveLines = RESERVE_KEYS.map((k) => budget(p, k))
  const entered = reserveLines.some((v) => v !== null)
  const reserve = sum(reserveLines)
  const monthlyLoan = ds.value / 12
  const n = noi(p)
  const leaseMonths = stable && stable.idx > done.idx ? stable.idx - done.idx : null
  const monthlyCarry = n.ok ? Math.max(0, monthlyLoan + n.expenses / 12 - (FILL_OCCUPANCY * n.income) / 12) : null
  const buildNeed = buildMonths * monthlyLoan
  const leaseNeed = leaseMonths !== null && monthlyCarry !== null ? leaseMonths * monthlyCarry : 0
  return {
    ok: true,
    entered,
    reserve,
    monthlyLoan,
    buildMonths,
    leaseMonths,
    monthlyCarry,
    buildNeed,
    leaseNeed,
    need: buildNeed + leaseNeed,
    monthsCovered: monthlyLoan > 0 ? reserve / monthlyLoan : null,
    deliveryText: monthText(done.idx, done.approx),
  }
}

export function checkInterestReserve(ctx) {
  const r = interestReserve(ctx)
  const cells = [...budgetPaths(ctx.project, RESERVE_KEYS), 'timeline.constructionStart', 'timeline.constructionCompletion', 'timeline.stabilization', ...loanPaths(ctx.project)]
  if (!r.ok) return [missing(ctx, { check: 'interest-reserve', title: 'Whether the interest reserve lasts until delivery', what: r.needs, transition: 'T1', cells })]
  if (r.monthlyLoan <= 0 || r.need <= 0) return []
  const lines = 'construction interest, rent-up reserve and operating reserve'
  const leaseText = r.leaseMonths !== null && r.monthlyCarry !== null ? ` Lease-up then takes ${plural(r.leaseMonths, 'month')} at about ${fmt.usd(r.monthlyCarry)} a month while the building fills (it earns about ${Math.round(FILL_OCCUPANCY * 100)}% of its stabilized income).` : ''
  const base = `Reserve ${fmt.usd(r.reserve)} (${lines}). Loan payments ${fmt.usd(r.monthlyLoan)} a month at the full payment, so it covers about ${r.monthsCovered.toFixed(1)} months. ${plural(r.buildMonths, 'month')} of construction remain until delivery (${r.deliveryText}).${leaseText}`
  if (r.reserve < r.buildNeed) {
    return [ctx.flag({
      id: 'M3T-interest-reserve-short',
      severity: 'high',
      title: r.entered ? 'The interest reserve runs out before the building is finished.' : 'No interest reserve is budgeted to carry the loan until the building is finished.',
      evidence: `${base} Needed until delivery: ${fmt.usd(r.buildNeed)}; short by ${fmt.usd(r.buildNeed - r.reserve)}.`.slice(0, 1000),
      cell_refs: ctx.cite(cells),
      follow_up: 'How will the loan payments be made until the first units lease, and who has committed to fund the shortfall?',
      transition: 'T1',
    })]
  }
  if (r.reserve < r.need) {
    return [ctx.flag({
      id: 'M3T-interest-reserve-short',
      severity: 'medium',
      title: 'The interest reserve lasts until delivery but runs out during lease-up.',
      evidence: `${base} Needed through lease-up: ${fmt.usd(r.need)}; short by ${fmt.usd(r.need - r.reserve)}.`.slice(0, 1000),
      cell_refs: ctx.cite(cells),
      follow_up: 'If lease-up takes as long as planned, where does the money for the loan payments come from once the reserve is used up?',
      transition: 'T1',
    })]
  }
  return []
}

// Over-budget delivery: could the contingency absorb the overrun M4 uses in its downside case?
export function checkOverrunCushion(ctx) {
  const p = ctx.project
  const overrun = downside('development', 'costOverrun', 0.1)
  const contingency = sum(CONTINGENCY_KEYS.map((k) => budget(p, k)))
  const hardBase = sum(HARD_KEYS.map((k) => budget(p, k))) - contingency
  const cells = budgetPaths(p, [...CONTINGENCY_KEYS, 'concreteMasonry', 'carpentry'])
  if (hardBase <= 0) return [missing(ctx, { check: 'overrun-cushion', title: 'Whether the budget can absorb an over-budget delivery', what: 'the hard costs in the development budget (Budget tab)', transition: 'T1', cells })]
  const overrunCost = hardBase * overrun
  if (contingency >= overrunCost) return []
  return [ctx.flag({
    id: 'M3T-delivery-overrun-cushion',
    severity: contingency < overrunCost / 2 ? 'high' : 'medium',
    title: 'A typical cost overrun at delivery would use up the contingency and leave a funding gap.',
    evidence: `Contingency ${fmt.usd(contingency)} (${fmt.pct(contingency / hardBase)} of hard costs of ${fmt.usd(hardBase)}). A ${fmt.pct(overrun, 0)} overrun costs ${fmt.usd(overrunCost)}, leaving ${fmt.usd(overrunCost - contingency)} unfunded.`,
    cell_refs: ctx.cite(cells),
    follow_up: `If hard costs run ${fmt.pct(overrun, 0)} over budget, who pays the ${fmt.usd(overrunCost - contingency)} beyond the contingency, and is that commitment in writing?`,
    transition: 'T1',
  })]
}

// =============================================================================================
// T2: lease-up to completed (stabilization)
// =============================================================================================

export function checkAbsorption(ctx) {
  const v = ctx.view
  const cells = [...t12Paths(ctx.project, ['occupancy'], 6), 'timeline.stabilization']
  if (!v.ok) return [missing(ctx, { check: 'absorption', title: 'The lease-up pace', what: `${v.reason} The T-12 template has a monthly occupancy column`, transition: 'T2', cells })]
  const a = v.absorption
  if (!a.ok) return [missing(ctx, { check: 'absorption', title: 'The lease-up pace', what: a.reason, transition: 'T2', cells })]
  if (a.reached) return []
  const occ = v.occupancy
  const paceText = `${a.pacePerMonth >= 0 ? '+' : ''}${(a.pacePerMonth * 100).toFixed(1)} points a month${a.unitsPerMonth !== null ? ` (about ${Math.max(0, a.unitsPerMonth).toFixed(1)} units a month)` : ''}`
  const base = `Occupancy ${fmt.pct(occ.latest, 0)} in ${occ.latestMonth}, target ${fmt.pct(a.target, 0)}. Pace over the last ${plural(occ.points, 'month')}: ${paceText}.`
  if (a.monthsToTarget === null) {
    return [ctx.flag({
      id: 'M3T-absorption-slow',
      severity: 'high',
      title: 'Occupancy is not rising, so at this pace the property never fills.',
      evidence: `${base}${a.planned ? ` Planned stabilization: ${a.planned.text}.` : ''}`,
      cell_refs: ctx.cite(cells),
      follow_up: 'Why has leasing stalled, what is the plan to fill the remaining units, and what would it cost?',
      transition: 'T2',
    })]
  }
  if (!a.planned) {
    return [missing(ctx, { check: 'absorption-plan', title: 'Whether lease-up is on schedule', what: 'the planned stabilization date (Details E22)', transition: 'T2', cells: ['timeline.stabilization'] })]
  }
  if (a.monthsLate <= 0) return []
  const needed = a.neededPace !== null ? ` To make the plan it needs about ${(a.neededPace * 100).toFixed(1)} points a month.` : ' The planned date has already passed.'
  return [ctx.flag({
    id: 'M3T-absorption-slow',
    severity: a.monthsLate > 6 ? 'high' : 'medium',
    title: 'The property is filling more slowly than underwritten.',
    evidence: `${base} At this pace it reaches ${fmt.pct(a.target, 0)} around ${a.reachText}, ${plural(a.monthsLate, 'month')} after the planned stabilization (${a.planned.text}).${needed}`,
    cell_refs: ctx.cite(cells),
    follow_up: `At the current pace, stabilization slips about ${plural(a.monthsLate, 'month')}. What will speed up leasing, and do the reserves and the loan terms allow for the delay?`,
    transition: 'T2',
  })]
}

export function checkConcessions(ctx) {
  const v = ctx.view
  if (!v.ok || !v.concessions.ok) return [] // nothing entered is reported in the notes; absorption already names a missing T-12
  const c = v.concessions
  const limit = ctx.limits.concessionShare
  if (c.share < limit) return []
  const masking = c.billedRent !== null && c.netRent !== null && c.underwrittenRent !== null && c.billedRent >= c.underwrittenRent && c.netRent < c.underwrittenRent
  const rents = c.billedRent !== null && c.netRent !== null ? ` Billed rent ${fmt.usd(c.billedRent)} a unit, ${fmt.usd(c.netRent)} after free rent${c.underwrittenRent !== null ? `, against ${fmt.usd(c.underwrittenRent)} underwritten` : ''}.` : ''
  return [ctx.flag({
    id: 'M3T-concessions-masking-rent',
    severity: masking || c.share >= limit * 2 ? 'high' : 'medium',
    title: masking ? 'Free rent is hiding that real rents are below the underwritten rent.' : 'Heavy concessions mean the headline rents overstate what tenants really pay.',
    evidence: `Concessions ${fmt.usd(c.monthly)} a month, ${fmt.pct(c.share)} of billed residential rent over the last ${plural(c.months, 'month')} (look-at level ${fmt.pct(limit, 0)}).${rents}`,
    cell_refs: ctx.cite(t12Paths(ctx.project, ['concessions', 'residentialRevenue'])),
    follow_up: 'What concessions are being offered, when do they burn off, and what rent do renewing tenants actually sign at?',
    transition: 'T2',
  })]
}

// Does the debt still work at stabilization? Underwritten NOI at the worse takeout rate, and the debt yield.
export function checkTakeout(ctx) {
  const p = ctx.project
  const shock = stressRate(ctx.stage)
  const stressed = applyLevers(p, { takeoutRate: shock }).record
  const after = dscr(stressed)
  const before = dscr(p)
  const cells = [...loanPaths(p), 'residentialIncome.stabilizedVacancy']
  if (!after.ok || !before.ok) return [missing(ctx, { check: 'takeout', title: 'The takeout test', what: (after.ok ? before : after).reason, transition: 'T2', cells })]
  const flags = []
  const min = ctx.settings.minDscr
  if (after.value < min) {
    flags.push(ctx.flag({
      id: 'M3T-takeout-test',
      severity: after.value < 1 ? 'high' : 'medium',
      title: after.value < 1 ? 'At a higher takeout rate, the stabilized income would not cover the loan payments.' : 'At a higher takeout rate, the loan would miss the lender’s coverage test at stabilization.',
      evidence: `DSCR ${fmt.times(before.value)} as entered; ${fmt.times(after.value)} if the takeout loan costs ${(shock * 100).toFixed(2)} points more, against a minimum of ${fmt.times(min)}.`,
      cell_refs: ctx.cite(cells),
      follow_up: 'If rates are higher when the construction loan is taken out, how big a permanent loan will the property support, and who funds the difference?',
      transition: 'T2',
    }))
  }
  flags.push(...debtYieldFlags(ctx, p, 'M3T-takeout-debt-yield', 'T2', 'at stabilization', cells))
  return flags
}

// The operating runway against the months still to go until the stability test is met.
export function checkRunway(ctx) {
  const v = ctx.view
  const runway = keyRatios(ctx.project, ctx.settings).find((r) => r.id === 'runway')
  const cells = [...budgetPaths(ctx.project, ['rentUpReserve', 'operatingReserve']), ...t12Paths(ctx.project, ['residentialRevenue', 'debtService'])]
  if (!runway) return []
  if (!runway.ok) return [missing(ctx, { check: 'runway', title: 'Whether the reserves last until stabilization', what: runway.reason, transition: 'T2', cells })]
  if (runway.unit !== 'months' || !v.ok) return [] // not burning cash
  const est = v.stability.estimate
  const months = runway.value
  if (est.ok && est.onTrack && months >= est.monthsAway) return []
  if (!est.ok && months >= 6) return []
  const when = est.ok && est.onTrack ? `the stability test is about ${plural(est.monthsAway, 'month')} away (around ${est.monthText})` : 'at the current pace the stability test is not in sight'
  return [ctx.flag({
    id: 'M3T-reserves-run-out',
    severity: 'high',
    title: 'The rent-up and operating reserves run out before the property stabilizes.',
    evidence: `Reserves last about ${months.toFixed(1)} months at the recent shortfall (${(runway.detail ?? []).join('; ')}), but ${when}.`.slice(0, 1000),
    cell_refs: ctx.cite(cells),
    follow_up: 'When the reserves are used up, who covers the monthly shortfall until the property stabilizes, and how much have they committed?',
    transition: 'T2',
  })]
}

// The occupancy screen (section 1f): low occupancy combined with rent well above market.
export function checkOccupancyScreen(ctx) {
  const v = ctx.view
  const transition = ctx.stage === 'completed' ? 'T3' : 'T2'
  const cells = [...t12Paths(ctx.project, ['occupancy', 'residentialRevenue', 'concessions'], 1), 'residentialIncome.rows.0.units', 'residentialIncome.rows.0.unitType']
  if (!v.ok) return [missing(ctx, { check: 'occupancy-screen', title: 'The occupancy screen (low occupancy with high rent)', what: v.reason, transition, cells })]
  const occ = v.occupancy
  if (occ.latest === null) return [missing(ctx, { check: 'occupancy-screen', title: 'The occupancy screen (low occupancy with high rent)', what: 'monthly occupancy in the T-12', transition, cells })]
  if (!occ.belowFloor) return []
  const rent = v.rentVsMarket
  if (!rent.ok || rent.premium === null) return [missing(ctx, { check: 'occupancy-screen', title: 'Whether the low occupancy comes with rents above market', what: rent.reason ?? 'a market rent to compare with', transition, cells })]
  if (rent.premium <= ctx.settings.rentPremium) return []
  const coverage = dscr(ctx.project)
  const passes = v.stability.ok && v.stability.streak >= v.stability.needed
  const dscrText = coverage.ok ? ` DSCR ${fmt.times(coverage.value)}${coverage.value >= ctx.settings.minDscr ? ' passes' : ' is below the minimum'}` : ''
  const streakText = v.stability.ok ? `; stability streak ${plural(v.stability.streak, 'month')} (needs ${v.stability.needed})` : ''
  return [ctx.flag({
    id: 'M3T-high-rent-low-occupancy',
    severity: 'high',
    title: passes ? 'The coverage tests pass, but only with rents well above market while many units sit empty.' : 'Many units sit empty while the rents asked are well above market.',
    evidence: `Occupancy ${fmt.pct(occ.latest, 0)} in ${occ.latestMonth} (floor ${fmt.pct(ctx.settings.occupancyFloor, 0)}). Achieved rent ${fmt.usd(rent.achieved)} a unit vs. ${fmt.usd(rent.market)} market, ${fmt.pct(rent.premium, 0)} above (look-at level ${fmt.pct(ctx.settings.rentPremium, 0)}).${dscrText}${streakText}.`,
    cell_refs: ctx.cite(cells),
    follow_up: 'Why is occupancy low at these rents? What occupancy would the property reach at market rent, and would the loan still be covered if rents had to come down to fill it?',
    transition,
  })]
}

// A loan that comes due before (or soon after) the property stabilizes, or soon on a completed property.
export function checkMaturity(ctx) {
  const p = ctx.project
  const t = p.data.timeline ?? {}
  const anchor = ctx.stage === 'completed' ? timelineMonth(t.stabilization) ?? timelineMonth(t.constructionCompletion) : timelineMonth(t.constructionStart)
  const anchorName = ctx.stage === 'completed' ? 'stabilization' : 'construction start'
  const anchorCell = ctx.stage === 'completed' ? 'timeline.stabilization' : 'timeline.constructionStart'
  const rows = (p.data.sources?.rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => ['hard_debt', 'gov_debt', 'mezzanine_debt'].includes(r?.type) && isNum(r.amount) && r.amount > 0 && Number.isInteger(r.termMonths) && r.termMonths > 0 && r.termMonths <= 1200)
  if (rows.length === 0) return []
  const transition = ctx.stage === 'completed' ? 'T3' : 'T2'
  if (!anchor) return [missing(ctx, { check: 'maturity', title: 'When the loans come due', what: `the ${anchorName} date (the workbook has no loan start date, so the ${anchorName} date is used)`, transition, cells: [anchorCell] })]
  const flags = []
  const stable = ctx.stage === 'completed' ? null : ctx.view?.ok && ctx.view.stability.estimate.ok && ctx.view.stability.estimate.onTrack ? { idx: ctx.view.stability.estimate.month, text: `${ctx.view.stability.estimate.monthText} at the current pace` } : (() => {
    const s = timelineMonth(t.stabilization)
    return s ? { idx: s.idx, text: `${monthText(s.idx, s.approx)}, as planned` } : null
  })()
  for (const { r, i } of rows) {
    const due = anchor.idx + r.termMonths
    const name = r.name || `source ${i + 1}`
    const cells = [`sources.rows.${i}.termMonths`, `sources.rows.${i}.amount`, anchorCell]
    const assumed = `assuming it started at ${anchorName} (${monthText(anchor.idx, anchor.approx)}); the workbook has no loan start date`
    if (ctx.stage !== 'completed') {
      if (!stable || due > stable.idx + 6) continue
      flags.push(ctx.flag({
        id: 'M3T-loan-due-before-stabilization',
        severity: due <= stable.idx ? 'high' : 'medium',
        title: due <= stable.idx ? 'A loan comes due before the property is expected to stabilize.' : 'A loan comes due within six months of the expected stabilization.',
        evidence: `"${name}" (${fmt.usd(r.amount)}, ${r.termMonths}-month term) is due around ${monthText(due)}, ${assumed}. Stabilization: ${stable.text}.`,
        cell_refs: ctx.cite(cells),
        follow_up: `Does "${name}" have extension options, what do they require, and what is the plan if the property is not stable when it comes due?`,
        transition,
      }))
    } else if (ctx.asOf && due <= ctx.asOf.idx + 24) {
      const past = due <= ctx.asOf.idx
      flags.push(ctx.flag({
        id: 'M3T-maturity-near',
        severity: past ? 'high' : due <= ctx.asOf.idx + 12 ? 'medium' : 'low',
        title: past ? 'A loan appears to have reached its maturity date already.' : 'A loan comes due soon and will need to be refinanced or repaid.',
        evidence: `"${name}" (${fmt.usd(r.amount)}, ${r.termMonths}-month term) is due around ${monthText(due)}, ${assumed}. Review date ${monthText(ctx.asOf.idx)}.`,
        cell_refs: ctx.cite(cells),
        follow_up: `When exactly does "${name}" mature, what are the refinance plans, and has a lender been approached?`,
        transition,
      }))
    }
  }
  return flags
}

// =============================================================================================
// T3: completed to refinance or sale
// =============================================================================================

function debtYieldFlags(ctx, record, id, transition, when, cells) {
  const dy = keyRatios(record, ctx.settings).find((r) => r.id === 'debtYield')
  const minDy = ctx.limits.minDebtYield
  if (!dy?.ok || dy.value >= minDy) return []
  return [ctx.flag({
    id,
    severity: dy.value < minDy * 0.75 ? 'high' : 'medium',
    title: `The debt yield ${when} is below what a lender typically requires.`,
    evidence: `Debt yield ${fmt.pct(dy.value)} (${(dy.detail ?? []).join('; ')}) against a typical minimum of ${fmt.pct(minDy, 0)}.`,
    cell_refs: ctx.cite(cells),
    follow_up: 'A lender sizing on debt yield would lend less. How much would the refinance or takeout loan be, and how would the difference be paid down?',
    transition,
  })]
}

// What the refinance tests start from: the T-12 actuals when there is a usable T-12 (as M4 does), otherwise the projection.
export function refinanceBasis(ctx) {
  const t = t12Basis(ctx.project, ctx.settings)
  return t.ok ? { record: t.record, from: `the T-12 actuals (${plural(t.months, 'month')}, annualized)`, actuals: true } : { record: ctx.project, from: "the applicant's projection (no usable T-12)", actuals: false, reason: t.reason }
}

export function checkRefinance(ctx) {
  const basis = refinanceBasis(ctx)
  const shock = stressRate('completed')
  const { record: stressed, notes: leverNotes } = applyLevers(basis.record, { takeoutRate: shock })
  const after = dscr(stressed)
  const cells = [...loanPaths(ctx.project), ...(basis.actuals ? t12Paths(ctx.project, ['residentialRevenue', 'vacancyLoss'], 12) : ['residentialIncome.stabilizedVacancy'])]
  if (!after.ok) return [missing(ctx, { check: 'refinance', title: 'The refinance tests', what: after.reason, transition: 'T3', cells })]
  const flags = []
  const min = ctx.settings.minDscr
  if (after.value < min) {
    flags.push(ctx.flag({
      id: 'M3T-refinance-rate',
      severity: after.value < 1 ? 'high' : 'medium',
      title: 'At today’s higher rates, a refinance would miss the lender’s coverage test.',
      evidence: `DSCR ${fmt.times(after.value)} if the new loan costs ${(shock * 100).toFixed(2)} points more, against a minimum of ${fmt.times(min)}. Starting from ${basis.from}.${leverNotes.length ? ` ${leverNotes.join(' ')}` : ''}`.slice(0, 1000),
      cell_refs: ctx.cite(cells),
      follow_up: 'What rate has the sponsor been quoted for the refinance, and how much would have to be paid down to meet the coverage test?',
      transition: 'T3',
    }))
  }
  flags.push(...debtYieldFlags(ctx, basis.record, 'M3T-refinance-debt-yield', 'T3', 'at refinance', cells))

  const n = noi(basis.record)
  const debt = totalDebt(ctx.project)
  const cap = stressCapRate()
  if (n.ok && debt.ok && n.value > 0) {
    const value = n.value / cap
    const ltv = debt.value / value
    if (ltv > ctx.limits.maxLoanToValue) {
      flags.push(ctx.flag({
        id: 'M3T-refinance-value',
        severity: ltv > 1 ? 'high' : 'medium',
        title: ltv > 1 ? 'At a higher cap rate the property would be worth less than its loans.' : 'At a higher cap rate the loan would be too large for a refinance.',
        evidence: `NOI ${fmt.usd(n.value)} at a ${fmt.pct(cap, 2)} cap rate gives a value of ${fmt.usd(value)}; debt ${fmt.usd(debt.value)} is ${fmt.pct(ltv, 0)} of that, against a typical maximum of ${fmt.pct(ctx.limits.maxLoanToValue, 0)}. Starting from ${basis.from}.`,
        cell_refs: ctx.cite(cells),
        follow_up: 'What value does the latest appraisal or broker opinion give, at what cap rate, and how would a loan-to-value shortfall be covered at refinance or sale?',
        transition: 'T3',
      }))
    }
  }
  return flags
}
