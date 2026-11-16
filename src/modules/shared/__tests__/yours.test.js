import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readChangedAt,
  METRICS, metricOf, keyOf, checkEntry, usableEntries, problemsByEntry, toBenchmarkSets, serializeEntries, parseEntries, newEntry, checkBenchmarkSet, loadBenchmarks, rentBenchmark, expenseBenchmark, costBenchmark, contingencyBenchmark,
} from '../index.js'

const rent = (over = {}) => ({ id: 'r1', metric: 'rent', unitType: '2br', ami: '', low: 1400, high: 1800, typical: null, ...over })
const entry = (metric, low, high, over = {}) => ({ id: `${metric}-1`, metric, low, high, typical: null, ...over })

test('every metric the team can choose is described, and rents, expenses, costs and contingency use the original checks', () => {
  assert.equal(new Set(METRICS.map((m) => m.id)).size, METRICS.length)
  assert.equal(new Set(METRICS.map((m) => m.slug)).size, METRICS.length, 'slugs (used in flag ids) are unique')
  for (const m of METRICS) assert.ok(m.label && ['dollars', 'percent', 'times'].includes(m.unit) && ['set', 'ratio'].includes(m.kind), m.id)
  assert.deepEqual(METRICS.filter((m) => m.kind === 'set').map((m) => m.id), ['rent', 'expense', 'costHard', 'costSoft', 'costTotal', 'contingency'])
  for (const m of METRICS.filter((x) => x.kind === 'ratio')) assert.ok(['above', 'below'].includes(m.risky), `${m.id} says which side matters most`)
  assert.equal(metricOf('interestRate').label, 'Interest rate (average of the loans)')
  assert.equal(metricOf('nonsense'), null)
})

test('an entry needs a metric and a sensible range, and says in plain words what is wrong', () => {
  assert.deepEqual(checkEntry(entry('interestRate', 0.05, 0.065)), [])
  assert.deepEqual(checkEntry(entry('dscr', 1.2, 1.2)), [], 'a single figure is a range with low = high')
  assert.deepEqual(checkEntry({ id: 'x', metric: 'nonsense', low: 1, high: 2 }), ['Choose what to compare.'])
  assert.deepEqual(checkEntry(entry('interestRate', null, 0.065)), ['Enter both a low and a high figure.'])
  assert.deepEqual(checkEntry(entry('interestRate', 0.07, 0.05)), ['The low figure is above the high figure.'])
  assert.deepEqual(checkEntry(entry('interestRate', -0.01, 0.05)), ['Figures cannot be negative.'])
  assert.deepEqual(checkEntry(entry('interestRate', 5, 6.5)), ['A percentage cannot be above 100%.'], '6.5 typed instead of 6.5% is caught')
  assert.deepEqual(checkEntry(entry('dscr', 1.2, 3)), [], 'coverage is not a percentage')
  assert.deepEqual(checkEntry(entry('expense', 5000, 7000, { typical: 9000 })), ['The typical figure should sit between the low and the high.'])
  assert.deepEqual(checkEntry(entry('expense', 5000, 7000, { typical: 6000 })), [])
})

test('a rent benchmark needs a unit type, and an income level only if it can be read', () => {
  assert.deepEqual(checkEntry(rent()), [])
  assert.deepEqual(checkEntry(rent({ unitType: '' })), ['Enter the unit type, such as studio, 1br or 2br.'])
  assert.deepEqual(checkEntry(rent({ ami: '60' })), [])
  assert.deepEqual(checkEntry(rent({ ami: '60% AMI' })), [])
  assert.deepEqual(checkEntry(rent({ ami: 'lots' })), ['The income level could not be read. Use a percentage such as 60, or leave it blank.'])
})

test('the same benchmark twice is used once: the first wins, and the second says so', () => {
  const list = [rent({ id: 'a', low: 1400, high: 1800 }), rent({ id: 'b', low: 1, high: 2 }), rent({ id: 'c', ami: '60', low: 900, high: 1100 }), entry('dscr', 1.2, 1.5), entry('dscr', 2, 3, { id: 'dscr-2' })]
  assert.deepEqual(usableEntries(list).map((e) => e.id), ['a', 'c', 'dscr-1'])
  const problems = problemsByEntry(list)
  assert.deepEqual(Object.keys(problems).sort(), ['b', 'dscr-2'])
  assert.deepEqual(problems.b, ['This repeats an earlier benchmark, so it is not used.'])
  assert.equal(keyOf(rent({ unitType: '2 BR' })), keyOf(rent({ unitType: '2br' })), 'unit types are normalised')
  assert.notEqual(keyOf(rent({ ami: '60' })), keyOf(rent({ ami: '' })), 'the same unit type at another income level is a different benchmark')
})

test('entries that are not valid are ignored, never guessed at', () => {
  assert.deepEqual(usableEntries([entry('dscr', 2, 1), { metric: 'x' }, null, undefined, 'text', entry('debtYield', 0.07, 0.09)]).map((e) => e.metric), ['debtYield'])
  assert.deepEqual(usableEntries(null), [])
  assert.deepEqual(usableEntries(undefined), [])
})

test('the benchmark sets: one per stage, with the typical figure defaulting to the middle, and only what was entered', () => {
  const sets = toBenchmarkSets([rent({ typical: 1500 }), rent({ id: 'r2', unitType: '1br', ami: '60', low: 800, high: 1000 }), entry('expense', 5000, 7000), entry('costTotal', 150, 250), entry('contingency', 0.05, 0.1), entry('interestRate', 0.05, 0.06)])
  assert.deepEqual(Object.keys(sets), ['development', 'lease_up', 'completed'])
  const d = sets.development
  assert.equal(d.name, 'Your benchmarks')
  assert.equal(d.madeUp, false)
  assert.equal(d.custom, true)
  assert.deepEqual(d.rents, [{ unitType: '2br', amiLevel: null, range: { low: 1400, median: 1500, high: 1800 } }, { unitType: '1br', amiLevel: 60, range: { low: 800, median: 900, high: 1000 } }])
  assert.deepEqual(d.expensePerUnitYear, { low: 5000, median: 6000, high: 7000 })
  assert.deepEqual(d.costPerSqft, { hard: null, soft: null, total: { low: 150, median: 200, high: 250 } })
  assert.deepEqual(d.contingencyShare, { low: 0.05, median: 0.075, high: 0.1 })
  assert.equal(sets.completed.costPerSqft, null, 'a finished project has no cost benchmark')
  assert.equal(sets.completed.contingencyShare, null)
  assert.ok(!JSON.stringify(d).includes('interest'), 'interest rate is compared by its own code, not by the original checks')
  for (const stage of Object.keys(sets)) assert.deepEqual(checkBenchmarkSet(sets[stage], stage), [], stage)
})

test('with nothing entered the sets are empty, valid, and the lookups say "not entered" instead of comparing against anything', () => {
  const sets = toBenchmarkSets([])
  for (const stage of ['development', 'lease_up', 'completed']) {
    const loaded = loadBenchmarks(stage, sets)
    assert.equal(loaded.ok, true, stage)
    const set = loaded.set
    assert.equal(rentBenchmark(set, '2br', null).kind, 'not-entered')
    assert.equal(expenseBenchmark(set).kind, 'not-entered')
    if (stage !== 'completed') {
      assert.equal(costBenchmark(set, 'hard').kind, 'not-entered')
      assert.equal(contingencyBenchmark(set).kind, 'not-entered')
    } else {
      assert.equal(contingencyBenchmark(set).kind, 'not-applicable')
    }
  }
})

test('a rent benchmark is found by unit type and income level, and a unit is never compared with another income level', () => {
  const set = loadBenchmarks('development', toBenchmarkSets([rent({ ami: '60', low: 900, high: 1100 })])).set
  assert.equal(rentBenchmark(set, '2 BR', '60%').ok, true)
  const market = rentBenchmark(set, '2br', null)
  assert.equal(market.ok, false)
  assert.equal(market.kind, 'no-comparable-benchmark')
  assert.match(market.reason, /No market-rent benchmark/)
})

test('the built-in checks still insist on a complete set, so a broken built-in set is still refused', () => {
  const broken = { development: { stage: 'development', name: 'x', version: 1, madeUp: true, rents: [], expensePerUnitYear: null, costPerSqft: null, contingencyShare: null } }
  assert.equal(loadBenchmarks('development', broken).ok, false)
})

test('a benchmarks file saves and reopens exactly, and says what a bad file is', () => {
  const list = [rent({ typical: 1500, ami: '60' }), entry('interestRate', 0.05, 0.065), entry('dscr', 1.2, 1.5, { typical: 1.3 })]
  const text = serializeEntries(list, 'Detroit, spring')
  assert.deepEqual(parseEntries(text), { ok: true, entries: list, changedAt: null })
  assert.equal(JSON.parse(text).note, 'Detroit, spring')
  for (const [bad, why] of [['not json', /could not be read/], ['{}', /not a benchmarks file/], [JSON.stringify({ kind: 'deal-review-benchmarks', version: 9, benchmarks: [] }), /version 9/], [JSON.stringify({ kind: 'deal-review-benchmarks', version: 1 }), /no list/], [JSON.stringify({ kind: 'deal-review-benchmarks', version: 1, benchmarks: new Array(300).fill({}) }), /too many/]]) {
    const r = parseEntries(bad)
    assert.equal(r.ok, false, bad.slice(0, 30))
    assert.match(r.reason, why)
  }
})

test('a file with some bad entries is still read, so the editor can show what is wrong; the bad ones are never used', () => {
  const text = JSON.stringify({ kind: 'deal-review-benchmarks', version: 1, benchmarks: [{ id: 'a', metric: 'dscr', low: 1.2, high: 1.5 }, { id: 'b', metric: 'dscr', low: 3, high: 1 }, 'junk', null, { metric: 'interestRate', low: 'x', high: 0.06 }] })
  const r = parseEntries(text)
  assert.equal(r.ok, true)
  assert.equal(r.entries.length, 3, 'junk and null are dropped')
  assert.deepEqual(usableEntries(r.entries).map((e) => e.id), ['a'])
  assert.ok(r.entries.every((e) => e.id), 'every entry gets an id')
})

test('hostile file contents cannot add anything beyond the known fields', () => {
  const r = parseEntries(JSON.stringify({ kind: 'deal-review-benchmarks', version: 1, benchmarks: [{ id: 'a', metric: 'dscr', low: 1, high: 2, __proto__: { x: 1 }, script: '<script>', constructor: 'x' }] }))
  assert.deepEqual(Object.keys(r.entries[0]).sort(), ['high', 'id', 'low', 'metric', 'typical'])
})

test('a new entry starts blank, and a blank entry is not usable until filled in', () => {
  const e = newEntry('rent', 'n1')
  assert.deepEqual(e, { id: 'n1', metric: 'rent', unitType: '', ami: '', low: null, high: null, typical: null })
  assert.ok(checkEntry(e).length > 0)
  assert.deepEqual(usableEntries([e]), [])
})

test('the date the ranges were last changed is saved in the file and read back, in a standard form', () => {
  const list = [entry('dscr', 1.2, 1.5)]
  const text = serializeEntries(list, '', '2026-11-16T15:30:00.000Z')
  assert.equal(JSON.parse(text).changedAt, '2026-11-16T15:30:00.000Z')
  assert.deepEqual(parseEntries(text), { ok: true, entries: list, changedAt: '2026-11-16T15:30:00.000Z' })
  assert.equal(JSON.parse(serializeEntries(list, '', '2026-11-16T10:30:00+02:00')).changedAt, '2026-11-16T08:30:00.000Z', 'any valid ISO time is stored in UTC')
})

test('a missing or unreadable date is "no date", never a guess and never a crash', () => {
  const list = [entry('dscr', 1.2, 1.5)]
  assert.equal('changedAt' in JSON.parse(serializeEntries(list)), false)
  for (const bad of [undefined, null, '', 'yesterday', '2026-13-45T00:00:00Z', 20261116, {}, 'x'.repeat(100), '2026-11-16']) {
    assert.equal(readChangedAt(bad), null, String(bad))
    assert.equal('changedAt' in JSON.parse(serializeEntries(list, '', bad)), false, String(bad))
  }
  const file = JSON.stringify({ kind: 'deal-review-benchmarks', version: 1, changedAt: 'not a date', benchmarks: list })
  assert.equal(parseEntries(file).changedAt, null)
})
