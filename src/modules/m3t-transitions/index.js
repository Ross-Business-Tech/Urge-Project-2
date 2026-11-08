// M3T: Transition checks (layer 3). "Where can this deal break as it moves to its next stage?"
//
//   run(project, context) -> { flags, notes }      the module interface (section 1d), wrapped by the shared guard
//   nextTransition(project, context)               which of T1, T2, T3 is next, when, and what must be true for it to go well
//   transitionTimeline(project, context)           the steps from construction to refinance, with where the project is now
//   leaseUpView / occupancyTrend / absorptionPace / concessionsView / monthsUntilStabilization   the lease-up view
//
// Runs mainly for lease_up (T2), and as a look-ahead for development (T1, and the takeout side of T2) and completed (T3).
// context: { settings, benchmarks, transitions }. settings are section 1f's; benchmarks are M0's benchmark sets (the
// bundled ones are used if missing); transitions can override TRANSITION_DEFAULTS (minimum debt yield, maximum
// loan-to-value, concession look-at level). M3T never calls another module's run; it reuses M4's lever mechanics so the
// stresses match the scenario screen.

import { createFlagMaker, guardModule, citeCells, missingDataFlag, STAGE_VALUES, isValidDate } from '../shared/index.js'
import { buildView, settingsFrom } from './view.js'
import { monthIndex, monthText, timelineMonth, plural } from './dates.js'
import {
  TRANSITION_DEFAULTS,
  stressRate,
  stressCapRate,
  checkDeliveryDate,
  checkInterestReserve,
  interestReserve,
  checkOverrunCushion,
  checkAbsorption,
  checkConcessions,
  checkTakeout,
  checkRunway,
  checkOccupancyScreen,
  checkMaturity,
  checkRefinance,
} from './checks.js'

export const MODULE_ID = 'M3T'
export { TRANSITION_DEFAULTS } from './checks.js'
export { leaseUpView, occupancyTrend, absorptionPace, concessionsView, monthsUntilStabilization } from './view.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export const TRANSITION_INFO = {
  T1: { label: 'Delivery', from: 'development', to: 'lease_up', plain: 'Construction finishes and the first units lease.' },
  T2: { label: 'Stabilization', from: 'lease_up', to: 'completed', plain: 'The property fills up and its income passes the stability test.' },
  T3: { label: 'Refinance or sale', from: 'completed', to: 'refinance', plain: 'The loan is refinanced or the property is sold.' },
}
const NEXT = { development: 'T1', lease_up: 'T2', completed: 'T3' }

function limitsFrom(context) {
  const out = { ...TRANSITION_DEFAULTS }
  const given = context?.transitions
  if (given && typeof given === 'object') {
    for (const key of Object.keys(TRANSITION_DEFAULTS)) {
      const v = given[key]
      if (isNum(v) && v > 0 && v <= 2) out[key] = v
    }
  }
  return out
}

// Everything a check needs, worked out once.
export function prepare(project, context = {}) {
  const maker = createFlagMaker(MODULE_ID, project)
  const asOfDate = project.data.stage.asOfDate
  const asOfIdx = isValidDate(asOfDate) ? monthIndex(asOfDate) : null
  const settings = settingsFrom(context)
  return {
    project,
    stage: maker.stage,
    flag: maker.flag,
    cite: (paths) => citeCells(project, paths).slice(0, 50),
    settings,
    limits: limitsFrom(context),
    asOf: asOfIdx === null ? null : { idx: asOfIdx },
    view: buildView(project, context),
  }
}

// Which checks run for each stage. Each entry: [transition, check].
const PLAN = {
  development: [checkDeliveryDate, checkInterestReserve, checkOverrunCushion, checkTakeout, checkMaturity],
  lease_up: [checkAbsorption, checkConcessions, checkRunway, checkOccupancyScreen, checkTakeout, checkMaturity],
  completed: [checkRefinance, checkMaturity, checkOccupancyScreen],
}
const NEEDS_T12 = new Set([checkAbsorption, checkConcessions, checkRunway, checkOccupancyScreen])

export function runTransitionChecks(project, context = {}) {
  const stage = project?.data?.stage?.stage
  if (!STAGE_VALUES.includes(stage)) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The transition checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the transition checks did not run.'],
    }
  }
  const ctx = prepare(project, context)
  const notes = [`Stage used: ${stage}. Next transition: ${NEXT[stage]} (${TRANSITION_INFO[NEXT[stage]].label.toLowerCase()}).`]
  const flags = []
  let checks = PLAN[stage]

  // A lease-up project with no usable T-12: one "could not be checked" flag instead of one per lease-up check.
  if (stage === 'lease_up' && !ctx.view.ok) {
    flags.push(ctx.flag({
      id: 'M3T-lease-up-view-missing',
      severity: 'low',
      title: 'The lease-up pace, concessions and stabilization estimate could not be checked.',
      evidence: `Missing: ${ctx.view.reason} A lease-up project needs its monthly T-12 (occupancy, revenue, concessions, expenses).`,
      cell_refs: [],
      follow_up: 'Please upload the monthly T-12 for the months since leasing began, including occupancy and concessions.',
      transition: 'T2',
    }))
    checks = checks.filter((c) => !NEEDS_T12.has(c))
  }
  if (ctx.view.ok) {
    notes.push(...ctx.view.notes)
    if (ctx.view.concessions.ok === false && stage !== 'development') notes.push(`Concessions: ${ctx.view.concessions.reason}`)
  }
  for (const check of checks) flags.push(...check(ctx))
  notes.push(`${plural(flags.length, 'transition flag')} raised.`)
  return { flags, notes }
}

// The module as the review runs it: a crash becomes one "check failed" flag instead of stopping the review.
export const run = guardModule(MODULE_ID, runTransitionChecks)

// =============================================================================================
// Next transition and timeline
// =============================================================================================

const SEVERITY_STATUS = { high: 'concern', medium: 'watch', low: 'watch' }
const RANK = { ok: 0, ask: 0, unknown: 1, watch: 2, concern: 3 }

function conditionStatus(flags, ids) {
  const mine = flags.filter((f) => ids.some((id) => f.id === id || f.id === `${id}-missing`))
  if (!mine.length) return 'ok'
  if (mine.every((f) => f.id.endsWith('-missing'))) return 'unknown'
  return mine.reduce((worst, f) => (RANK[SEVERITY_STATUS[f.severity]] > RANK[worst] ? SEVERITY_STATUS[f.severity] : worst), 'ok')
}

function earliestMaturity(project, stage) {
  const t = project.data.timeline ?? {}
  const anchor = stage === 'completed' ? timelineMonth(t.stabilization) ?? timelineMonth(t.constructionCompletion) : timelineMonth(t.constructionStart)
  if (!anchor) return null
  const dues = (project.data.sources?.rows ?? [])
    .filter((r) => ['hard_debt', 'gov_debt', 'mezzanine_debt'].includes(r?.type) && isNum(r.amount) && r.amount > 0 && Number.isInteger(r.termMonths) && r.termMonths > 0 && r.termMonths <= 1200)
    .map((r) => anchor.idx + r.termMonths)
  return dues.length ? Math.min(...dues) : null
}

function nextTransitionFor(project, context) {
  const stage = project?.data?.stage?.stage
  if (!STAGE_VALUES.includes(stage)) return { ok: false, reason: 'Choose the project’s stage first. The stage decides which transition comes next.' }
  const ctx = prepare(project, context)
  const { flags } = runTransitionChecks(project, context)
  const id = NEXT[stage]
  const info = TRANSITION_INFO[id]
  const s = ctx.settings
  const t = project.data.timeline ?? {}
  const conditions = []
  const add = (text, ids) => conditions.push({ text, status: conditionStatus(flags, ids) })
  let when = { idx: null, text: 'Not known yet', basis: null }

  if (stage === 'development') {
    const done = timelineMonth(t.constructionCompletion)
    if (done) when = { idx: done.idx, text: monthText(done.idx, done.approx), basis: 'planned completion date' }
    add(done ? `Construction finishes on schedule (planned ${monthText(done.idx, done.approx)}).` : 'A construction completion date is set.', ['M3T-delivery-late', 'M3T-delivery-schedule-inconsistent', 'M3T-delivery-date'])
    const r = interestReserve(ctx)
    add(r.ok && r.monthsCovered !== null ? `The interest reserve carries the loan to delivery and through lease-up (it covers about ${r.monthsCovered.toFixed(1)} months of loan payments; ${plural(r.buildMonths, 'month')} of construction remain).` : 'The interest reserve carries the loan to delivery and through lease-up.', ['M3T-interest-reserve-short', 'M3T-interest-reserve'])
    add('The contingency is big enough to absorb a typical cost overrun.', ['M3T-delivery-overrun-cushion', 'M3T-overrun-cushion'])
    conditions.push({ text: 'The certificate of occupancy is issued on time so units can start leasing (confirm with the sponsor; the workbook does not say).', status: 'ask' })
    add(`The takeout loan still works if rates are ${(stressRate(stage) * 100).toFixed(2)} points higher.`, ['M3T-takeout-test', 'M3T-takeout-debt-yield', 'M3T-takeout'])
  } else if (stage === 'lease_up') {
    const v = ctx.view
    const est = v.ok ? v.stability.estimate : null
    const planned = timelineMonth(t.stabilization)
    if (est?.ok && est.onTrack && est.monthsAway === 0) when = { idx: est.month, text: est.monthText, basis: 'the T-12 already meets the stability test', met: true }
    else if (est?.ok && est.onTrack) when = { idx: est.month, text: est.monthText, basis: 'estimate at the current pace' }
    else if (planned) when = { idx: planned.idx, text: monthText(planned.idx, planned.approx), basis: est?.ok && !est.onTrack ? 'planned date (not on track at the current pace)' : 'planned stabilization date' }
    const streakNow = v.ok && v.stability.ok ? ` (now ${plural(v.stability.streak, 'month')}${v.stability.brokenBy ? `; no data for ${v.stability.brokenBy}` : ''})` : ''
    conditions.push({
      text: `${s.consecutiveMonths} months in a row with DSCR at least ${s.minDscr.toFixed(2)}× and NOI at least ${Math.round(s.noiVsUnderwritten * 100)}% of underwritten${streakNow}.`,
      status: !v.ok || !v.stability.ok ? 'unknown' : v.stability.streak >= s.consecutiveMonths ? 'ok' : v.stability.streak > 0 ? 'watch' : 'concern',
    })
    const occNow = v.ok && v.occupancy.latest !== null ? ` (now ${Math.round(v.occupancy.latest * 100)}%, ${v.occupancy.trend})` : ''
    add(`Occupancy reaches at least ${Math.round((v.ok && v.absorption.ok ? v.absorption.target : s.occupancyFloor) * 100)}%${occNow} at rents near market.`, ['M3T-absorption-slow', 'M3T-high-rent-low-occupancy', 'M3T-absorption', 'M3T-occupancy-screen', 'M3T-lease-up-view'])
    add(`Free rent burns off${v.ok && v.concessions.ok ? ` (now ${(v.concessions.share * 100).toFixed(1)}% of billed rent)` : ''}.`, ['M3T-concessions-masking-rent'])
    add('The rent-up and operating reserves last until then.', ['M3T-reserves-run-out', 'M3T-runway'])
    add(`The takeout loan still works if rates are ${(stressRate(stage) * 100).toFixed(2)} points higher, and no loan comes due first.`, ['M3T-takeout-test', 'M3T-takeout-debt-yield', 'M3T-takeout', 'M3T-loan-due-before-stabilization', 'M3T-maturity'])
  } else {
    const due = earliestMaturity(project, stage)
    if (due !== null) when = { idx: due, text: monthText(due), basis: 'first loan maturity (estimated from the loan term)' }
    add(`Coverage stays at or above ${s.minDscr.toFixed(2)}× if the new loan costs ${(stressRate(stage) * 100).toFixed(2)} points more.`, ['M3T-refinance-rate', 'M3T-refinance'])
    add(`Debt yield is at least ${Math.round(ctx.limits.minDebtYield * 100)}%.`, ['M3T-refinance-debt-yield'])
    add(`At a ${(stressCapRate() * 100).toFixed(2)}% cap rate, the property is worth enough that the loans are at most ${Math.round(ctx.limits.maxLoanToValue * 100)}% of its value.`, ['M3T-refinance-value'])
    add('No loan comes due before a refinance can be arranged.', ['M3T-maturity-near', 'M3T-maturity'])
    add('Occupancy holds above the floor at rents near market.', ['M3T-high-rent-low-occupancy', 'M3T-occupancy-screen'])
  }

  const worst = conditions.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'ok')
  const status = worst === 'concern' ? 'at_risk' : worst === 'watch' ? 'watch' : worst === 'unknown' ? 'unknown' : 'on_track'
  const monthsAway = when.idx !== null && ctx.asOf ? when.idx - ctx.asOf.idx : null
  const whenWords = when.met
    ? `now: the T-12 already meets the stability test (latest month ${when.text})`
    : when.idx === null ? 'at a date not yet known' : monthsAway === null ? `around ${when.text}` : monthsAway < 0 ? `around ${when.text} (${plural(-monthsAway, 'month')} before the review date)` : `around ${when.text} (about ${plural(monthsAway, 'month')} after the review date)`
  const statusWords = { at_risk: 'Some conditions are not met yet.', watch: 'Some conditions need watching.', unknown: 'Some conditions could not be checked.', on_track: 'The conditions checked so far are met.' }[status]
  return {
    ok: true,
    stage,
    transition: id,
    label: info.label,
    plain: info.plain,
    from: info.from,
    to: info.to,
    when: { ...when, monthsAway },
    conditions,
    status,
    summary: `Next: ${id}, ${info.label.toLowerCase()}, ${whenWords}. ${statusWords}`,
    flags: flags.filter((f) => f.transition === id || (stage !== 'completed' && f.transition === 'T2')),
  }
}

export function nextTransition(project, context) {
  try {
    if (!project?.data) return { ok: false, reason: 'There is no project to read.' }
    return nextTransitionFor(project, context)
  } catch {
    return { ok: false, reason: 'The next transition could not be worked out for this project.' }
  }
}

// The steps from construction to refinance, with their dates and where the project is now.
export function transitionTimeline(project, context) {
  try {
    const stage = project?.data?.stage?.stage
    if (!STAGE_VALUES.includes(stage)) return { ok: false, reason: 'Choose the project’s stage first.' }
    const t = project.data.timeline ?? {}
    const at = (v) => {
      const m = timelineMonth(v)
      return m ? monthText(m.idx, m.approx) : null
    }
    const next = nextTransition(project, context)
    if (!next.ok) return { ok: false, reason: next.reason }
    const order = ['build', 'T1', 'lease', 'T2', 'operate', 'T3']
    const here = { development: 'build', lease_up: 'lease', completed: 'operate' }[stage]
    const nextId = NEXT[stage]
    const stabilizeWhen = stage === 'lease_up' ? `${next.when.text} (${next.when.basis})` : at(t.stabilization)
    const steps = [
      { id: 'build', kind: 'stage', label: 'Construction', when: at(t.constructionStart) ? `from ${at(t.constructionStart)}` : null },
      { id: 'T1', kind: 'transition', label: 'T1 Delivery', when: at(t.constructionCompletion), plain: TRANSITION_INFO.T1.plain },
      { id: 'lease', kind: 'stage', label: 'Lease-up', when: null },
      { id: 'T2', kind: 'transition', label: 'T2 Stabilization', when: stabilizeWhen, plain: TRANSITION_INFO.T2.plain },
      { id: 'operate', kind: 'stage', label: 'Stable operations', when: null },
      { id: 'T3', kind: 'transition', label: 'T3 Refinance or sale', when: stage === 'completed' && next.when.idx !== null ? `${next.when.text} (${next.when.basis})` : null, plain: TRANSITION_INFO.T3.plain },
    ].map((step) => {
      const i = order.indexOf(step.id)
      const state = step.id === here ? 'current' : step.id === nextId ? 'next' : i < order.indexOf(here) ? 'done' : 'later'
      return { ...step, state }
    })
    return { ok: true, stage, steps, next }
  } catch {
    return { ok: false, reason: 'The timeline could not be drawn for this project.' }
  }
}
