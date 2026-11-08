import test from 'node:test'
import assert from 'node:assert/strict'
import { applyStageAndDate, blankProject, dscr, noi, annualDebtService, keyRatios, makeFlag, DEFAULT_SETTINGS } from '../../shared/index.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { scenarios } from '../../shared/samples/scenarios.js'
import { run, runScenarios, leversForStage, resolveLevers, applyLevers, CASES } from '../index.js'

const staged = (stage = 'development', record = healthyProject()) => applyStageAndDate(record, { stage, asOfDate: '2026-01-15' })
const scenario = (id, stage) => staged(stage ?? scenarios.find((s) => s.id === id).stage, scenarios.find((s) => s.id === id).build().projects[0].record)
const near = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

// ---------------------------------------------------------------- the levers each stage offers
test('each stage is offered its own levers (section 2, M4 of the spec)', () => {
  const ids = (stage) => leversForStage(stage).map((l) => l.id)
  assert.deepEqual(ids('development'), ['costOverrun', 'delayMonths', 'absorptionMonths', 'rentChange', 'takeoutRate', 'exitCapRate'])
  assert.deepEqual(ids('lease_up'), ['delayMonths', 'rentChange', 'vacancyChange', 'expenseGrowth', 'takeoutRate'])
  assert.deepEqual(ids('completed'), ['rentChange', 'vacancyChange', 'expenseGrowth', 'takeoutRate'])
  assert.deepEqual(ids('nonsense'), [])
  assert.equal(leversForStage('lease_up')[0].label, 'Delay to stabilization')
  assert.equal(leversForStage('completed').find((l) => l.id === 'takeoutRate').label, 'Refinance rate')
})

test('every lever starts neutral in the base case and gives the three cases different settings', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    for (const lever of leversForStage(stage)) {
      if (lever.id !== 'exitCapRate') assert.equal(lever.values.base, 0, `${stage} ${lever.id}`)
      assert.ok(lever.values.downside !== lever.values.base || lever.values.upside !== lever.values.base)
      for (const c of CASES) assert.ok(lever.values[c.id] >= lever.min && lever.values[c.id] <= lever.max, `${stage} ${lever.id} ${c.id} is inside its slider range`)
    }
  }
})

test('lever settings that are not believable fall back to the starting value, and say so', () => {
  const { cases, problems } = resolveLevers('completed', { downside: { rentChange: 5, vacancyChange: 'lots', expenseGrowth: NaN, takeoutRate: 0.02 }, base: { rentChange: -0.05 } })
  assert.equal(cases.downside.rentChange, -0.1)
  assert.equal(cases.downside.vacancyChange, 0.05)
  assert.equal(cases.downside.expenseGrowth, 0.1)
  assert.equal(cases.downside.takeoutRate, 0.02, 'a good value is kept')
  assert.equal(cases.base.rentChange, -0.05, 'the reviewer can move the base case too')
  assert.equal(problems.length, 3)
})

// ---------------------------------------------------------------- the base case is the project as entered
test('the base case matches the shared calculators exactly, so a scenario never disagrees with the key ratios', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    const p = staged(stage)
    const { cases } = runScenarios(p)
    assert.equal(cases.base.noi, noi(p).value)
    assert.equal(cases.base.debtService, annualDebtService(p).value)
    assert.equal(cases.base.dscr, dscr(p).value)
    assert.equal(cases.base.debtYield, keyRatios(p, DEFAULT_SETTINGS).find((r) => r.id === 'debtYield').value)
    assert.equal(cases.base.cashFlow, cases.base.noi - cases.base.debtService)
    assert.equal(cases.base.yearlyShortfall, 0)
  }
})

test('running scenarios never changes the project that was passed in', () => {
  const p = staged()
  const before = JSON.stringify(p)
  runScenarios(p)
  run(p, {})
  assert.equal(JSON.stringify(p), before)
  const freeze = (o) => Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v)) || Object.freeze(o)
  assert.doesNotThrow(() => run(freeze(staged()), {}), 'it works on a record that cannot be written to')
})

// ---------------------------------------------------------------- the numbers, worked by hand
test('downside for the healthy development project: rents down 10% and the takeout loan 1.5 points dearer', () => {
  const { cases } = runScenarios(staged('development'))
  // Residential 40 x 1,500 x 12 x 0.9 x (1 - 5% vacancy) = 615,600. Retail 5,000 sq ft x 20 x 0.9 x (1 - 10%) = 81,000.
  // Parking 12,000. Expenses 200,000. NOI = 508,600.
  near(cases.downside.noi, 508600)
  // 3,000,000 at 7.5% over 360 months is 20,976.43 a month.
  near(cases.downside.debtService, 251717, 2)
  near(cases.downside.dscr, 508600 / cases.downside.debtService, 0.0001)
  near(cases.downside.debtYield, 508600 / 3000000, 0.0001)
  near(cases.downside.cashFlow, 508600 - cases.downside.debtService, 0.01)
  // Exit value = NOI / 7.5% cap rate; loan to value = 3,000,000 / value.
  near(cases.downside.exit.value, 508600 / 0.075, 1)
  near(cases.downside.exit.loanToValue, 3000000 / (508600 / 0.075), 0.0001)
})

test('upside is better than base, and base better than downside, on every measure', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    const { cases } = runScenarios(staged(stage))
    assert.ok(cases.upside.noi > cases.base.noi && cases.base.noi > cases.downside.noi, `${stage} NOI`)
    assert.ok(cases.upside.dscr > cases.base.dscr && cases.base.dscr > cases.downside.dscr, `${stage} DSCR`)
    assert.ok(cases.upside.debtService < cases.base.debtService && cases.base.debtService < cases.downside.debtService, `${stage} debt service`)
  }
})

test('completed stage: vacancy, rent, expense growth and refinance rate each move the result as expected', () => {
  const p = staged('completed')
  const only = (lever, value) => runScenarios(p, { levers: { downside: Object.fromEntries(['rentChange', 'vacancyChange', 'expenseGrowth', 'takeoutRate'].map((k) => [k, k === lever ? value : 0])) } }).cases.downside
  near(only('vacancyChange', 0.05).noi, 586000 - (720000 * 0.05 + 100000 * 0.05), 0.5) // residential and commercial vacancy both +5 points
  near(only('rentChange', -0.1).noi, 586000 - (720000 * 0.95 * 0.1 + 100000 * 0.9 * 0.1), 0.5)
  near(only('expenseGrowth', 0.1).noi, 586000 - 20000, 0.5)
  const refi = only('takeoutRate', 0.02)
  assert.equal(refi.noi, 586000, 'a rate change does not touch income')
  assert.ok(refi.debtService > annualDebtService(p).value)
})

test('vacancy can never go past 100% or below 0%', () => {
  const p = staged('completed')
  const { record } = applyLevers(p, { vacancyChange: 0.3 })
  record.data.residentialIncome.stabilizedVacancy = 0.9
  assert.equal(applyLevers(record, { vacancyChange: 0.3 }).record.data.residentialIncome.stabilizedVacancy, 1)
  assert.equal(applyLevers(p, { vacancyChange: -0.05 }).record.data.residentialIncome.stabilizedVacancy, 0)
})

// ---------------------------------------------------------------- one-time funding gap
test('a cost overrun is absorbed by the contingency first; only the excess is a funding gap', () => {
  const p = staged('development')
  const at = (overrun) => runScenarios(p, { levers: { downside: { costOverrun: overrun, delayMonths: 0, absorptionMonths: 0 } } }).cases.downside.oneTime
  // Hard cost (before contingency) 3,500,000. Contingency 400,000.
  const ten = at(0.1)
  near(ten.overrunCost, 350000)
  assert.equal(ten.gap, 0, '350,000 is inside the 400,000 contingency')
  const twenty = at(0.2)
  near(twenty.overrunCost, 700000)
  near(twenty.overrunUncovered, 300000)
  near(twenty.gap, 300000)
})

test('delay and slower absorption are paid from the rent-up and operating reserves, then become a gap', () => {
  const p = staged('development')
  const gap = (delay, absorb) => runScenarios(p, { levers: { downside: { costOverrun: 0, delayMonths: delay, absorptionMonths: absorb } } }).cases.downside.oneTime
  const monthlyLoan = annualDebtService(p).value / 12 // downside also raises the rate, so recompute below
  const six = gap(6, 0)
  assert.equal(six.reserves, 300000, 'rent-up 200,000 plus operating 100,000')
  assert.ok(six.carry > 0 && six.carry < 6 * monthlyLoan * 1.3)
  assert.equal(six.gap, 0)
  const long = gap(24, 24)
  assert.ok(long.carry > long.reserves, 'two years of delay and slow filling outlast the reserves')
  near(long.gap, long.carry - long.reserves, 0.01)
})

test('a filling building costs less per month than an empty one, and never a negative amount', () => {
  const p = staged('development')
  const carry = (kind) => runScenarios(p, { levers: { downside: { costOverrun: 0, delayMonths: kind === 'delay' ? 12 : 0, absorptionMonths: kind === 'delay' ? 0 : 12, rentChange: 0, takeoutRate: 0 } } }).cases.downside.oneTime.carry
  const empty = carry('delay')
  const filling = carry('absorb')
  near(empty, annualDebtService(p).value, 0.5) // 12 months of loan payments
  assert.ok(filling >= 0 && filling < empty)
})

test('a completed project has no one-time funding gap, and a lease-up project has no cost overrun lever', () => {
  assert.equal(runScenarios(staged('completed')).cases.downside.oneTime, null)
  const lease = runScenarios(staged('lease_up'))
  assert.ok(lease.cases.downside.oneTime.ok)
  assert.equal(lease.cases.downside.oneTime.overrunCost, 0)
  assert.ok(!('costOverrun' in lease.levers.downside))
})

test('with no contingency or reserves entered, the whole overrun and carry count as a gap, with a note', () => {
  const p = staged('development')
  for (const k of ['constructionContingency', 'ownersContingency', 'rentUpReserve', 'operatingReserve']) p.data.budget.lines[k].amount = null
  const g = runScenarios(p).cases.downside.oneTime
  assert.ok(g.gap > 0)
  assert.equal(g.gap, g.overrunCost + g.carry)
  assert.equal(g.notes.length, 2)
})

// ---------------------------------------------------------------- typed payments and odd inputs
test('a loan with a typed yearly payment keeps that payment when the rate rises, and the engine says so', () => {
  const p = staged('completed', scenario('s13-typed-payment-too-low'))
  const out = runScenarios(p)
  assert.equal(out.cases.downside.debtService, 100000)
  assert.match(out.cases.downside.notes.join(' '), /yearly payment was typed in/)
})

test('a project whose income is wiped out shows a negative cash flow and a yearly shortfall, never NaN', () => {
  const p = staged('completed')
  p.data.operatingExpenses.lines.propertyTaxes.amount = 400000 // costs more than the income
  const { cases } = runScenarios(p, { levers: { downside: { rentChange: -0.3, vacancyChange: 0.3, expenseGrowth: 0.4, takeoutRate: 0.04 } } })
  const d = cases.downside
  assert.ok(d.noi < 0 && d.cashFlow < 0 && d.yearlyShortfall > 0 && d.dscr < 0)
  for (const v of [d.noi, d.debtService, d.cashFlow, d.yearlyShortfall, d.dscr, d.debtYield]) assert.ok(Number.isFinite(v))
  assert.equal(d.yearlyShortfall, d.debtService - d.noi)
})

test('a case that cannot be worked out says why and what to fill in, and the others still run', () => {
  const p = staged('completed')
  p.data.sources.rows = []
  const out = runScenarios(p)
  assert.equal(out.ok, true)
  for (const c of CASES) {
    assert.equal(out.cases[c.id].ok, false)
    assert.match(out.cases[c.id].reason, /No sources/)
    assert.deepEqual(out.cases[c.id].needs.map((n) => n.group), ['sources'])
  }
})

test('a bad input is never "repaired" by a lever: if the project as entered is refused, every case is refused', () => {
  // The rate was typed as 6.5 instead of 6.5% (650%). Adding 1.5 points and clamping to 100% used to give a confident 0.17x.
  for (const stage of ['development', 'lease_up', 'completed']) {
    const out = runScenarios(staged(stage, scenario('s14-rate-typed-as-whole-number')))
    for (const c of CASES) {
      assert.equal(out.cases[c.id].ok, false, `${stage} ${c.id}`)
      assert.match(out.cases[c.id].reason, /cannot be stress-tested.*650%/)
      assert.deepEqual(out.cases[c.id].needs.map((n) => n.group), ['sources'])
    }
  }
  const flags = run(scenario('s14-rate-typed-as-whole-number'), {}).flags
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [['M4-scenarios-missing', 'low']])
})

test('the gate looks at the project as entered, not at where the sliders happen to be', () => {
  const p = staged('completed', scenario('s14-rate-typed-as-whole-number'))
  const out = runScenarios(p, { levers: { base: { rentChange: 0.1 } } })
  assert.ok(CASES.every((c) => !out.cases[c.id].ok))
  assert.equal(applyLevers(p, { takeoutRate: 0.015 }).record.data.sources.rows[0].interestRate, 6.5, 'the lever leaves a refused rate alone')
})

test('a vacancy typed outside 0% to 100% is left alone by the vacancy lever', () => {
  const p = staged('completed')
  p.data.residentialIncome.stabilizedVacancy = 5
  assert.equal(applyLevers(p, { vacancyChange: -0.02 }).record.data.residentialIncome.stabilizedVacancy, 5)
  assert.equal(runScenarios(p).cases.downside.ok, false)
})

test('a project with no stage is not scenario-tested, and is asked for one', () => {
  const out = runScenarios(healthyProject())
  assert.equal(out.ok, false)
  assert.match(out.reason, /stage/)
})

// ---------------------------------------------------------------- the flags
test('the healthy project raises no flag, so the module stays quiet on a clean deal', () => {
  for (const stage of ['development', 'lease_up', 'completed']) assert.deepEqual(run(staged(stage), {}).flags, [], stage)
})

test('DSCR under the minimum before any stress is a high flag, and the downside shortfall is raised too', () => {
  const { flags } = run(scenario('s08-dscr-under-minimum'), {})
  const ids = flags.map((f) => f.id)
  assert.ok(ids.includes('M4-base-dscr-below-minimum'))
  const base = flags.find((f) => f.id === 'M4-base-dscr-below-minimum')
  assert.equal(base.severity, 'high')
  assert.match(base.evidence, /Base case DSCR 1\.09× against the lender's minimum of 1\.20×/)
  const down = flags.find((f) => f.id === 'M4-downside-dscr-shortfall')
  assert.ok(down, 'the downside drops below 1.00×')
  assert.equal(down.severity, 'high')
  assert.match(down.evidence, /Short by \$/)
  assert.ok(!ids.includes('M4-downside-dscr-thin'), 'the "thin" flag would only repeat the base-case flag')
})

test('a project that passes today but not under stress gets a medium "thin coverage" flag in the downside', () => {
  const p = staged('completed')
  p.data.sources.rows[0].amount = 5500000 // a bigger loan: base DSCR 1.48
  const stress = { rentChange: -0.1, vacancyChange: 0.05, expenseGrowth: 0.1, takeoutRate: 0.01 }
  const { cases } = runScenarios(p, { levers: { downside: stress } })
  near(cases.base.dscr, 586000 / 395722, 0.005)
  near(cases.downside.dscr, 451700 / 439087, 0.005) // between 1.00× and the 1.20× minimum
  const { flags } = run(p, { scenarios: { downside: stress } })
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [['M4-downside-dscr-thin', 'medium']])
  assert.match(flags[0].evidence, /Downside DSCR 1\.03× against the lender's minimum of 1\.20× \(base case 1\.48×\)/)
})

test('the lender minimum in the settings is what the flags compare against', () => {
  const p = scenario('s01-healthy-development')
  assert.deepEqual(run(p, {}).flags, [])
  const strict = run(p, { settings: { ...DEFAULT_SETTINGS, minDscr: 2.5 } }).flags
  assert.ok(strict.some((f) => f.id === 'M4-downside-dscr-thin' && /2\.50×/.test(f.evidence)))
})

test('thin contingency turns the downside cost overrun into a funding-gap flag, with the question for the sponsor', () => {
  const p = scenario('s03-thin-contingency')
  const { flags } = run(p, {})
  const gap = flags.find((f) => f.id === 'M4-downside-funding-gap')
  assert.ok(gap, 'a 10% overrun on 3,500,000 against 40,000 of contingency is a gap')
  assert.equal(gap.layer, 4)
  assert.equal(gap.module, 'M4')
  assert.equal(gap.stage_used, 'development')
  assert.match(gap.evidence, /Funding gap \$/)
  assert.match(gap.evidence, /overrun \$350,000 against \$40,000 of contingency/)
  assert.match(gap.follow_up, /where would the extra/)
  // 310,000 on a 5,550,000 project is 5.6%: over the 5% line, so high.
  assert.equal(gap.severity, 'high')
})

test('the healthy-control scenario stays quiet for M4 (the answer key calls it a clean pass)', () => {
  assert.deepEqual(run(scenario('s01-healthy-development'), {}).flags, [])
})

test('every flag M4 raises is a valid, frozen flag that cites cells', () => {
  const p = scenario('s03-thin-contingency')
  p.sources = { 'sources.rows.0.amount': 'Development Project 1 Details!F28', 'budget.lines.constructionContingency.amount': 'Development Project 1 Budget!G40' }
  const { flags } = run(p, {})
  assert.ok(flags.length > 0)
  for (const f of flags) {
    assert.deepEqual(makeFlag(f), f)
    assert.ok(Object.isFrozen(f))
    assert.ok(f.cell_refs.length > 0 && f.cell_refs.length <= 50)
  }
  const gap = flags.find((f) => f.id === 'M4-downside-funding-gap')
  assert.ok(gap.cell_refs.includes('Development Project 1 Budget!G40'))
})

test('a project with no stage, or no data, gets a low "could not be checked" flag instead of a crash', () => {
  const noStage = run(healthyProject(), {})
  assert.equal(noStage.flags.length, 1)
  assert.equal(noStage.flags[0].severity, 'low')
  assert.equal(noStage.flags[0].id, 'M4-scenarios-missing')
  assert.match(noStage.flags[0].evidence, /stage/i)

  const blank = blankProject()
  blank.data.stage.stage = 'completed'
  const none = run(blank, {})
  assert.equal(none.flags.length, 1)
  assert.equal(none.flags[0].severity, 'low')
  assert.equal(none.flags[0].stage_used, 'completed')
})

test('the module is wrapped by the guard: garbage in gives a "check failed" flag, never an exception', () => {
  for (const bad of [null, undefined, {}, { data: null }, 42]) {
    const out = run(bad, {})
    assert.ok(Array.isArray(out.flags) && out.flags.length >= 1)
    for (const f of out.flags) assert.equal(f.module, 'M4')
  }
})

test('the notes say which stage and which lever settings each case used', () => {
  const { notes } = run(staged('completed'), {})
  assert.ok(notes.includes('Stage used: completed.'))
  assert.ok(notes.some((n) => n.startsWith('Downside: ') && /rent change -10%/.test(n)))
  assert.ok(notes.some((n) => n.startsWith('Base: no changes')))
})
