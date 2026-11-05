import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BENCHMARK_SETS, checkBenchmarkSet, loadBenchmarks, normalizeUnitType, normalizeAmi,
  rentBenchmark, expenseBenchmark, costBenchmark, contingencyBenchmark, compareToRange,
} from '../index.js'

test('every bundled benchmark set is sound and says its numbers are made up', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    assert.deepEqual(checkBenchmarkSet(BENCHMARK_SETS[stage], stage), [], stage)
    assert.equal(BENCHMARK_SETS[stage].madeUp, true)
  }
})

test('loading by stage: one set per stage, nothing guessed when the stage is missing', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    const out = loadBenchmarks(stage)
    assert.equal(out.ok, true)
    assert.equal(out.set.stage, stage)
  }
  for (const bad of [undefined, null, '', 'stabilized', '__proto__', 'constructor']) assert.equal(loadBenchmarks(bad).ok, false, String(bad))
})

test('a loaded set is a frozen copy, so one module cannot change what another sees', () => {
  const { set } = loadBenchmarks('development')
  assert.throws(() => { set.expensePerUnitYear.median = 1 }, TypeError)
  assert.notEqual(set, BENCHMARK_SETS.development)
  assert.equal(BENCHMARK_SETS.development.expensePerUnitYear.median, 5900)
})

test('a broken set is refused with a reason, never half-used', () => {
  const sets = {
    development: { ...BENCHMARK_SETS.development, expensePerUnitYear: { low: 9000, median: 5000, high: 7000 } },
    lease_up: { ...BENCHMARK_SETS.lease_up, stage: 'completed' },
    completed: { ...BENCHMARK_SETS.completed, rents: [] },
  }
  for (const stage of ['development', 'lease_up', 'completed']) {
    const out = loadBenchmarks(stage, sets)
    assert.equal(out.ok, false, stage)
    assert.match(out.reason, /not usable/)
  }
  assert.ok(checkBenchmarkSet(null).length)
  const dup = structuredClone(BENCHMARK_SETS.development)
  dup.rents.push(dup.rents[0])
  assert.ok(checkBenchmarkSet(dup).some((p) => /repeats/.test(p)))
  const nan = structuredClone(BENCHMARK_SETS.development)
  nan.rents[0].range.high = NaN
  assert.ok(checkBenchmarkSet(nan).length)
})

test('unit types and AMI levels are read the way applicants write them', () => {
  for (const t of ['1 BR', '1-bdr', '1 Bedroom', 'One bedroom', '1BR', '1 bed 1 bath']) assert.equal(normalizeUnitType(t), '1br', t)
  for (const t of ['Studio', 'efficiency', '0 BR']) assert.equal(normalizeUnitType(t), 'studio', t)
  assert.equal(normalizeUnitType('2-bdr'), '2br')
  assert.equal(normalizeUnitType('1'), '1') // a bare number is not guessed
  assert.equal(normalizeUnitType(null), '')
  assert.equal(normalizeAmi('60%'), 60)
  assert.equal(normalizeAmi('60% AMI'), 60)
  assert.equal(normalizeAmi(0.6), 60)
  assert.equal(normalizeAmi(60), 60)
  assert.equal(normalizeAmi(''), null)
  assert.equal(normalizeAmi('Market'), null)
  assert.equal(normalizeAmi(null), null)
  for (const bad of ['sixty', -5, 0, NaN, 500, '60 percent of median']) assert.equal(normalizeAmi(bad), undefined, String(bad))
})

test('rents: market units use market comps, AMI units use only their own AMI level', () => {
  const { set } = loadBenchmarks('development')
  const market = rentBenchmark(set, '1-bdr', '')
  assert.equal(market.ok, true)
  assert.equal(market.basis, 'market')
  assert.deepEqual(market.range, { low: 1300, median: 1500, high: 1700 })
  const ami = rentBenchmark(set, '1 BR', '60%')
  assert.equal(ami.basis, '60% AMI')
  assert.ok(ami.range.median < market.range.median)
  // 70% AMI has no benchmark: it must NOT fall back to market rent.
  const none = rentBenchmark(set, '1 BR', '70%')
  assert.equal(none.ok, false)
  assert.equal(none.kind, 'no-comparable-benchmark')
  assert.match(none.reason, /70% AMI/)
  assert.equal(rentBenchmark(set, '5 BR', null).ok, false)
  assert.equal(rentBenchmark(set, '', null).ok, false)
  assert.equal(rentBenchmark(set, '1 BR', 'banana').ok, false)
})

test('rents differ by stage in the direction the spec describes', () => {
  const dev = rentBenchmark(loadBenchmarks('development').set, '2br', null).range.median
  const lease = rentBenchmark(loadBenchmarks('lease_up').set, '2br', null).range.median
  const done = rentBenchmark(loadBenchmarks('completed').set, '2br', null).range.median
  assert.ok(dev > lease && lease > done)
})

test('cost and contingency benchmarks do not apply to completed projects', () => {
  const { set } = loadBenchmarks('completed')
  assert.equal(costBenchmark(set, 'hard').ok, false)
  assert.equal(costBenchmark(set, 'hard').kind, 'not-applicable')
  assert.equal(contingencyBenchmark(set).ok, false)
  assert.equal(expenseBenchmark(set).ok, true)
  const dev = loadBenchmarks('development').set
  assert.equal(costBenchmark(dev, 'total').ok, true)
  assert.equal(costBenchmark(dev, 'constructor').ok, false)
  assert.deepEqual(contingencyBenchmark(dev).range, { low: 0.05, median: 0.075, high: 0.1 })
})

test('comparing a value to a range', () => {
  const range = { low: 100, median: 150, high: 200 }
  assert.deepEqual(compareToRange(100, range), { ok: true, position: 'within', percentFromMedian: 100 / 150 - 1 })
  assert.equal(compareToRange(99, range).position, 'below')
  assert.equal(compareToRange(201, range).position, 'above')
  assert.equal(compareToRange(300, range).percentFromMedian, 1)
  for (const bad of [NaN, Infinity, '5', null, undefined]) assert.equal(compareToRange(bad, range).ok, false, String(bad))
  assert.equal(compareToRange(5, { low: 2, median: 1, high: 3 }).ok, false)
})

test('the healthy sample project sits inside the development benchmarks (the control case)', async () => {
  const { healthyProject } = await import('../samples/baseline.js')
  const p = healthyProject()
  const { set } = loadBenchmarks('development')
  const row = p.data.residentialIncome.rows[0]
  const rent = rentBenchmark(set, row.unitType, row.amiLevel)
  assert.equal(compareToRange(row.monthlyRent, rent.range).position, 'within')
  const hard = p.data.budget.lines.constructionContingency.amount / 3500000
  // 11.4% is above the 5% to 10% range. Only a LOW contingency is a worry, so the check is that it is not below.
  assert.equal(compareToRange(hard, contingencyBenchmark(set).range).position, 'above')
  assert.notEqual(compareToRange(hard, contingencyBenchmark(set).range).position, 'below')
})
