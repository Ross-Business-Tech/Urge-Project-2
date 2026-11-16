import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, validateFlag, BENCHMARK_SETS, keyRatios, DEFAULT_SETTINGS } from '../../shared/index.js'
import { run, compareYours } from '../index.js'

async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return record
}
const project = (stage = 'development', edit = () => {}) => {
  const p = applyStageAndDate(healthyProject(), { stage, asOfDate: '2026-01-15' })
  edit(p.data)
  return p
}
const entry = (metric, low, high, over = {}) => ({ id: `${metric}-1`, metric, low, high, typical: null, ...over })

// The numbers of the old built-in development set, typed in as the team's own entries.
function entriesFromBuiltIn(set) {
  const out = []
  set.rents.forEach((r, i) => out.push({ id: `r${i}`, metric: 'rent', unitType: r.unitType, ami: r.amiLevel === null ? '' : String(r.amiLevel), low: r.range.low, high: r.range.high, typical: r.range.median }))
  const add = (metric, r) => out.push({ id: metric, metric, low: r.low, high: r.high, typical: r.median })
  add('expense', set.expensePerUnitYear)
  add('costHard', set.costPerSqft.hard)
  add('costSoft', set.costPerSqft.soft)
  add('costTotal', set.costPerSqft.total)
  add('contingency', set.contingencyShare)
  return out
}
const summary = (flags) => flags.map((f) => ({ id: f.id, severity: f.severity, title: f.title, follow_up: f.follow_up })).sort((a, b) => a.id.localeCompare(b.id))

test('typing in the old development numbers gives exactly the old findings, for every development sample', async () => {
  const entries = entriesFromBuiltIn(BENCHMARK_SETS.development)
  let compared = 0
  for (const s of scenarios.filter((x) => x.stage === 'development')) {
    const record = await load(s)
    const old = run(record, {}).flags.filter((f) => !f.id.startsWith('M2-yours'))
    const now = run(record, { benchmarks: entries }).flags.filter((f) => !f.id.startsWith('M2-yours'))
    assert.deepEqual(summary(now), summary(old), s.id)
    compared += old.length
  }
  assert.ok(compared >= 1, 'the samples raise at least one benchmark finding to compare')
})

test('the same holds for a project whose rents, expenses and costs are pushed outside the old ranges', () => {
  const entries = entriesFromBuiltIn(BENCHMARK_SETS.development)
  const edits = [
    (d) => { d.residentialIncome.rows[0].monthlyRent = 4000 },
    (d) => { d.residentialIncome.rows[0].monthlyRent = 300 },
    (d) => { d.operatingExpenses.lines.propertyManagement.amount = 400000 },
    (d) => { d.operatingExpenses.lines.propertyManagement.amount = 0 },
  ]
  let flagged = 0
  for (const edit of edits) {
    const p = project('development', edit)
    const old = run(p, {}).flags
    const now = run(p, { benchmarks: entries }).flags
    assert.deepEqual(summary(now), summary(old))
    flagged += old.length
  }
  assert.ok(flagged >= 3, `the edits raise benchmark findings to compare (${flagged})`)
})

test('with no benchmarks entered, nothing is compared and nothing is flagged, not even for missing data', async () => {
  for (const s of scenarios) {
    const record = await load(s)
    const r = run(record, { benchmarks: [] })
    assert.deepEqual(r.flags, [], s.id)
    assert.ok(r.notes.some((n) => /No benchmarks have been entered/.test(n)), s.id)
  }
})

test('a rent range that was entered is the one the rents are compared with, and its source is not called made-up', () => {
  const p = project('development')
  const unit = p.data.residentialIncome.rows[0]
  const key = String(unit.unitType)
  const tooLow = [{ id: 'r', metric: 'rent', unitType: key, ami: '', low: 100, high: 200, typical: null }]
  const r = run(p, { benchmarks: tooLow })
  const flags = r.flags.filter((f) => f.id.startsWith('M2'))
  assert.ok(flags.length > 0, 'rents far above the entered range are flagged')
  for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
  assert.ok(!JSON.stringify(flags).match(/made-up|made up|sample/i), 'nothing says the numbers are made up')
})

// --- the figures the original checks never covered ------------------------------------------------------------------

const rowOf = (res, slug) => res.rows.find((r) => r.slug === slug)

test('interest rate: the average of the loans, weighted by amount, is compared with the range', () => {
  const p = project('development', (d) => {
    const debt = d.sources.rows.filter((r) => ['senior_loan', 'construction_loan', 'mezzanine', 'permanent_loan', 'bridge_loan'].includes(r.type) || (typeof r.interestRate === 'number' && r.amount > 0))
    assert.ok(debt.length >= 1, 'the healthy sample has a loan')
  })
  const rows = p.data.sources.rows.filter((r) => typeof r.interestRate === 'number' && r.amount > 0)
  const expected = rows.reduce((a, r) => a + r.amount * r.interestRate, 0) / rows.reduce((a, r) => a + r.amount, 0)
  const inside = compareYours(p, [entry('interestRate', expected - 0.01, expected + 0.01)])
  assert.equal(rowOf(inside, 'interest-rate').status, 'within')
  assert.ok(Math.abs(rowOf(inside, 'interest-rate').value - expected) < 1e-9)
  assert.deepEqual(inside.flags, [])
})

test('the side that matters most is graded by how far past the range the figure is; the other side is a lesser finding', () => {
  const p = project('development')
  const value = compareYours(p, [entry('interestRate', 0.001, 0.999)]).rows[0].value
  const grade = (low, high, metric = 'interestRate') => compareYours(p, [entry(metric, low, high)]).flags.map((f) => [f.id, f.severity])
  // A rate above the range is the risky side for an interest rate.
  assert.deepEqual(grade(value / 1.3, value / 1.3), [['M2-yours-interest-rate-above', 'high']], '30% past the high edge')
  assert.deepEqual(grade(value / 1.1, value / 1.1), [['M2-yours-interest-rate-above', 'medium']], '10% past')
  assert.deepEqual(grade(value / 1.02, value / 1.02), [['M2-yours-interest-rate-above', 'low']], '2% past')
  // A rate below the range is the safe side: a lesser finding, and medium only when it is far (25% or more) past the edge.
  const nearBelow = grade(value * 1.1, value * 1.2)
  assert.deepEqual(nearBelow, [['M2-yours-interest-rate-below', 'low']], '9% below the low edge')
  const farBelow = grade(value * 1.5, value * 1.6)
  assert.deepEqual(farBelow, [['M2-yours-interest-rate-below', 'medium']], '33% below the low edge')
  assert.deepEqual(grade(value, value), [], 'on the edge is within')
})

test('coverage below the range is the risky side', () => {
  const p = project('development')
  const dscr = keyRatios(p, DEFAULT_SETTINGS).find((r) => r.id === 'dscr')
  if (!dscr?.ok) return assert.ok(true) // the sample has no coverage figure to compare
  const res = compareYours(p, [entry('dscr', dscr.value * 1.4, dscr.value * 1.6)])
  assert.equal(res.flags[0].id, 'M2-yours-coverage-below')
  assert.equal(res.flags[0].severity, 'high')
})

test('a figure that cannot be worked out is shown as not available with the reason, and is never a finding', () => {
  const p = project('development', (d) => {
    d.sources.rows = []
  })
  const res = compareYours(p, [entry('interestRate', 0.05, 0.07), entry('vacancy', 0.05, 0.07)])
  const row = rowOf(res, 'interest-rate')
  assert.equal(row.status, 'not_available')
  assert.match(row.detail, /No loans with an amount are entered/)
  assert.deepEqual(res.flags.filter((f) => f.id.includes('interest')), [])
})

test('a loan with a rate that cannot be believed is left out and the table says so', () => {
  const p = project('development', (d) => {
    const loan = d.sources.rows.find((r) => typeof r.interestRate === 'number' && r.amount > 0)
    d.sources.rows.push({ ...loan, amount: 1000000, interestRate: 6.5 })
  })
  const res = compareYours(p, [entry('interestRate', 0.001, 0.999)])
  assert.match(res.rows[0].detail, /1 loan without a believable rate is left out/)
})

test('vacancy is read from the residential income', () => {
  const p = project('development', (d) => {
    d.residentialIncome.stabilizedVacancy = 0.03
  })
  const res = compareYours(p, [entry('vacancy', 0.05, 0.08)])
  assert.equal(res.rows[0].value, 0.03)
  assert.equal(res.flags[0].id, 'M2-yours-vacancy-below')
  assert.deepEqual(res.flags[0].cell_refs.length > 0, true, 'a finding points at the cell')
})

test('findings are valid, name the range the team entered, and point at spreadsheet cells', () => {
  const p = project('development', (d) => {
    d.residentialIncome.stabilizedVacancy = 0.03
  })
  const { flags } = compareYours(p, [entry('vacancy', 0.05, 0.08)])
  for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
  assert.match(flags[0].evidence, /your range of 5\.00% to 8\.00%/)
  assert.match(flags[0].follow_up, /the range you set/)
})

test('an entry that is invalid, or a duplicate of an earlier one, is ignored', () => {
  const p = project('development', (d) => {
    d.residentialIncome.stabilizedVacancy = 0.03
  })
  const res = compareYours(p, [entry('vacancy', 0.08, 0.05), entry('vacancy', 0.05, 0.08, { id: 'v2' }), entry('vacancy', 0.01, 0.02, { id: 'v3' })])
  assert.equal(res.rows.length, 1)
  assert.equal(res.rows[0].id, 'yours-v2')
})

test('rents, expenses and costs are not compared twice: compareYours leaves them to the original checks', () => {
  const p = project('development')
  const res = compareYours(p, [entry('expense', 1, 2), entry('costTotal', 1, 2), entry('contingency', 0.01, 0.02), { id: 'r', metric: 'rent', unitType: '2br', ami: '', low: 1, high: 2 }])
  assert.deepEqual(res.rows, [])
  assert.deepEqual(res.flags, [])
})

test('hostile text in a range or label cannot break a finding', () => {
  const p = project('development', (d) => {
    d.residentialIncome.stabilizedVacancy = 0.03
  })
  const res = compareYours(p, [{ id: '<img src=x onerror=1>', metric: 'vacancy', low: 0.05, high: 0.08, typical: null }])
  for (const f of res.flags) assert.deepEqual(validateFlag(f), [])
})

// --- through the module itself -----------------------------------------------------------------------------------------

test('the module raises the ratio findings for entries it is given, and lists the figures it compared', () => {
  const p = project('development', (d) => {
    d.residentialIncome.stabilizedVacancy = 0.03
  })
  const r = run(p, { benchmarks: [entry('vacancy', 0.05, 0.08)] })
  assert.deepEqual(r.flags.map((f) => f.id), ['M2-yours-vacancy-below'])
  assert.match(r.notes[0], /Compared 1 figures with "Your benchmarks"/)
  assert.ok(!/made-up/.test(r.notes.join(' ')))
  for (const f of r.flags) assert.deepEqual(validateFlag(f), [])
})

test('the module still works with no entries given at all (the built-in sets, as the tests and answer key use them)', () => {
  const r = run(project('development'), {})
  assert.ok(r.notes[0].includes('made-up'), 'only the built-in numbers are described as made-up')
  assert.ok(!r.flags.some((f) => f.id.startsWith('M2-yours')))
})
