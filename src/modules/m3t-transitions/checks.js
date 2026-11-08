// M3T: Transition checks (layer 3). "Will this project make the jump to its next stage, and will the debt still work when it does?"
//
// A project's life has three hand-offs, and they are where deals break (spec section 0):
//   T1  development -> lease-up   delivery: late or over budget, reserves running dry
//   T2  lease-up -> completed     stabilization: leasing slower than planned, concessions masking rent, loan due first
//   T3  completed -> refinance    takeout: rate or income worse than underwritten, the loan comes due, the lender's tests fail
//
// Seven checks, each tied to one stage. A project runs the checks for its OWN stage and no others: development projects get
// the T1 look, lease-up projects get the lease-up view and T2, completed projects get T3 (and the rent-vs-occupancy screen).
// Checks that belong to another stage say so instead of running. Every project also gets a "next transition" summary.
//
// Each check returns one checklist row:
//   { id, title, group, transition, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, cells, flags }
// Every flag from a transition check carries `transition`: T1, T2 or T3.
//
// Rules of thumb that are NOT in the shared sets are in THRESHOLDS. They are working assumptions for a first screen, not
// market data, and every flag that uses one says so.

import {
  keyRatios,
  ratioIdsForStage,
  noi,
  annualDebtService,
  totalDebt,
  monthlyPayment,
  loadBenchmarks,
  rentBenchmark,
  missingDataFlag,
  flagFromUnavailable,
  citeCells,
  createFlagMaker,
  fmt,
  DEBT_SOURCE_TYPES,
} from '../shared/index.js'
import { THRESHOLDS } from './thresholds.js'

export const MODULE_ID = 'M3T'

// The cutoffs live in thresholds.js (one clearly marked place to change them).
export { THRESHOLDS }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const amount = (v) => (isNum(v) && v >= 0 ? v : 0)
const usd = (n) => fmt.usd(n)
const share = (n) => `${Number((n * 100).toFixed(1))}%`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const sum = (list) => list.reduce((t, v) => t + v, 0)

// ---------------------------------------------------------------------------------------------
// Dates. A bare year counts as January and is treated as approximate.
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
const monthText = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
// The last month a date could mean: a bare year is read as its December, so only a clearly past date counts as past.
const latestIdx = (m) => (m.yearOnly ? m.idx + 11 : m.idx)

// ---------------------------------------------------------------------------------------------
// Rows and flags
// ---------------------------------------------------------------------------------------------

const row = (id, title, group, transition, status, detail, { cells = [], flags = [] } = {}) => ({ id, title, group, transition, status, detail, cells, flags })

const maker = (ctx, id, title, group, transition) => ({
  na: (why) => row(id, title, group, transition, 'not_applicable', why),
  pass: (detail, cells) => row(id, title, group, transition, 'pass', detail, { cells }),
  fail: (detail, flags, cells) => row(id, title, group, transition, 'fail', detail, { cells, flags }),
  missing: (missing, cells = []) => {
    const flag = missingDataFlag({ module: MODULE_ID, stage_used: ctx.used, check: id, checkTitle: title, missing, cell_refs: cells })
    return row(id, title, group, transition, 'not_checked', Array.isArray(missing) ? missing.join(' ') : missing, { cells, flags: [flag] })
  },
  unavailable: (result, cells = []) => {
    const flag = flagFromUnavailable(result, { module: MODULE_ID, stage_used: ctx.used, check: id, checkTitle: title })
    return row(id, title, group, transition, 'not_checked', result.reason, { cells, flags: [flag] })
  },
})

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

function t12Months(record) {
  const byMonth = new Map()
  for (const r of record.data.t12.rows) {
    const m = parseMonth(r.month)
    if (m && !m.yearOnly) byMonth.set(m.idx, { ...r, idx: m.idx })
  }
  return [...byMonth.values()].sort((a, b) => a.idx - b.idx)
}
const t12Cells = (record, key, n = 3) => citeCells(record, record.data.t12.rows.slice(0, n).map((_, i) => `t12.rows.${i}.${key}`))
const totalUnits = (record) => record.data.residentialIncome.rows.reduce((t, r) => t + amount(r.units), 0)

const debtRows = (record) =>
  record.data.sources.rows
    .map((r, i) => ({ r, i, name: r.name || `source ${i + 1}` }))
    .filter(({ r }) => DEBT_SOURCE_TYPES.includes(r.type) && isNum(r.amount) && r.amount > 0)

// Occupancy over the T-12: where it started, where it is, and how fast it moves.
function pace(ctx) {
  const known = ctx.months.filter((m) => isNum(m.occupancy) && m.occupancy >= 0 && m.occupancy <= 1)
  if (known.length < 2) return null
  const first = known[0]
  const last = known.at(-1)
  const perMonth = (last.occupancy - first.occupancy) / (last.idx - first.idx)
  return { first, last, perMonth, count: known.length, span: last.idx - first.idx }
}

// When each loan is assumed to come due: loan start (construction completion) plus its term.
function maturities(record) {
  const start = parseMonth(record.data.timeline.constructionCompletion)
  if (!start) return null
  return debtRows(record)
    .filter(({ r }) => isNum(r.termMonths) && r.termMonths > 0)
    .map((l) => ({ ...l, dueIdx: start.idx + l.r.termMonths }))
    .sort((a, b) => a.dueIdx - b.dueIdx)
}

// =============================================================================================
// T1: DEVELOPMENT -> LEASE-UP (delivery)
// =============================================================================================

function deliveryDate(ctx) {
  const { record } = ctx
  const c = maker(ctx, 'delivery-date', 'Delivery is still ahead, as planned', 'Delivery (T1)', 'T1')
  if (ctx.used !== 'development') return c.na('Delivery is only a question while a project is still being built.')
  const completion = parseMonth(record.data.timeline.constructionCompletion)
  const asOf = parseMonth(record.data.stage.asOfDate)
  const cells = citeCells(record, ['timeline.constructionCompletion'])
  if (!completion || !asOf) return c.missing(['the construction completion date and the "as of" date'], cells)
  if (latestIdx(completion) >= asOf.idx) {
    const left = completion.idx - asOf.idx
    return c.pass(`Construction is due to finish ${completion.text}${left > 0 ? `, about ${plural(left, 'month')} from the "as of" date` : ''}.`, cells)
  }
  const late = asOf.idx - latestIdx(completion)
  const f = ctx.flag({
    id: 'M3T-delivery-overdue',
    severity: 'medium',
    transition: 'T1',
    title: 'The construction completion date has passed, but the project is still marked as in development.',
    evidence: `Completion was planned for ${completion.text}, ${plural(late, 'month')} before the "as of" date (${asOf.text}). Either delivery is late, or the stage should be updated.`,
    cell_refs: cells,
    follow_up: 'Has the project been delivered? If not, what is the new completion date and what is holding it up?',
  })
  return c.fail(`Completion was planned for ${completion.text}, which is ${plural(late, 'month')} before the "as of" date.`, [f], cells)
}

function deliveryDelay(ctx) {
  const { record } = ctx
  const c = maker(ctx, 'delivery-delay', 'Reserves can carry the loans through a delivery delay', 'Delivery (T1)', 'T1')
  if (ctx.used !== 'development') return c.na('Delivery is only a question while a project is still being built.')
  const lines = ['constructionInterest', 'rentUpReserve', 'operatingReserve']
  const cells = citeCells(record, lines.map((k) => `budget.lines.${k}.amount`))
  const ds = annualDebtService(record)
  if (!ds.ok) return c.unavailable(ds, cells)
  const start = parseMonth(record.data.timeline.constructionStart)
  const completion = parseMonth(record.data.timeline.constructionCompletion)
  if (!start || !completion) return c.missing(['the construction start and completion dates'], citeCells(record, ['timeline.constructionStart', 'timeline.constructionCompletion']))
  const buildMonths = Math.max(0, completion.idx - start.idx)
  let interest = 0
  for (const { r } of debtRows(record)) if (isNum(r.interestRate) && r.interestRate >= 0 && r.interestRate <= 1) interest += r.amount * r.interestRate * THRESHOLDS.averageDrawn * (buildMonths / 12)
  const slip = (ds.value * THRESHOLDS.delayMonths) / 12
  const required = interest + slip
  const funded = sum(lines.map((k) => amount(record.data.budget.lines[k]?.amount)))
  if (required <= 0) return c.pass('There is no interest to carry through a delay.', cells)
  const coverage = funded / required
  const detail = `Reserves of ${usd(funded)} against about ${usd(required)}: interest while building about ${usd(interest)} (${plural(buildMonths, 'month')}, loans about half drawn on average) plus ${plural(THRESHOLDS.delayMonths, 'month')} of delay at full loan payments ${usd(slip)}. ${share(coverage)} covered.`
  if (coverage >= 1) return c.pass(detail, cells)
  const f = ctx.flag({
    id: 'M3T-delivery-delay-buffer',
    severity: coverage < 0.5 ? 'high' : 'medium',
    transition: 'T1',
    title: `The reserves could not carry the loans through a ${THRESHOLDS.delayMonths}-month delivery delay.`,
    evidence: `${detail} A simple estimate, not a draw schedule; the ${THRESHOLDS.delayMonths}-month delay is a working assumption.`,
    cell_refs: cells,
    follow_up: `What happens to the loan payments if delivery slips ${THRESHOLDS.delayMonths} months? Who funds the shortfall?`,
  })
  return c.fail(detail, [f], cells)
}

// =============================================================================================
// LEASE-UP VIEW, AND T2: LEASE-UP -> COMPLETED (stabilization)
// =============================================================================================

function leaseUpPace(ctx) {
  const { record, settings } = ctx
  const c = maker(ctx, 'pace', 'Leasing is on pace to stabilize on time', 'Lease-up and stabilization (T2)', 'T2')
  if (ctx.used !== 'lease_up') return c.na('The pace of leasing is only a question while a project is filling.')
  const cells = t12Cells(record, 'occupancy')
  const p = pace(ctx)
  if (!p) return c.missing(['occupancy for at least two months in the T-12'], cells)
  const floor = settings.occupancyFloor
  const units = totalUnits(record)
  const gain = p.perMonth
  const moved = `Occupancy went from ${share(p.first.occupancy)} (${monthText(p.first.idx)}) to ${share(p.last.occupancy)} (${monthText(p.last.idx)}), ${gain >= 0 ? 'up' : 'down'} ${Number((Math.abs(gain) * 100).toFixed(1))} points a month${units > 0 ? ` (about ${Number((Math.abs(gain) * units).toFixed(1))} units a month)` : ''}.`
  if (p.last.occupancy >= floor) {
    const note = `${moved} Occupancy is at the ${share(floor)} floor; stabilization now needs ${plural(settings.consecutiveMonths, 'month')} of steady results.`
    ctx.estimate = { idx: p.last.idx + settings.consecutiveMonths, text: monthText(p.last.idx + settings.consecutiveMonths) }
    return stabilizationVsPlan(ctx, c, note, cells)
  }
  if (gain <= 0) {
    const f = ctx.flag({
      id: 'M3T-occupancy-stalled',
      severity: 'high',
      transition: 'T2',
      title: 'Leasing has stalled below the occupancy needed to stabilize.',
      evidence: `${moved} At that pace it never reaches the ${share(floor)} floor.`,
      cell_refs: cells,
      follow_up: 'Why has leasing stopped, and what changes (price, marketing, concessions) will restart it?',
    })
    return c.fail(`${moved} It is below the ${share(floor)} floor and not rising.`, [f], cells)
  }
  const toFloor = Math.ceil((floor - p.last.occupancy) / gain)
  const idx = p.last.idx + toFloor + settings.consecutiveMonths
  ctx.estimate = { idx, text: monthText(idx) }
  const note = `${moved} At that pace it reaches ${share(floor)} in ${plural(toFloor, 'month')}, and after ${plural(settings.consecutiveMonths, 'month')} of steady results the estimate is ${monthText(idx)}.`
  return stabilizationVsPlan(ctx, c, note, cells)
}

function stabilizationVsPlan(ctx, c, note, cells) {
  const planned = parseMonth(ctx.record.data.timeline.stabilization)
  const plannedCells = citeCells(ctx.record, ['timeline.stabilization'])
  if (!planned) return c.missing(['the underwritten stabilization date'], plannedCells)
  const late = ctx.estimate.idx - latestIdx(planned)
  const t = THRESHOLDS.lateMonths
  const detail = `${note} Underwritten stabilization: ${planned.text}.`
  if (late < t.medium) return c.pass(detail, [...cells, ...plannedCells])
  const f = ctx.flag({
    id: 'M3T-stabilization-late',
    severity: late >= t.high ? 'high' : 'medium',
    transition: 'T2',
    title: `At the current pace the property stabilizes about ${plural(late, 'month')} later than underwritten.`,
    evidence: `${detail} That is ${plural(late, 'month')} late; the working limits are ${t.medium} months (medium) and ${t.high} (high), not market data.`,
    cell_refs: [...cells, ...plannedCells],
    follow_up: 'What is the plan to lease faster, and do the reserves and loan terms cover the extra months?',
  })
  return c.fail(detail, [f], [...cells, ...plannedCells])
}

function concessions(ctx) {
  const { record } = ctx
  const c = maker(ctx, 'concessions', 'Free rent is not hiding weak rents', 'Lease-up and stabilization (T2)', 'T2')
  if (ctx.used !== 'lease_up') return c.na('Concessions are only a question while a project is filling.')
  const cells = t12Cells(record, 'concessions')
  const recent = ctx.months.slice(-3).filter((m) => isNum(m.concessions) && amount(m.residentialRevenue) > 0)
  if (recent.length === 0) return c.missing(['concessions and residential revenue in the T-12'], cells)
  const given = sum(recent.map((m) => Math.abs(m.concessions)))
  const potential = sum(recent.map((m) => m.residentialRevenue))
  const ratio = given / potential
  const t = THRESHOLDS.concessionShare
  const detail = `Free rent and concessions were ${usd(given)} on ${usd(potential)} of rent over the last ${plural(recent.length, 'month')}: ${share(ratio)}.`
  if (ratio < t.medium) return c.pass(detail, cells)
  const f = ctx.flag({
    id: 'M3T-concessions-heavy',
    severity: ratio >= t.high ? 'high' : 'medium',
    transition: 'T2',
    title: `Concessions are ${share(ratio)} of rent, which may be masking the true rent level.`,
    evidence: `${detail} Working limits of ${share(t.medium)} (medium) and ${share(t.high)} (high), not market data. Rent after free rent is lower than the rents on the rent roll.`,
    cell_refs: cells,
    follow_up: 'What concessions are being given, for how long, and what are rents once they end?',
  })
  return c.fail(detail, [f], cells)
}

// The screen the first stability test alone would wave through: DSCR can pass while the property is half empty at a rent
// no one will pay.
function rentVsOccupancy(ctx) {
  const { record, settings } = ctx
  const c = maker(ctx, 'high-rent-low-occupancy', 'Rents are not far above market while occupancy is low', 'Lease-up and stabilization (T2)', 'T2')
  if (ctx.used === 'development') return c.na('There are no actual rents or occupancy to compare yet.')
  const cells = [...t12Cells(record, 'residentialRevenue', 2), ...t12Cells(record, 'occupancy', 2)]
  const recent = ctx.months.slice(-3)
  const occ = recent.filter((m) => isNum(m.occupancy))
  const rev = recent.filter((m) => isNum(m.residentialRevenue))
  const units = totalUnits(record)
  if (occ.length === 0 || rev.length === 0 || units <= 0) return c.missing(['occupancy, residential revenue and units'], cells)
  const bench = loadBenchmarks(ctx.used, ctx.benchmarkSets)
  if (!bench.ok) return c.missing([bench.reason], cells)

  // The market median for this unit mix. A unit with an affordability level is compared only to that level.
  let covered = 0
  let marketTotal = 0
  for (const r of record.data.residentialIncome.rows) {
    if (!isNum(r.units) || r.units <= 0) continue
    const b = rentBenchmark(bench.set, r.unitType, r.amiLevel)
    if (!b.ok) continue
    covered += r.units
    marketTotal += r.units * b.range.median
  }
  if (covered === 0) return c.missing(['a market rent benchmark for these unit types'], citeCells(record, ['residentialIncome.rows.0.unitType']))
  const market = marketTotal / covered
  const actual = sum(rev.map((m) => m.residentialRevenue)) / rev.length / units
  const premium = actual / market - 1
  const occupancy = sum(occ.map((m) => m.occupancy)) / occ.length
  const high = premium > settings.rentPremium
  const low = occupancy < settings.occupancyFloor
  const partial = covered < units ? ` The benchmark covers ${covered} of ${units} units.` : ''
  const detail = `Occupancy ${share(occupancy)} (floor ${share(settings.occupancyFloor)}); rents about ${usd(actual)} per unit vs. a market median of ${usd(market)} (${premium >= 0 ? '+' : ''}${share(premium)}; limit ${share(settings.rentPremium)} above).${partial}`
  if (!(high && low)) return c.pass(detail, cells)
  const f = ctx.flag({
    id: 'M3T-high-rent-low-occupancy',
    severity: 'high',
    transition: 'T2',
    title: 'Occupancy is low and rents are well above the market, so the units may not fill at these rents.',
    evidence: `Occupancy ${share(occupancy)} (below the ${share(settings.occupancyFloor)} floor) with rents ${share(premium)} above the market median (${usd(actual)} vs. ${usd(market)}; limit ${share(settings.rentPremium)}). The loan coverage test can still pass.${partial} The market figures are made-up sample data.`,
    cell_refs: cells,
    follow_up: 'Why are units sitting empty at these rents? Will rents come down, and what does that do to income and the loan?',
  })
  return c.fail(detail, [f], cells)
}

function stabilizationVsMaturity(ctx) {
  const { record } = ctx
  const c = maker(ctx, 'stabilization-vs-maturity', 'The debt does not come due before stabilization', 'Lease-up and stabilization (T2)', 'T2')
  if (ctx.used !== 'lease_up') return c.na('This only matters while a project is filling.')
  const cells = citeCells(record, ['timeline.constructionCompletion'])
  const due = maturities(record)
  if (due === null) return c.missing(['the construction completion date, to date the loan'], cells)
  if (due.length === 0) return c.missing(['the term of each loan'], citeCells(record, ['sources.rows.0.termMonths']))
  if (!ctx.estimate) return c.pass(`First loan due ${monthText(due[0].dueIdx)}. There is no pace estimate yet to compare it with.`, cells)
  const first = due[0]
  const detail = `Estimated stabilization ${ctx.estimate.text}; first loan "${first.name}" due about ${monthText(first.dueIdx)} (assumed to start at construction completion).`
  if (ctx.estimate.idx < first.dueIdx) return c.pass(detail, cells)
  const f = ctx.flag({
    id: 'M3T-stabilization-after-maturity',
    severity: 'high',
    transition: 'T2',
    title: 'At the current pace, a loan comes due before the property stabilizes.',
    evidence: `${detail} The loan would have to be extended or refinanced before income is proven.`,
    cell_refs: citeCells(record, [`sources.rows.${first.i}.termMonths`, 'timeline.constructionCompletion']),
    follow_up: 'Are there extension options on this loan, and on what terms? What if stabilization takes longer?',
  })
  return c.fail(detail, [f], cells)
}

// =============================================================================================
// T3: COMPLETED -> REFINANCE OR SALE (takeout)
// =============================================================================================

function refinance(ctx) {
  const { record, settings } = ctx
  const c = maker(ctx, 'refinance', 'The property would pass a refinance when the loan comes due', 'Refinance or sale (T3)', 'T3')
  if (ctx.used !== 'completed') return c.na('A refinance test is for a property that has already stabilized. Earlier stages are reviewed for delivery and stabilization first.')
  const cells = citeCells(record, ['timeline.constructionCompletion'])
  const asOf = parseMonth(record.data.stage.asOfDate)
  const due = maturities(record)
  if (due === null || !asOf) return c.missing(['the construction completion date and the "as of" date, to date the loan'], cells)
  if (due.length === 0) return c.missing(['the term of each loan'], citeCells(record, ['sources.rows.0.termMonths']))
  const first = due[0]
  const left = first.dueIdx - asOf.idx
  const when = left <= 0 ? `reached its maturity ${plural(-left, 'month')} ago` : `is due in about ${plural(left, 'month')}`
  if (left > THRESHOLDS.refinanceWindowMonths) return c.pass(`The first loan, "${first.name}", ${when}: outside the ${THRESHOLDS.refinanceWindowMonths}-month window, so no refinance test is needed yet.`, cells)

  // The test: today's debt, re-borrowed at a higher rate and re-amortized, against the income the property actually earns.
  const debt = totalDebt(record)
  if (!debt.ok) return c.unavailable(debt, cells)
  const rated = debtRows(record).filter(({ r }) => isNum(r.interestRate) && r.interestRate >= 0 && r.interestRate <= 1)
  if (rated.length === 0) return c.missing(['an interest rate on the loans'], citeCells(record, ['sources.rows.0.interestRate']))
  const current = sum(rated.map(({ r }) => r.amount * r.interestRate)) / sum(rated.map(({ r }) => r.amount))
  const newRate = Math.min(1, current + THRESHOLDS.refinanceRateShock)
  const payment = monthlyPayment(debt.value, newRate, THRESHOLDS.refinanceAmortizationMonths)
  const underwritten = noi(record)
  if (!underwritten.ok) return c.unavailable(underwritten, cells)
  const trailing = ctx.ratios.trailing
  const actual = trailing?.ok && underwritten.value > 0
  const income = actual ? underwritten.value * trailing.value : underwritten.value
  const source = actual ? 'the T-12 NOI' : 'the underwritten NOI (no usable T-12)'
  if (payment === null || payment <= 0) return c.missing(['loan terms that can be re-amortized'], cells)
  const newDscr = income / (payment * 12)
  const yieldOnDebt = income / debt.value
  const detail = `The first loan, "${first.name}", ${when}. Refinancing ${usd(debt.value)} at ${share(newRate)} (today's ${share(current)} plus ${share(THRESHOLDS.refinanceRateShock)}) over ${THRESHOLDS.refinanceAmortizationMonths / 12} years, on ${source} of ${usd(income)}: DSCR ${fmt.times(newDscr)} (minimum ${fmt.times(settings.minDscr)}), debt yield ${share(yieldOnDebt)} (minimum ${share(THRESHOLDS.debtYieldMin)}).`
  const flags = []
  const near = left <= 12
  const refCells = citeCells(record, [`sources.rows.${first.i}.termMonths`, `sources.rows.${first.i}.interestRate`, 'timeline.constructionCompletion'])
  if (newDscr < settings.minDscr) {
    flags.push(
      ctx.flag({
        id: 'M3T-refinance-dscr-short',
        severity: near || newDscr < 1 ? 'high' : 'medium',
        transition: 'T3',
        title: 'The property would not meet the lender\'s coverage test if refinanced at a higher rate.',
        evidence: `${detail} The rate rise and the re-amortization are working assumptions, not market data.`,
        cell_refs: refCells,
        follow_up: 'What rate and terms is the lender offering, and how will the loan be repaid if the property does not qualify?',
      }),
    )
  }
  if (yieldOnDebt < THRESHOLDS.debtYieldMin) {
    flags.push(
      ctx.flag({
        id: 'M3T-refinance-debt-yield-low',
        severity: 'medium',
        transition: 'T3',
        title: 'Income is small compared with the debt, so a lender may not refinance it.',
        evidence: `${detail} The minimum debt yield is a working assumption, not market data.`,
        cell_refs: refCells,
        follow_up: 'What debt yield does the new lender require, and does the property meet it?',
      }),
    )
  }
  return flags.length ? c.fail(detail, flags, refCells) : c.pass(detail, refCells)
}

// =============================================================================================
// The list, in the order they appear on screen
// =============================================================================================

export const CHECKS = [deliveryDate, deliveryDelay, leaseUpPace, concessions, rentVsOccupancy, stabilizationVsMaturity, refinance]

export function prepare(project, context = {}, settings) {
  const m = createFlagMaker(MODULE_ID, project)
  const used = m.stage
  // Matched by position, not by the id on the result: some of M0's ratios return a result with no id when an input is refused.
  const results = keyRatios(project, settings)
  const ratios = Object.fromEntries(ratioIdsForStage(used).map((id, i) => [id, results[i]]))
  return { record: project, used, stage: used, flag: m.flag, settings, firm: context.firm ?? null, benchmarkSets: context.benchmarkSets, ratios, months: t12Months(project), estimate: null }
}

// =============================================================================================
// The "next transition" summary: which hand-off is next, when, and what has to be true for it to go well
// =============================================================================================

const NEXT = {
  development: { transition: 'T1', from: 'Development', to: 'Lease-up', title: 'Delivery: construction finishes and leasing starts' },
  lease_up: { transition: 'T2', from: 'Lease-up', to: 'Completed', title: 'Stabilization: the property fills and runs steadily' },
  completed: { transition: 'T3', from: 'Completed', to: 'Refinance or sale', title: 'Takeout: the loan is refinanced or the property sold' },
}

export function nextTransition(ctx, rows) {
  const base = NEXT[ctx.used]
  const { record, settings } = ctx
  const asOf = parseMonth(record.data.stage.asOfDate)
  const mine = rows.filter((r) => r.transition === base.transition)
  const flags = mine.flatMap((r) => r.flags)
  const real = flags.filter((f) => !f.id.endsWith('-missing'))
  const status = real.some((f) => f.severity === 'high') ? 'at_risk' : real.length ? 'watch' : flags.length || mine.every((r) => r.status === 'not_checked') ? 'unknown' : 'on_track'

  let at = null
  let mustBeTrue = []
  if (ctx.used === 'development') {
    at = parseMonth(record.data.timeline.constructionCompletion)
    mustBeTrue = ['Construction finishes by the planned date and the project is delivered.', 'The reserves can carry the loan payments through any delay.', 'Leasing can start on time: permits and the certificate of occupancy are in hand.']
  } else if (ctx.used === 'lease_up') {
    const due = maturities(record)
    at = ctx.estimate ? { idx: ctx.estimate.idx, text: ctx.estimate.text } : parseMonth(record.data.timeline.stabilization)
    mustBeTrue = [
      `Occupancy reaches ${share(settings.occupancyFloor)} and holds.`,
      `Income covers the loan payments ${fmt.times(settings.minDscr)} for ${plural(settings.consecutiveMonths, 'month')} in a row.`,
      due && due.length ? `Stabilization comes before the first loan is due (about ${monthText(due[0].dueIdx)}).` : 'Stabilization comes before the first loan is due.',
    ]
  } else {
    const due = maturities(record)
    at = due && due.length ? { idx: due[0].dueIdx, text: monthText(due[0].dueIdx) } : null
    mustBeTrue = [`The property still covers a refinanced loan ${fmt.times(settings.minDscr)} at a higher rate.`, `Debt yield stays above ${share(THRESHOLDS.debtYieldMin)}.`, 'Taxes, reserves and expenses do not rise enough to cut income.']
  }
  const monthsAway = at && asOf ? at.idx - asOf.idx : null
  return { ...base, stage: ctx.used, when: at ? { text: at.text, monthsAway } : null, status, mustBeTrue, flagIds: real.map((f) => f.id) }
}
