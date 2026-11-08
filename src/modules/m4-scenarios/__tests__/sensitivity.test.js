import test from 'node:test'
import assert from 'node:assert/strict'
import { applyStageAndDate, dscr, DEFAULT_SETTINGS } from '../../shared/index.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { scenarios, t12Rows } from '../../shared/samples/scenarios.js'
import { applyLevers, runScenarios, runBreakEvens, runImpacts } from '../index.js'

const staged = (stage = 'completed', record = healthyProject()) => applyStageAndDate(record, { stage, asOfDate: '2026-01-15' })
const scenario = (id) => staged(scenarios.find((s) => s.id === id).stage, scenarios.find((s) => s.id === id).build().projects[0].record)
const near = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
const coverage = (out, id) => out.coverage.find((c) => c.def.id === id)
const money = (out, id) => out.money.find((m) => m.def.id === id)

// ---------------------------------------------------------------- break-even
// The healthy project: NOI 586,000, loan payments 215,838. DSCR 1.20 needs NOI of 259,006 and DSCR 1.00 needs 215,838.
test('break-even for rent, vacancy and expenses, worked by hand', () => {
  const out = runBreakEvens(staged('completed'))
  assert.equal(out.ok, true)
  // Net rent income is 774,000 (684,000 residential + 90,000 retail). NOI = 586,000 + 774,000 x.
  near(coverage(out, 'rentChange').results[0].headroom, (586000 - 259006) / 774000, 0.0005) // 42.2%
  near(coverage(out, 'rentChange').results[1].headroom, (586000 - 215838) / 774000, 0.0005) // 47.8%
  // 820,000 of rent is exposed to vacancy (720,000 residential + 100,000 retail). NOI = 586,000 - 820,000 v.
  near(coverage(out, 'vacancyChange').results[0].headroom, (586000 - 259006) / 820000, 0.0005) // 39.9 points
  // 200,000 of expenses. NOI = 586,000 - 200,000 g.
  near(coverage(out, 'expenseGrowth').results[0].headroom, (586000 - 259006) / 200000, 0.0005) // 163.5%
})

test('every break-even that is found really does land on its target when the lever is put there', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    const p = staged(stage)
    const out = runBreakEvens(p)
    for (const c of out.coverage) {
      for (const r of c.results) {
        assert.equal(r.status, 'found', `${stage} ${c.def.id}`)
        const landed = dscr(applyLevers(p, { [c.def.id]: r.at }).record).value
        near(landed, r.target, 0.0001)
      }
      assert.ok(c.results[0].headroom < c.results[1].headroom, 'it takes more to reach 1.00x than the lender minimum')
    }
  }
})

test('the levers each stage offers are the ones that get a break-even', () => {
  const ids = (stage) => {
    const out = runBreakEvens(staged(stage))
    return [...out.coverage.map((c) => c.def.id), ...out.money.map((m) => m.def.id)]
  }
  assert.deepEqual(ids('development'), ['rentChange', 'takeoutRate', 'costOverrun', 'delayMonths', 'absorptionMonths'])
  assert.deepEqual(ids('lease_up'), ['rentChange', 'vacancyChange', 'expenseGrowth', 'takeoutRate', 'delayMonths'])
  assert.deepEqual(ids('completed'), ['rentChange', 'vacancyChange', 'expenseGrowth', 'takeoutRate'])
})

test('break-even for money: how much overrun the contingency absorbs, and how long a delay the reserves carry', () => {
  const out = runBreakEvens(staged('development'))
  // Contingency 400,000 on 3,500,000 of hard cost.
  near(money(out, 'costOverrun').headroom, 400000 / 3500000, 0.0005)
  // Reserves 300,000; a month of delay is a month of loan payments, 215,838 / 12.
  near(money(out, 'delayMonths').headroom, 300000 / (215838 / 12), 0.01)
  // The same figure the screen shows as "delay the reserves can absorb".
  near(money(out, 'delayMonths').headroom, runScenarios(staged('development')).cases.base.oneTime.delayMonthsCovered, 0.001)
})

test('a lever that cannot break the loan says "holds up", with how far it was tried', () => {
  const out = runBreakEvens(staged('development'))
  // A half-full building nearly pays its own way, so months of slow filling never exhaust the reserves.
  const slow = money(out, 'absorptionMonths')
  assert.equal(slow.status, 'never')
  assert.equal(slow.limit, 120)
  assert.equal(slow.headroom, undefined)
})

test('a project already below the lender minimum says so, and still gives the way to 1.00x', () => {
  const out = runBreakEvens(scenario('s08-dscr-under-minimum'))
  const rent = coverage(out, 'rentChange')
  assert.equal(rent.results[0].status, 'already', 'base DSCR 1.09x is under 1.20x')
  assert.equal(rent.results[1].status, 'found')
  near(rent.results[1].headroom, (586000 - 535879) / 774000, 0.001) // about 6.5% of rent from 1.00x
})

test('a typed yearly payment cannot be re-rated: the answer is "no effect", never "holds up"', () => {
  const rate = coverage(runBreakEvens(scenario('s13-typed-payment-too-low')), 'takeoutRate')
  assert.deepEqual(rate.results.map((r) => r.status), ['noeffect', 'noeffect'])
  // A genuinely strong loan, by contrast, does hold up.
  const strong = coverage(runBreakEvens(staged('completed')), 'rentChange')
  assert.ok(strong.results.every((r) => r.status === 'found'))
  const sturdy = staged('completed')
  sturdy.data.sources.rows[0].amount = 300000 // a tiny loan: even a 30 point rate rise cannot break it
  assert.deepEqual(coverage(runBreakEvens(sturdy), 'takeoutRate').results.map((r) => r.status), ['never', 'never'])
})

test('one at a time marks a lever that has no effect on this project, and ranks it last', () => {
  const out = runImpacts(scenario('s13-typed-payment-too-low'))
  const rate = out.coverage.find((r) => r.def.id === 'takeoutRate')
  assert.equal(rate.noEffect, true)
  assert.equal(out.coverage.at(-1), rate)
  assert.ok(!out.coverage.find((r) => r.def.id === 'rentChange').noEffect)
})

test('break-even follows the Base sliders: if base rents are already 10% down, there is 10% less room', () => {
  const p = staged('completed')
  const fresh = coverage(runBreakEvens(p), 'rentChange').results[0]
  const moved = coverage(runBreakEvens(p, { levers: { base: { rentChange: -0.1 } } }), 'rentChange').results[0]
  near(moved.at, fresh.at, 0.0001) // the same absolute point of failure
  near(moved.headroom, fresh.headroom - 0.1, 0.0001) // reached sooner from where base now sits
  assert.equal(moved.from, undefined)
})

test('the lender minimum in the settings sets the target, and it is reported', () => {
  const out = runBreakEvens(staged('completed'), { settings: { ...DEFAULT_SETTINGS, minDscr: 1.5 } })
  assert.deepEqual(out.targets, [1.5, 1])
  near(coverage(out, 'rentChange').results[0].headroom, (586000 - 215838 * 1.5) / 774000, 0.0005)
})

test('break-even starts from the T-12 actuals for a completed project, like the cases do', () => {
  const p = staged('completed')
  p.data.t12.rows = t12Rows({ months: 12 })
  const actual = coverage(runBreakEvens(p), 'rentChange').results[0].headroom
  const projected = coverage(runBreakEvens(p, { basis: 'projection' }), 'rentChange').results[0].headroom
  assert.notEqual(actual, projected)
  const noT12 = coverage(runBreakEvens(staged('completed')), 'rentChange').results[0].headroom
  near(projected, noT12, 1e-9)
})

test('nothing is analysed for a project with no stage, or one whose own numbers are refused', () => {
  assert.equal(runBreakEvens(healthyProject()).ok, false)
  assert.equal(runImpacts(healthyProject()).ok, false)
  for (const run of [runBreakEvens, runImpacts]) {
    const bad = run(scenario('s14-rate-typed-as-whole-number'))
    assert.equal(bad.ok, false)
    assert.match(bad.reason, /cannot be stress-tested.*650%/)
    assert.deepEqual(bad.needs.map((n) => n.group), ['sources'])
  }
})

test('break-even never changes the project', () => {
  const p = staged('development')
  const before = JSON.stringify(p)
  runBreakEvens(p)
  runImpacts(p)
  assert.equal(JSON.stringify(p), before)
})

// ---------------------------------------------------------------- one lever at a time
test('one at a time: each lever alone, worst first, with the DSCR it costs (completed)', () => {
  const out = runImpacts(staged('completed'))
  assert.equal(out.ok, true)
  assert.deepEqual(out.coverage.map((r) => r.def.id), ['takeoutRate', 'rentChange', 'vacancyChange', 'expenseGrowth'])
  const by = (id) => out.coverage.find((r) => r.def.id === id)
  // Base 586,000 / 215,838 = 2.715x. Each alone, at the downside's setting:
  near(by('rentChange').dscr.to, 508600 / 215838, 0.0005) // rents -10%
  near(by('vacancyChange').dscr.to, 545000 / 215838, 0.0005) // 5 points more vacancy
  near(by('expenseGrowth').dscr.to, 566000 / 215838, 0.0005) // expenses +10%
  near(by('takeoutRate').dscr.to, 586000 / 251717, 0.0005) // loan 1.5 points dearer
  near(by('rentChange').dscr.change, 508600 / 215838 - 586000 / 215838, 0.0005)
  near(by('rentChange').cashFlow.change, -77400, 1)
  near(by('takeoutRate').cashFlow.change, -(251717 - 215838), 2)
})

test('one at a time: the worst lever is the one that costs the most, and the bars compare like with like', () => {
  const out = runImpacts(staged('completed'))
  const drops = out.coverage.map((r) => r.dscr.change)
  assert.deepEqual([...drops].sort((a, b) => a - b), drops, 'sorted from the biggest loss')
  assert.ok(drops.every((d) => d < 0))
})

test('the levers added up are compared with all of them together, because levers act on each other', () => {
  const out = runImpacts(staged('completed'))
  near(out.together.dscrChange, runScenarios(staged('completed')).cases.downside.dscr - runScenarios(staged('completed')).cases.base.dscr, 1e-9)
  near(out.together.sumOfDscrChanges, out.coverage.reduce((t, r) => t + r.dscr.change, 0), 1e-9)
  assert.notEqual(Math.round(out.together.sumOfDscrChanges * 1000), Math.round(out.together.dscrChange * 1000), 'they do not simply add up')
})

test('one at a time on a development project: coverage levers, one-time money, and value are listed apart', () => {
  const out = runImpacts(staged('development'))
  assert.deepEqual(out.coverage.map((r) => r.def.id), ['takeoutRate', 'rentChange'])
  assert.deepEqual(out.money.map((r) => r.def.id), ['costOverrun', 'delayMonths', 'absorptionMonths'])
  assert.deepEqual(out.value.map((r) => r.def.id), ['exitCapRate'])
  near(out.money[0].extraCost.change, 350000, 1) // 10% of 3,500,000
  near(out.money[1].extraCost.change, 6 * (215838 / 12), 1) // six months of loan payments at the base rate
  assert.ok(out.money[2].extraCost.change < out.money[1].extraCost.change)
  assert.equal(out.money[0].gap.change, 0, 'the contingency absorbs it, so no new money alone')
  // Value: 3,000,000 of debt against NOI 586,000 at a 7.5% cap is 38.4%, up from 33.3% at 6.5%.
  near(out.value[0].loanToValue.to, 3000000 / (586000 / 0.075), 0.0005)
  near(out.value[0].loanToValue.from, 3000000 / (586000 / 0.065), 0.0005)
})

test('a lever the downside leaves where Base has it is listed as not turned, not as zero damage', () => {
  const out = runImpacts(staged('completed'), { levers: { downside: { expenseGrowth: 0 } } })
  assert.deepEqual(out.quiet.map((d) => d.id), ['expenseGrowth'])
  assert.ok(!out.coverage.some((r) => r.def.id === 'expenseGrowth'))
})

test('moving the downside sliders changes the ranking', () => {
  const out = runImpacts(staged('completed'), { levers: { downside: { expenseGrowth: 0.4, takeoutRate: 0, rentChange: 0 } } })
  assert.equal(out.coverage[0].def.id, 'expenseGrowth') // +40% of 200,000 is 80,000 of NOI, more than 5 points of vacancy
})
