import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, compareSeverity, validateFlag, keyRatios, DEFAULT_SETTINGS } from '../../shared/index.js'
import { roundNumberProject, t12Month } from '../../shared/__tests__/helpers.js'
import {
  MODULE_ID,
  run,
  nextTransition,
  transitionTimeline,
  leaseUpView,
  occupancyTrend,
  absorptionPace,
  concessionsView,
  monthsUntilStabilization,
} from '../index.js'

const ids = (flags) => flags.map((f) => f.id)
const find = (flags, id) => flags.find((f) => f.id === id)
const atLeast = (flag, severity) => assert.ok(flag && compareSeverity(flag.severity, severity) <= 0, `${flag?.id} is ${flag?.severity}, wanted at least ${severity}`)

// Load a scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
async function load(s, stage = s.stage) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return record
}

// A lease-up project built from round numbers: underwritten NOI 586,000 (48,833 a month), loan payments 17,987 a month.
function leaseUp(rows, { stage = 'lease_up', asOf = '2026-01-15', timeline = { constructionStart: '2024-01', constructionCompletion: '2025-03', stabilization: '2026-06' } } = {}) {
  const p = roundNumberProject(stage)
  p.data.timeline = { ...timeline }
  p.data.t12.rows = rows
  return applyStageAndDate(p, { asOfDate: asOf })
}
const months = (start, n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => {
    const idx = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + i
    const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
    return t12Month(month, over(i))
  })
const dev = (edit = () => {}) => {
  const p = healthyProject()
  edit(p)
  return applyStageAndDate(p, { stage: 'development', asOfDate: '2026-01-15' })
}

// ---------------------------------------------------------------- answer key
for (const s of scenarios) {
  test(`${s.id}: M3T matches the answer key and every flag is well formed`, async () => {
    const record = await load(s)
    const { flags, notes } = run(record, {})
    assert.ok(!ids(flags).includes('M3T-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    for (const f of flags) {
      assert.deepEqual(validateFlag(f), [], f.id)
      assert.equal(f.module, MODULE_ID)
      assert.ok(['T1', 'T2', 'T3'].includes(f.transition), `${f.id} has transition ${f.transition}`)
      assert.equal(f.stage_used, s.stage)
    }
    for (const want of s.key.flags.filter((k) => k.module === 'M3T')) {
      const got = find(flags, want.id)
      if (want.must === false) assert.equal(got, undefined)
      else atLeast(got, want.severity)
    }
  })
}

test('the healthy controls raise no high or medium transition flag', async () => {
  for (const id of ['s01-healthy-development', 's10-healthy-project-failing-firm', 's12-partial-t12']) {
    const { flags } = run(await load(scenarios.find((x) => x.id === id)), {})
    assert.deepEqual(flags.filter((f) => f.severity !== 'low').map((f) => f.evidence), [], id)
  }
})

test('s09: the occupancy screen catches what the DSCR and NOI tests wave through', async () => {
  const record = await load(scenarios.find((x) => x.id === 's09-passes-dscr-low-occupancy-high-rent'))
  const flag = find(run(record, {}).flags, 'M3T-high-rent-low-occupancy')
  assert.equal(flag.severity, 'high')
  assert.equal(flag.transition, 'T2')
  assert.match(flag.evidence, /Occupancy 82%/)
  assert.match(flag.evidence, /floor 90%/)
  assert.match(flag.evidence, /DSCR 2\.71× passes/)
  assert.ok(flag.cell_refs.length > 0)
  const view = leaseUpView(record, {})
  assert.ok(view.stability.streak >= 3, 'the stability streak passes')
  assert.ok(view.rentVsMarket.premium > 0.3)
})

// ---------------------------------------------------------------- the stability streak
test('the stability streak counts back-to-back months only, and a missing month ends it', () => {
  const full = leaseUp(months('2025-06', 5))
  assert.equal(leaseUpView(full, {}).stability.streak, 5)
  assert.equal(leaseUpView(full, {}).stability.brokenBy, null)

  const rows = months('2025-06', 5).filter((r) => r.month !== '2025-08') // August is missing
  const gap = leaseUp(rows)
  const view = leaseUpView(gap, {})
  assert.equal(view.stability.streak, 2, 'only September and October count')
  assert.equal(view.stability.brokenBy, 'August 2025')
  assert.deepEqual(view.stability.gaps, ['August 2025'])
  assert.equal(view.stability.streak, keyRatios(gap, DEFAULT_SETTINGS).find((r) => r.id === 'trailing').streak, 'the same streak as the shared ratio')
  const est = monthsUntilStabilization(gap, {})
  assert.equal(est.monthsAway, 1, 'one more passing month completes 3 in a row')
  assert.equal(est.brokenBy, 'August 2025')
})

test('a failing month ends the streak, and a month entered twice counts once', () => {
  const rows = months('2025-06', 4, (i) => (i === 1 ? { vacancyLoss: 40000 } : {}))
  assert.equal(leaseUpView(leaseUp(rows), {}).stability.streak, 2)
  const twice = [...months('2025-06', 3), { ...t12Month('2025-08-31'), vacancyLoss: 3000 }]
  const v = leaseUpView(leaseUp(twice), {})
  assert.equal(v.months.length, 3)
  assert.ok(v.notes.some((n) => /more than once/.test(n)))
})

test('the stabilization estimate reads the NOI trend', () => {
  // NOI 41,500, 43,500, 45,500: rising 2,000 a month; 48,833 needed, so 2 months to reach it, then 3 in a row.
  const rising = leaseUp(months('2025-06', 3, (i) => ({ vacancyLoss: 12000 - 2000 * i })))
  const est = monthsUntilStabilization(rising, {})
  assert.equal(est.onTrack, true)
  assert.equal(est.streak, 0)
  assert.equal(est.monthsAway, 4)
  assert.equal(est.monthText, 'December 2025')

  const falling = leaseUp(months('2025-06', 3, (i) => ({ vacancyLoss: 8000 + 2000 * i })))
  const stuck = monthsUntilStabilization(falling, {})
  assert.equal(stuck.onTrack, false)
  assert.equal(stuck.monthsAway, null)

  const stable = monthsUntilStabilization(leaseUp(months('2025-06', 3)), {})
  assert.equal(stable.monthsAway, 0)

  const stricter = monthsUntilStabilization(leaseUp(months('2025-06', 3)), { settings: { consecutiveMonths: 6 } })
  assert.equal(stricter.monthsAway, 3, 'the underwriter’s setting for consecutive months is used')
})

// ---------------------------------------------------------------- lease-up view
test('the lease-up view reports occupancy trend, absorption pace and concessions', () => {
  const p = leaseUp(months('2025-07', 4, (i) => ({ occupancy: 0.6 + 0.05 * i, concessions: 1200 })))
  const occ = occupancyTrend(p, {})
  assert.equal(occ.trend, 'rising')
  assert.equal(occ.latest, 0.75)
  assert.equal(occ.belowFloor, true)
  const pace = absorptionPace(p, {})
  assert.ok(Math.abs(pace.pacePerMonth - 0.05) < 1e-9)
  assert.ok(Math.abs(pace.unitsPerMonth - 2) < 1e-9, '5 points of 40 units is 2 units a month')
  assert.equal(pace.target, 0.95)
  assert.equal(pace.monthsToTarget, 4)
  assert.equal(pace.reachText, 'February 2026')
  const c = concessionsView(p, {})
  assert.equal(c.months, 3)
  assert.ok(Math.abs(c.share - 0.02) < 1e-9)
})

// ---------------------------------------------------------------- T1 delivery
test('T1: a healthy development project passes the delivery checks', () => {
  const { flags } = run(dev(), {})
  assert.deepEqual(ids(flags), [])
})

test('T1: an interest reserve that runs dry is flagged, more seriously before delivery', () => {
  const thin = run(dev((p) => { p.data.budget.lines.operatingReserve.amount = 0; p.data.budget.lines.rentUpReserve.amount = 275000 }), {}).flags
  const mid = find(thin, 'M3T-interest-reserve-short')
  assert.equal(mid.severity, 'medium', 'lasts to delivery, not through lease-up')
  assert.equal(mid.transition, 'T1')
  assert.ok(mid.cell_refs.some((c) => c.includes('rentUpReserve')))
  const none = run(dev((p) => { p.data.budget.lines.operatingReserve.amount = null; p.data.budget.lines.rentUpReserve.amount = null }), {}).flags
  const high = find(none, 'M3T-interest-reserve-short')
  assert.equal(high.severity, 'high')
  assert.match(high.title, /No interest reserve/)
})

test('T1: a delivery date that has passed, or that comes before the start, is flagged', () => {
  const late = find(run(dev((p) => { p.data.timeline.constructionCompletion = '2025-10' }), {}).flags, 'M3T-delivery-late')
  assert.equal(late.severity, 'medium')
  assert.match(late.evidence, /October 2025/)
  const backwards = find(run(dev((p) => { p.data.timeline.constructionCompletion = '2026-01'; p.data.timeline.constructionStart = '2026-03' }), {}).flags, 'M3T-delivery-schedule-inconsistent')
  assert.equal(backwards.severity, 'high')
  const yearOnly = run(dev((p) => { p.data.timeline = { constructionStart: 2026, constructionCompletion: 2027, stabilization: 2028 } }), {}).flags
  assert.equal(find(yearOnly, 'M3T-delivery-late'), undefined, 'a year on its own is read without crashing')
})

test('T1: a contingency too small for a typical overrun is flagged', () => {
  const f = find(run(dev((p) => { p.data.budget.lines.constructionContingency.amount = 40000 }), {}).flags, 'M3T-delivery-overrun-cushion')
  assert.equal(f.severity, 'high')
  assert.equal(f.transition, 'T1')
})

// ---------------------------------------------------------------- T2 stabilization
test('T2: a lease-up on pace raises nothing; a slow or stalled one is flagged', () => {
  const onPace = leaseUp(months('2025-07', 4, (i) => ({ occupancy: 0.6 + 0.05 * i })))
  assert.equal(find(run(onPace, {}).flags, 'M3T-absorption-slow'), undefined)

  const slow = leaseUp(months('2025-07', 4, (i) => ({ occupancy: 0.6 + 0.01 * i })))
  const f = find(run(slow, {}).flags, 'M3T-absorption-slow')
  assert.equal(f.severity, 'high', '20 points at 1 a month is far past June 2026')
  assert.match(f.evidence, /after the planned stabilization \(June 2026\)/)

  const bitSlow = leaseUp(months('2025-07', 4, (i) => ({ occupancy: 0.6 + 0.04 * i })), { timeline: { stabilization: '2026-01' } })
  assert.equal(find(run(bitSlow, {}).flags, 'M3T-absorption-slow').severity, 'medium')

  const stalled = leaseUp(months('2025-07', 4, () => ({ occupancy: 0.7 })))
  assert.match(find(run(stalled, {}).flags, 'M3T-absorption-slow').title, /not rising/)
})

test('T2: concessions that hide a below-underwriting rent are flagged', () => {
  const p = leaseUp(months('2025-07', 3, () => ({ concessions: 8000 })))
  const f = find(run(p, {}).flags, 'M3T-concessions-masking-rent')
  assert.equal(f.severity, 'high')
  assert.match(f.title, /hiding/)
  assert.equal(f.transition, 'T2')
  assert.equal(find(run(leaseUp(months('2025-07', 3)), {}).flags, 'M3T-concessions-masking-rent'), undefined, '1.7% of rent is ordinary')
})

test('T2: the takeout test passes as entered and fails when the debt is too heavy', () => {
  assert.equal(find(run(leaseUp(months('2025-07', 3)), {}).flags, 'M3T-takeout-test'), undefined)
  const p = leaseUp(months('2025-07', 3))
  p.data.sources.rows[0].amount = 8000000
  p.data.sources.rows[0].interestRate = 0.08
  const flags = run(p, {}).flags
  atLeast(find(flags, 'M3T-takeout-test'), 'medium')
  atLeast(find(flags, 'M3T-takeout-debt-yield'), 'medium')
})

test('T2: reserves that run out before stabilization are flagged', () => {
  // Burning cash: effective revenue 25,333 against 14,833 of expenses and 17,987 of loan payments, NOI not rising.
  const p = leaseUp(months('2025-07', 3, () => ({ vacancyLoss: 43000, occupancy: 0.4 })))
  const f = find(run(p, {}).flags, 'M3T-reserves-run-out')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /not in sight/)
})

test('T2: a loan that comes due before stabilization is flagged', () => {
  const p = leaseUp(months('2025-07', 3, (i) => ({ occupancy: 0.6 + 0.05 * i })))
  p.data.sources.rows[0].termMonths = 24 // from construction start 2024-01: due January 2026
  p.data.sources.rows[0].paymentOverride = 180000
  const f = find(run(p, {}).flags, 'M3T-loan-due-before-stabilization')
  atLeast(f, 'medium')
  assert.match(f.evidence, /January 2026/)
})

// ---------------------------------------------------------------- T3 refinance or sale
test('T3: a completed project with sound numbers passes the refinance tests', async () => {
  const { flags } = run(await load(scenarios.find((x) => x.id === 's10-healthy-project-failing-firm')), {})
  for (const id of ['M3T-refinance-rate', 'M3T-refinance-debt-yield', 'M3T-refinance-value', 'M3T-maturity-near']) assert.equal(find(flags, id), undefined, id)
})

test('T3: a worse rate, a thin debt yield, a low value and a near maturity are each flagged', () => {
  const p = leaseUp(months('2025-01', 12), { stage: 'completed', timeline: { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' } })
  p.data.sources.rows[0].amount = 8000000
  p.data.sources.rows[0].interestRate = 0.06
  p.data.sources.rows[0].termMonths = 30 // from stabilization June 2024: due December 2026
  const flags = run(p, {}).flags
  for (const id of ['M3T-refinance-rate', 'M3T-refinance-debt-yield', 'M3T-refinance-value', 'M3T-maturity-near']) {
    const f = find(flags, id)
    assert.ok(f, `${id} expected; got ${ids(flags).join(', ')}`)
    assert.equal(f.transition, 'T3')
  }
  assert.match(find(flags, 'M3T-refinance-value').evidence, /7\.50% cap rate/)
  assert.match(find(flags, 'M3T-refinance-rate').evidence, /T-12 actuals/)
  assert.equal(find(flags, 'M3T-maturity-near').severity, 'medium')
})

test('T3: the underwriter can change the lender tests', () => {
  const p = leaseUp(months('2025-01', 12), { stage: 'completed' })
  assert.equal(find(run(p, {}).flags, 'M3T-refinance-debt-yield'), undefined)
  assert.ok(find(run(p, { transitions: { minDebtYield: 0.25 } }).flags, 'M3T-refinance-debt-yield'))
})

// ---------------------------------------------------------------- occupancy screen
test('occupancy screen: only low occupancy together with rent above market is flagged', () => {
  const rentAbove = { residentialRevenue: 78000, vacancyLoss: 14040 } // 1,950 a unit vs about 1,455 market
  const lowHigh = leaseUp(months('2025-07', 3, () => ({ ...rentAbove, occupancy: 0.82 })))
  assert.equal(find(run(lowHigh, {}).flags, 'M3T-high-rent-low-occupancy').severity, 'high')
  const lowMarket = leaseUp(months('2025-07', 3, () => ({ residentialRevenue: 58000, occupancy: 0.82 })))
  assert.equal(find(run(lowMarket, {}).flags, 'M3T-high-rent-low-occupancy'), undefined)
  const fullHigh = leaseUp(months('2025-07', 3, () => ({ ...rentAbove, occupancy: 0.95 })))
  assert.equal(find(run(fullHigh, {}).flags, 'M3T-high-rent-low-occupancy'), undefined)
  // The underwriter's own floor and premium are used.
  assert.equal(find(run(lowHigh, { settings: { occupancyFloor: 0.8 } }).flags, 'M3T-high-rent-low-occupancy'), undefined)
  assert.equal(find(run(lowHigh, { settings: { rentPremium: 0.5 } }).flags, 'M3T-high-rent-low-occupancy'), undefined)
})

test('occupancy screen: no comparable benchmark gives a low "could not be checked" flag, not a guess', () => {
  const p = leaseUp(months('2025-07', 3, () => ({ occupancy: 0.8 })))
  p.data.residentialIncome.rows[0].unitType = 'Penthouse loft'
  const f = find(run(p, {}).flags, 'M3T-occupancy-screen-missing')
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /Penthouse loft/)
})

// ---------------------------------------------------------------- next transition, for each stage
test('next transition: T1 for development, with the delivery date and its conditions', () => {
  const n = nextTransition(dev(), {})
  assert.equal(n.transition, 'T1')
  assert.equal(n.when.text, 'June 2027')
  assert.equal(n.when.monthsAway, 17)
  assert.equal(n.status, 'on_track')
  assert.ok(n.conditions.length >= 4)
  assert.ok(n.conditions.some((c) => /interest reserve/.test(c.text)))
  assert.match(n.summary, /^Next: T1, delivery, around June 2027/)
})

test('next transition: T2 for lease-up, using the estimate at the current pace', () => {
  const n = nextTransition(leaseUp(months('2025-06', 3, (i) => ({ vacancyLoss: 12000 - 2000 * i }))), {})
  assert.equal(n.transition, 'T2')
  assert.equal(n.when.text, 'December 2025')
  assert.equal(n.when.basis, 'estimate at the current pace')
  assert.ok(n.conditions.some((c) => /3 months in a row/.test(c.text) && c.status === 'concern'))

  const s09 = scenarios.find((x) => x.id === 's09-passes-dscr-low-occupancy-high-rent')
  const r = s09.build().projects[0].record
  r.data.t12.rows = s09.t12.rows
  const met = nextTransition(applyStageAndDate(r, { stage: 'lease_up', asOfDate: s09.asOf }), {})
  assert.match(met.summary, /already meets the stability test/)
  assert.equal(met.status, 'at_risk', 'occupancy is still the problem')
})

test('next transition: T3 for completed, dated by the first loan maturity', () => {
  const p = leaseUp(months('2025-01', 12), { stage: 'completed', timeline: { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' } })
  p.data.sources.rows[0].termMonths = 120
  const n = nextTransition(p, {})
  assert.equal(n.transition, 'T3')
  assert.equal(n.when.text, 'June 2034')
  assert.equal(n.status, 'on_track')
})

test('the timeline marks where the project is and which transition is next', () => {
  const t = transitionTimeline(leaseUp(months('2025-07', 3)), {})
  const state = Object.fromEntries(t.steps.map((s) => [s.id, s.state]))
  assert.deepEqual(state, { build: 'done', T1: 'done', lease: 'current', T2: 'next', operate: 'later', T3: 'later' })
  assert.equal(transitionTimeline(dev(), {}).steps.find((s) => s.id === 'T1').state, 'next')
})

// ---------------------------------------------------------------- missing data and bad input
test('missing data gives low "could not be checked" flags, never silence', () => {
  const noT12 = leaseUp([])
  const flags = run(noT12, {}).flags
  const f = find(flags, 'M3T-lease-up-view-missing')
  assert.equal(f.severity, 'low')
  assert.equal(f.transition, 'T2')
  const noDates = dev((p) => { p.data.timeline = { constructionStart: null, constructionCompletion: null, stabilization: null } })
  const d = run(noDates, {}).flags
  assert.equal(find(d, 'M3T-delivery-date-missing').severity, 'low')
  assert.equal(find(d, 'M3T-interest-reserve-missing').severity, 'low')
  const noStage = roundNumberProject('development')
  noStage.data.stage.stage = null
  assert.deepEqual(ids(run(noStage, {}).flags), ['M3T-stage-missing'])
  assert.equal(nextTransition(noStage, {}).ok, false)
})

test('bad input never crashes', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { data: null }, { data: { stage: { stage: 'lease_up' } } }]) {
    const out = run(bad, {})
    assert.ok(Array.isArray(out.flags) && out.flags.length >= 1)
    for (const f of out.flags) assert.deepEqual(validateFlag(f), [])
    assert.equal(nextTransition(bad, {}).ok, false)
    assert.equal(transitionTimeline(bad, {}).ok, false)
    assert.equal(leaseUpView(bad, {}).ok, false)
    assert.equal(monthsUntilStabilization(bad, {}).ok, false)
  }
  const weird = leaseUp([{ month: 'soon' }, { month: '2025-07', occupancy: 7, residentialRevenue: -5 }, null, t12Month('2025-08', { concessions: 'lots' })])
  const out = run(weird, { settings: 'nonsense', transitions: { minDebtYield: -1 }, benchmarks: { lease_up: { stage: 'oops' } } })
  assert.ok(!ids(out.flags).includes('M3T-check-failed'), out.notes.join(' | '))
  for (const f of out.flags) assert.deepEqual(validateFlag(f), [])
  assert.equal(leaseUpView(weird, {}).occupancy.latest, 0.95)
})

test('running the checks never changes the project', () => {
  const p = leaseUp(months('2025-07', 3))
  const before = JSON.stringify(p)
  run(p, {})
  nextTransition(p, {})
  transitionTimeline(p, {})
  assert.equal(JSON.stringify(p), before)
})
