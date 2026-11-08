import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, compareSeverity, validateFlag, BENCHMARK_SETS } from '../../shared/index.js'
import { t12Rows } from '../../shared/samples/scenarios.js'
import { run, compareProject } from '../index.js'

async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return record
}

// A project built in code, with the stage chosen.
const project = (stage, edit = () => {}) => {
  const p = applyStageAndDate(healthyProject(), { stage, asOfDate: '2026-01-15' })
  edit(p.data)
  return p
}
const ids = (r) => run(r, {}).flags.map((f) => f.id)
const flagOf = (r, id) => run(r, {}).flags.find((f) => f.id === id)

for (const s of scenarios) {
  test(`${s.id}: M2 matches the answer key and stays calm`, async () => {
    const record = await load(s)
    const { flags, notes } = run(record, {})
    assert.ok(!flags.some((f) => f.id === 'M2-check-failed'), notes.join(' | '))
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const want of s.key.flags.filter((k) => k.module === 'M2')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, want.id)
      else {
        assert.ok(got, `should raise ${want.id}; got ${flags.map((f) => f.id).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants ${want.severity}`)
      }
    }
  })
}

test('the healthy controls raise nothing above low', async () => {
  for (const id of ['s01-healthy-development', 's10-healthy-project-failing-firm']) {
    const flags = run(await load(scenarios.find((x) => x.id === id)), {}).flags
    assert.deepEqual(flags.filter((f) => f.severity !== 'low').map((f) => f.id), [], id)
  }
})

test('lease-up rents are the achieved rents from the T-12, net of concessions', async () => {
  const s09 = await load(scenarios.find((x) => x.id === 's09-passes-dscr-low-occupancy-high-rent'))
  const row = compareProject(s09, {}).rows.find((r) => r.id === 'rent-achieved')
  assert.equal(row.value, 1950) // 40 units at 1,500 x 1.3, no concessions
  assert.equal(row.status, 'above')
  const discounted = replaceT12Rows(s09, { rows: s09.data.t12.rows.map((m) => ({ ...m, concessions: 40 * 500 })), sources: {} })
  const after = compareProject(discounted, {}).rows.find((r) => r.id === 'rent-achieved')
  assert.equal(after.value, 1450)
  assert.equal(after.status, 'within')
})

test('lease-up without a T-12 falls back to projected rents and says so', () => {
  const rows = compareProject(project('lease_up'), {}).rows
  const rent = rows.find((r) => r.metric === 'rent')
  assert.match(rent.basis, /no T-12/)
  assert.equal(rows.find((r) => r.metric === 'cost').status, 'not_available')
})

test('completed projects use T-12 expenses when there is one, and never compare cost', () => {
  const p = replaceT12Rows(project('completed'), { rows: t12Rows({ expenseFactor: 1.5 }), sources: {} })
  const rows = compareProject(p, {}).rows
  const e = rows.find((r) => r.id === 'expenses')
  assert.match(e.basis, /T-12/)
  assert.ok(Math.abs(e.value - 7375.5) < 1, e.value) // (15,834 x 1.5 + 833 other) a month x 12 / 40 units
  assert.equal(rows.find((r) => r.metric === 'cost').status, 'not_applicable')
  assert.ok(ids(p).includes('M2-expenses-above-comps'))
})

test('a unit with an AMI level is compared only with its own AMI level, never with market rent', () => {
  const at60 = project('development', (d) => (d.residentialIncome.rows[0] = { ...d.residentialIncome.rows[0], amiLevel: '60%', monthlyRent: 1080 }))
  const row = compareProject(at60, {}).rows.find((r) => r.metric === 'rent')
  assert.equal(row.status, 'within')
  assert.match(row.detail, /60% AMI/)
  // 40% AMI has no benchmark: a low "no comparable benchmark" flag, not a comparison against market rent.
  const at40 = project('development', (d) => (d.residentialIncome.rows[0] = { ...d.residentialIncome.rows[0], amiLevel: 40, monthlyRent: 700 }))
  const f = flagOf(at40, 'M2-no-comparable-benchmark')
  assert.equal(f.severity, 'low')
  assert.ok(!ids(at40).includes('M2-rent-below-comps'))
})

test('severity grows with the distance from the range, in the risky direction', () => {
  const rent = (n) => project('development', (d) => (d.residentialIncome.rows[0].monthlyRent = n))
  assert.equal(flagOf(rent(1750), 'M2-rent-above-comps').severity, 'low') // 2.9% past the 1,700 edge
  assert.equal(flagOf(rent(1850), 'M2-rent-above-comps').severity, 'medium')
  assert.equal(flagOf(rent(2100), 'M2-rent-above-comps').severity, 'high')
  assert.equal(flagOf(rent(1200), 'M2-rent-below-comps').severity, 'low') // conservative rents are a note
  const pricey = project('development', (d) => (d.budget.lines.carpentry.amount = 6000000))
  assert.ok(['medium', 'high'].includes(flagOf(pricey, 'M2-cost-above-comps').severity))
})

test('missing data gives low "could not be checked" flags, never a crash', () => {
  const empty = project('development', (d) => {
    d.residentialIncome.rows = []
    d.commercialIncome.rows = []
  })
  const got = ids(empty)
  assert.ok(got.includes('M2-rent-missing'))
  assert.ok(got.includes('M2-expenses-missing'))
  assert.ok(got.includes('M2-cost-missing'))
  for (const f of run(empty, {}).flags) assert.equal(f.severity, 'low')
})

test('another benchmark set can be supplied, and a broken one is refused with a reason', () => {
  const strict = structuredClone(BENCHMARK_SETS)
  strict.development.expensePerUnitYear = { low: 4000, median: 4500, high: 5500 }
  assert.ok(!run(project('development'), { benchmarkSets: strict }).flags.some((f) => f.id.startsWith('M2-expenses')))
  const broken = structuredClone(BENCHMARK_SETS)
  broken.development.rents = []
  const { flags } = run(project('development'), { benchmarkSets: broken })
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [['M2-benchmarks-missing', 'low']])
})

test('a project with no stage is reported, not crashed', () => {
  const p = healthyProject()
  assert.deepEqual(run(p, {}).flags.map((f) => f.id), ['M2-stage-missing'])
})
