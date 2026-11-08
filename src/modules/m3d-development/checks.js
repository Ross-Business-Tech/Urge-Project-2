// M3D: development risk (layer 3). "What can go wrong while this project is being built?"
//
// Four groups of checks, each returning checklist rows:
//
//   { id, title, group, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, cells, flags }
//
//   budget      contingency size, soft-cost share of hard cost
//   schedule    dates in a sensible order, believable construction and lease-up length, completion date not already past
//   capital     DSCR against the lender minimum, debt-to-cost, debt yield (takeout), lien order, interest reserve
//   team        general contractor, architect and a development partner are named
//
// The thresholds below that are not a benchmark or a setting are MADE-UP defaults for building and testing, like the
// benchmark sets in M0. They sit together here so they are easy to change.
//
// Cost per square foot is already compared with the market by M2, so M3D does not repeat it.

import {
  projectSchema,
  dscr,
  totalDebt,
  totalDevelopmentCost,
  noi,
  loadBenchmarks,
  contingencyBenchmark,
  missingDataFlag,
  flagFromUnavailable,
  citeCells,
  isValidDate,
  fmt,
  DEBT_SOURCE_TYPES,
  DEFAULT_SETTINGS,
} from '../shared/index.js'

export const LIMITS = {
  softToHardRange: { low: 0.1, high: 0.4 }, // soft costs as a share of hard costs
  softToHardFar: { low: 0.05, high: 0.6 }, // outside this the ratio is medium, not low
  constructionMonths: { low: 6, high: 36 },
  leaseUpMonths: { low: 3, high: 24 },
  debtToCost: { medium: 0.75, high: 0.85 },
  debtYieldMin: { medium: 0.08, high: 0.07 }, // below 8% is medium, below 7% is high
  averageDrawn: 0.55, // average share of the loan outstanding while building, for the interest estimate
  interestReserve: { medium: 0.8, high: 0.5 }, // budgeted interest as a share of the estimate
  slippedMonthsHigh: 6, // a development project this many months past its completion date is high
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const usd = (n) => fmt.usd(n)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const named = (v) => typeof v === 'string' && v.trim() !== ''

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const SOFT_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Soft costs')).map((r) => r.key)
const HARD_CONTINGENCY = ['constructionContingency', 'ownersContingency']
const amountPath = (key) => `budget.lines.${key}.amount`
const amountOf = (record, key) => {
  const v = record.data.budget.lines[key]?.amount
  return isNum(v) && v >= 0 ? v : null
}
const sumOf = (record, keys) => keys.reduce((t, k) => t + (amountOf(record, k) ?? 0), 0)
const anyEntered = (record, keys) => keys.some((k) => amountOf(record, k) !== null)

function row(id, group, title, status, detail, extra = {}) {
  return { id, group, title, status, detail, cells: extra.cells ?? [], flags: extra.flags ?? [] }
}

// A check that could not run: one low-severity "could not be checked" flag that says what is missing.
function notChecked(ctx, id, group, title, missing, cells = []) {
  const flag = missingDataFlag({ module: 'M3D', stage_used: 'development', check: id, checkTitle: title, missing, cell_refs: cells })
  return row(id, group, title, 'not_checked', `Could not be checked: ${[].concat(missing).join('; ')}`, { cells, flags: [flag] })
}

// "2026-03" -> a month number; "2026" -> a year only. Anything else is unreadable.
export function readPeriod(text) {
  if (typeof text !== 'string') return null
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-\d{2})?)?$/.exec(text.trim())
  if (!m) return null
  const year = Number(m[1])
  return m[2] ? { year, month: year * 12 + Number(m[2]) - 1, precise: true } : { year, month: year * 12, precise: false }
}
const monthsBetween = (a, b) => b.month - a.month

// =============================================================================================
// BUDGET
// =============================================================================================

function contingency(ctx) {
  const { record, flag, stage } = ctx
  const id = 'contingency'
  const title = 'Construction contingency is large enough'
  const cells = citeCells(record, HARD_CONTINGENCY.map(amountPath))
  if (!anyEntered(record, HARD_KEYS)) return notChecked(ctx, id, 'budget', title, 'No hard costs entered in the development budget.', cells)
  const contingencyEntered = anyEntered(record, HARD_CONTINGENCY)
  if (!contingencyEntered) {
    return notChecked(ctx, id, 'budget', title, 'Neither construction contingency nor owner\'s contingency is filled in. Is there really none?', cells)
  }
  const amount = sumOf(record, HARD_CONTINGENCY)
  const base = sumOf(record, HARD_KEYS) - amount
  if (base <= 0) return notChecked(ctx, id, 'budget', title, 'The hard costs before contingency add up to zero.', cells)
  const loaded = loadBenchmarks(stage, ctx.benchmarkSets)
  const bench = loaded.ok ? contingencyBenchmark(loaded.set) : loaded
  if (!bench.ok) return notChecked(ctx, id, 'budget', title, bench.reason, cells)
  const { low, high } = bench.range
  const share = amount / base
  const range = `${fmt.pct(low, 0)} to ${fmt.pct(high, 0)} benchmark`
  const detail = `Contingency ${usd(amount)} on ${usd(base)} of hard cost (${fmt.pct(share)}) vs. a ${range}.`
  if (share >= low) return row(id, 'budget', title, 'pass', detail, { cells })
  const f = flag({
    id: 'M3D-contingency-low',
    severity: share < low * 0.5 ? 'high' : 'medium',
    title: 'The cushion for construction cost overruns is thin.',
    evidence: `Contingency ${usd(amount)} on ${usd(base)} of hard cost: ${fmt.pct(share)} vs. a ${range}.`,
    cell_refs: cells,
    follow_up: `Why is contingency only ${fmt.pct(share)} of hard cost? How would a ${fmt.pct(low, 0)} cost overrun (${usd(base * low)}) be paid for?`,
  })
  return row(id, 'budget', title, 'fail', detail, { cells, flags: [f] })
}

function softCostShare(ctx) {
  const { record, flag } = ctx
  const id = 'soft-cost-ratio'
  const title = 'Soft costs are in proportion to hard costs'
  if (!anyEntered(record, HARD_KEYS) || !anyEntered(record, SOFT_KEYS)) {
    return notChecked(ctx, id, 'budget', title, 'The development budget needs both hard costs and soft costs.')
  }
  const hard = sumOf(record, HARD_KEYS)
  const soft = sumOf(record, SOFT_KEYS)
  if (hard <= 0) return notChecked(ctx, id, 'budget', title, 'Hard costs add up to zero.')
  const ratio = soft / hard
  const { low, high } = LIMITS.softToHardRange
  const detail = `Soft costs ${usd(soft)} are ${fmt.pct(ratio)} of hard costs ${usd(hard)} (usual range ${fmt.pct(low, 0)} to ${fmt.pct(high, 0)}).`
  if (ratio >= low && ratio <= high) return row(id, 'budget', title, 'pass', detail)
  const far = ratio < LIMITS.softToHardFar.low || ratio > LIMITS.softToHardFar.high
  const heavy = ratio > high
  const f = flag({
    id: 'M3D-soft-cost-ratio',
    severity: far ? 'medium' : 'low',
    title: heavy ? 'Soft costs look heavy compared with construction cost.' : 'Soft costs look too light for the construction cost.',
    evidence: `Soft costs ${usd(soft)} vs. hard costs ${usd(hard)}: ${fmt.pct(ratio)} against a usual ${fmt.pct(low, 0)} to ${fmt.pct(high, 0)}.`,
    follow_up: heavy
      ? 'What is in the soft-cost lines that makes them so large? How much is paid to the developer or related parties?'
      : 'Are fees, financing costs and reserves fully budgeted, or sitting in hard costs or left out?',
  })
  return row(id, 'budget', title, 'fail', detail, { flags: [f] })
}

// =============================================================================================
// SCHEDULE
// =============================================================================================

function schedule(ctx) {
  const { record, flag } = ctx
  const t = record.data.timeline
  const cellKeys = ['constructionStart', 'constructionCompletion', 'stabilization']
  const cells = citeCells(record, cellKeys.map((k) => `timeline.${k}`))
  const start = readPeriod(t.constructionStart)
  const end = readPeriod(t.constructionCompletion)
  const stable = readPeriod(t.stabilization)
  const missing = [
    !start && 'construction start date',
    !end && 'construction completion date',
    !stable && 'stabilization date',
  ].filter(Boolean)
  const rows = []

  // 1. dates in order
  const orderTitle = 'Construction and stabilization dates are in order'
  if (missing.length) {
    rows.push(notChecked(ctx, 'schedule-order', 'schedule', orderTitle, `The ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or not readable.`, cells))
  } else {
    const startAfterEnd = start.precise && end.precise ? start.month >= end.month : start.year > end.year
    const endAfterStable = end.precise && stable.precise ? end.month > stable.month : end.year > stable.year
    const detail = `Start ${t.constructionStart}, completion ${t.constructionCompletion}, stabilization ${t.stabilization}.`
    if (!startAfterEnd && !endAfterStable) rows.push(row('schedule-order', 'schedule', orderTitle, 'pass', detail, { cells }))
    else {
      const f = flag({
        id: 'M3D-schedule-order',
        severity: 'high',
        title: 'The project dates do not make sense in order.',
        evidence: `${detail} ${startAfterEnd ? 'Construction does not finish after it starts.' : 'Construction finishes after the project is said to be stable.'}`,
        cell_refs: cells,
        follow_up: 'Please confirm the construction start, completion and stabilization dates and send a corrected schedule.',
      })
      rows.push(row('schedule-order', 'schedule', orderTitle, 'fail', detail, { cells, flags: [f] }))
    }
  }

  // 2. construction length
  const buildTitle = 'Construction length is believable'
  if (!start?.precise || !end?.precise) {
    rows.push(row('construction-length', 'schedule', buildTitle, 'not_applicable', 'Needs the construction start and completion as year and month (such as 2026-03). The workbook may give only years.', { cells }))
  } else {
    const n = monthsBetween(start, end)
    const { low, high } = LIMITS.constructionMonths
    const detail = `Construction takes ${plural(n, 'month')} (believable range ${low} to ${high} months).`
    if (n <= 0 || (n >= low && n <= high)) {
      rows.push(row('construction-length', 'schedule', buildTitle, n <= 0 ? 'not_applicable' : 'pass', n <= 0 ? 'See the date order check.' : detail, { cells }))
    } else {
      const f = flag({
        id: 'M3D-construction-length',
        severity: 'medium',
        title: n < low ? 'The construction schedule is very short.' : 'The construction schedule is very long.',
        evidence: detail,
        cell_refs: cells,
        follow_up: n < low ? 'What supports finishing construction this quickly? Does the contractor agree to this schedule?' : 'Why does construction take this long, and how are the extra interest and carrying costs covered?',
      })
      rows.push(row('construction-length', 'schedule', buildTitle, 'fail', detail, { cells, flags: [f] }))
    }
  }

  // 3. lease-up length
  const leaseTitle = 'Lease-up length is believable'
  if (!end?.precise || !stable?.precise) {
    rows.push(row('leaseup-length', 'schedule', leaseTitle, 'not_applicable', 'Needs the completion and stabilization dates as year and month (such as 2027-06).', { cells }))
  } else {
    const n = monthsBetween(end, stable)
    const { low, high } = LIMITS.leaseUpMonths
    const detail = `Lease-up takes ${plural(n, 'month')} from completion to stabilization (believable range ${low} to ${high} months).`
    if (n < 0 || (n >= low && n <= high)) {
      rows.push(row('leaseup-length', 'schedule', leaseTitle, n < 0 ? 'not_applicable' : 'pass', n < 0 ? 'See the date order check.' : detail, { cells }))
    } else {
      const f = flag({
        id: 'M3D-leaseup-length',
        severity: 'medium',
        title: n < low ? 'The project is expected to fill up almost immediately.' : 'The project is expected to take a long time to fill up.',
        evidence: detail,
        cell_refs: cells,
        follow_up: n < low ? 'What evidence supports leasing every unit this fast (pre-leasing, waitlists, comparable openings)?' : 'How long can the project carry its loan payments while it fills, and what pays for the extra months?',
      })
      rows.push(row('leaseup-length', 'schedule', leaseTitle, 'fail', detail, { cells, flags: [f] }))
    }
  }

  // 4. completion date already passed (development only)
  const slipTitle = 'Completion date has not already passed'
  const asOf = isValidDate(record.data.stage.asOfDate) ? readPeriod(record.data.stage.asOfDate) : null
  if (ctx.stage !== 'development') {
    rows.push(row('completion-slipped', 'schedule', slipTitle, 'not_applicable', 'Only checked while the project is still in development.'))
  } else if (!asOf || !end) {
    rows.push(notChecked(ctx, 'completion-slipped', 'schedule', slipTitle, [!asOf && 'the "as of" date', !end && 'the construction completion date'].filter(Boolean), cells))
  } else {
    const late = end.precise ? asOf.month - end.month : asOf.year * 12 - (end.year * 12 + 11)
    const detail = late > 0 ? `The project is still in development ${plural(late, 'month')} after its planned completion (${t.constructionCompletion}).` : `Planned completion ${t.constructionCompletion} is not before the "as of" date ${record.data.stage.asOfDate}.`
    if (late <= 0) rows.push(row('completion-slipped', 'schedule', slipTitle, 'pass', detail, { cells }))
    else {
      const f = flag({
        id: 'M3D-completion-slipped',
        severity: late > LIMITS.slippedMonthsHigh ? 'high' : 'medium',
        title: 'Construction is still going past its planned completion date.',
        evidence: detail,
        cell_refs: cells,
        follow_up: 'Why is construction late? What is the new completion date, and what does the delay add to cost and interest?',
        transition: 'T1',
      })
      rows.push(row('completion-slipped', 'schedule', slipTitle, 'fail', detail, { cells, flags: [f] }))
    }
  }
  return rows
}

// =============================================================================================
// CAPITAL STACK AND TAKEOUT
// =============================================================================================

function sourceCells(record, field) {
  return citeCells(record, record.data.sources.rows.map((_, i) => `sources.rows.${i}.${field}`))
}

function dscrCheck(ctx) {
  const { record, flag, settings } = ctx
  const id = 'dscr'
  const title = 'Income covers the loan payments (DSCR)'
  const result = dscr(record)
  const cells = sourceCells(record, 'amount')
  if (!result.ok) {
    const f = flagFromUnavailable(result, { module: 'M3D', stage_used: 'development', check: 'dscr', checkTitle: 'Debt service coverage' })
    return row(id, 'capital', title, 'not_checked', `Could not be checked: ${result.reason}`, { flags: f ? [f] : [] })
  }
  const min = settings.minDscr
  const detail = `DSCR ${fmt.times(result.value)} vs. the lender's minimum of ${fmt.times(min)}.`
  if (result.value >= min) return row(id, 'capital', title, 'pass', detail, { cells })
  const f = flag({
    id: 'M3D-dscr-under-minimum',
    severity: 'high',
    title: 'Projected income does not cover the loan payments with the cushion lenders require.',
    evidence: `DSCR ${fmt.times(result.value)} vs. a ${fmt.times(min)} minimum.`,
    cell_refs: cells,
    follow_up: `What closes the gap to ${fmt.times(min)}: more equity, a smaller loan, a lower rate or higher income? Please send a revised sources and uses.`,
    transition: 'T3',
  })
  return row(id, 'capital', title, 'fail', detail, { cells, flags: [f] })
}

function debtToCostCheck(ctx) {
  const { record, flag } = ctx
  const id = 'debt-to-cost'
  const title = 'Borrowing is a safe share of cost'
  const debt = totalDebt(record)
  const cost = totalDevelopmentCost(record)
  const cells = sourceCells(record, 'amount')
  const failure = [debt, cost].find((r) => !r.ok)
  if (failure) return notChecked(ctx, id, 'capital', title, failure.reason, cells)
  const share = debt.value / cost.value
  const detail = `Debt ${usd(debt.value)} is ${fmt.pct(share)} of the ${usd(cost.value)} project cost.`
  if (share <= LIMITS.debtToCost.medium) return row(id, 'capital', title, 'pass', detail, { cells })
  const f = flag({
    id: 'M3D-debt-to-cost-high',
    severity: share > LIMITS.debtToCost.high ? 'high' : 'medium',
    title: 'The project is funded mostly with borrowed money.',
    evidence: `Debt ${usd(debt.value)} on ${usd(cost.value)} of cost: ${fmt.pct(share)} (more than ${fmt.pct(LIMITS.debtToCost.medium, 0)} is a concern).`,
    cell_refs: cells,
    follow_up: 'How much of the sponsor\'s own cash is really in this deal, and who absorbs the loss if costs rise?',
  })
  return row(id, 'capital', title, 'fail', detail, { cells, flags: [f] })
}

function debtYieldCheck(ctx) {
  const { record, flag } = ctx
  const id = 'debt-yield'
  const title = 'Debt yield passes a refinance test'
  const n = noi(record)
  const debt = totalDebt(record)
  const failure = [n, debt].find((r) => !r.ok)
  if (failure) return notChecked(ctx, id, 'capital', title, failure.reason, sourceCells(record, 'amount'))
  const cells = sourceCells(record, 'amount')
  const value = n.value / debt.value
  const detail = `Stabilized NOI ${usd(n.value)} on ${usd(debt.value)} of debt is a ${fmt.pct(value)} debt yield (lenders often want at least ${fmt.pct(LIMITS.debtYieldMin.medium, 0)}).`
  if (value >= LIMITS.debtYieldMin.medium) return row(id, 'capital', title, 'pass', detail, { cells })
  const f = flag({
    id: 'M3D-debt-yield-low',
    severity: value < LIMITS.debtYieldMin.high ? 'high' : 'medium',
    title: 'The permanent lender may not refinance this much debt.',
    evidence: detail,
    cell_refs: cells,
    follow_up: 'What does the permanent lender require for takeout, and does this debt amount meet it?',
    transition: 'T3',
  })
  return row(id, 'capital', title, 'fail', detail, { cells, flags: [f] })
}

function lienOrder(ctx) {
  const { record, flag } = ctx
  const id = 'lien-priority'
  const title = 'Lien priority is complete and in order'
  const rows = record.data.sources.rows.map((r, i) => ({ ...r, i })).filter((r) => isNum(r.amount) && r.amount > 0)
  const cells = sourceCells(record, 'lienPriority')
  if (rows.length === 0) return notChecked(ctx, id, 'capital', title, 'No sources of money entered.')
  const blank = rows.filter((r) => !isNum(r.lienPriority))
  const seen = new Map()
  for (const r of rows.filter((x) => isNum(x.lienPriority))) seen.set(r.lienPriority, [...(seen.get(r.lienPriority) ?? []), r])
  const duplicates = [...seen.entries()].filter(([, list]) => list.length > 1)
  const mezz = rows.filter((r) => r.type === 'mezzanine_debt' && isNum(r.lienPriority))
  const senior = rows.filter((r) => r.type === 'hard_debt' && isNum(r.lienPriority))
  const mezzAhead = mezz.filter((m) => senior.some((s) => m.lienPriority < s.lienPriority))
  const name = (r) => r.name || `source ${r.i + 1}`
  const problems = []
  if (blank.length) problems.push(`no lien priority for ${blank.map(name).join(', ')}`)
  if (duplicates.length) problems.push(`the same priority used twice: ${duplicates.map(([p, list]) => `${p} (${list.map(name).join(' and ')})`).join('; ')}`)
  if (mezzAhead.length) problems.push(`mezzanine debt ranks ahead of the senior loan: ${mezzAhead.map(name).join(', ')}`)
  if (problems.length === 0) {
    const debtOnly = rows.filter((r) => DEBT_SOURCE_TYPES.includes(r.type)).length
    return row(id, 'capital', title, 'pass', `${plural(rows.length, 'source')} ranked, ${plural(debtOnly, 'loan')} in a sensible order.`, { cells })
  }
  const f = flag({
    id: 'M3D-lien-priority',
    severity: mezzAhead.length ? 'medium' : 'low',
    title: mezzAhead.length ? 'The order in which lenders are repaid looks wrong.' : 'The order in which lenders are repaid is not clear.',
    evidence: `Problems: ${problems.join('; ')}.`,
    cell_refs: cells,
    follow_up: 'Please confirm who is repaid first, second and third, and send the intercreditor terms if there is more than one lender.',
  })
  return row(id, 'capital', title, 'fail', `Problems: ${problems.join('; ')}.`, { cells, flags: [f] })
}

function interestReserve(ctx) {
  const { record, flag } = ctx
  const id = 'interest-reserve'
  const title = 'Budgeted construction interest is enough'
  const cells = citeCells(record, [amountPath('constructionInterest')])
  const start = readPeriod(record.data.timeline.constructionStart)
  const end = readPeriod(record.data.timeline.constructionCompletion)
  const budgeted = amountOf(record, 'constructionInterest')
  if (budgeted === null) return notChecked(ctx, id, 'capital', title, 'Construction interest is not filled in the development budget.', cells)
  if (!start?.precise || !end?.precise || end.month <= start.month) {
    return notChecked(ctx, id, 'capital', title, 'A construction start and completion date (year and month) are needed to estimate the interest.', cells)
  }
  const debtRows = record.data.sources.rows.filter((r) => DEBT_SOURCE_TYPES.includes(r.type) && isNum(r.amount) && r.amount > 0 && isNum(r.interestRate))
  const debt = debtRows.reduce((t, r) => t + r.amount, 0)
  if (debt <= 0) return notChecked(ctx, id, 'capital', title, 'No loan with an amount and an interest rate in the sources of money.', sourceCells(record, 'interestRate'))
  const months = end.month - start.month
  const estimate = debtRows.reduce((t, r) => t + r.amount * r.interestRate, 0) * LIMITS.averageDrawn * (months / 12)
  const share = estimate > 0 ? budgeted / estimate : 1
  const detail = `Budgeted construction interest ${usd(budgeted)} vs. an estimated ${usd(estimate)} (${usd(debt)} of loans, ${fmt.pct(LIMITS.averageDrawn, 0)} drawn on average over ${plural(months, 'month')}).`
  if (share >= LIMITS.interestReserve.medium) return row(id, 'capital', title, 'pass', detail, { cells })
  const f = flag({
    id: 'M3D-interest-reserve-short',
    severity: share < LIMITS.interestReserve.high ? 'high' : 'medium',
    title: 'The interest budgeted for the construction period may run out.',
    evidence: `${detail} That is ${fmt.pct(share, 0)} of the estimate.`,
    cell_refs: [...cells, ...sourceCells(record, 'interestRate')],
    follow_up: 'How is interest paid during construction? If the budget runs out before the first units lease, who funds the shortfall?',
    transition: 'T1',
  })
  return row(id, 'capital', title, 'fail', detail, { cells, flags: [f] })
}

// =============================================================================================
// TEAM
// =============================================================================================

// The workbook names a general contractor, an architect and development partners. It has no property manager, guarantor
// or experience fields, so those cannot be checked yet (see the notes M3D returns).
function team(ctx) {
  const { record, flag } = ctx
  const id = 'team'
  const title = 'The development team is named'
  const lines = record.data.team.lines
  const has = (key) => named(lines[key]?.firmName) || named(lines[key]?.principal)
  const roles = [
    ['generalContractor', 'general contractor', has('generalContractor')],
    ['architect', 'architect', has('architect')],
    ['development partner', 'development partner', ['devPartner1', 'devPartner2', 'devPartner3'].some(has)],
  ]
  const absent = roles.filter((r) => !r[2]).map((r) => r[1])
  const cells = citeCells(record, ['generalContractor', 'architect', 'devPartner1'].flatMap((k) => [`team.lines.${k}.firmName`]))
  if (absent.length === 0) return row(id, 'team', title, 'pass', 'A general contractor, an architect and a development partner are named.', { cells })
  const detail = `Not named: ${absent.join(', ')}.`
  const f = flag({
    id: 'M3D-team-incomplete',
    severity: 'low',
    title: 'Part of the development team is not named.',
    evidence: `${detail} (${roles.length - absent.length} of ${roles.length} roles named.)`,
    cell_refs: cells,
    follow_up: `Please name the ${absent.join(' and ')}, and describe each one's experience with projects of this size.`,
  })
  return row(id, 'team', title, 'fail', detail, { cells, flags: [f] })
}

// =============================================================================================

// The checks that run for a project. A lease-up project runs them all, as development checks, for what is still projected.
export const CHECKS = [contingency, softCostShare, schedule, dscrCheck, debtToCostCheck, debtYieldCheck, lienOrder, interestReserve, team]

export const GROUPS = [
  { id: 'budget', label: 'Budget' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'capital', label: 'Money and takeout' },
  { id: 'team', label: 'Team' },
]

export { DEFAULT_SETTINGS }
