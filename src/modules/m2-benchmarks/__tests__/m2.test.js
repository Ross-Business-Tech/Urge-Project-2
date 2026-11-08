import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, compareSeverity, validateFlag, BENCHMARK_SETS } from '../../shared/index.js'
import { run, comparisons, severityFor, MODULE_ID } from '../index.js'

// Load a scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return record
}

// A project built in code (no workbook), at a chosen stage.
const project = (stage = 'development', edit = () => {}) => {
  const p = healthyProject()
  p.data.stage.stage = stage
  p.data.stage.asOfDate = '2026-01-15'
  edit(p)
  return p
}

const assertValid = (flags) => {
  for (const f of flags) {
    assert.deepEqual(validateFlag(f), [], f.id)
    assert.ok(Object.isFrozen(f), `${f.id} is not frozen`)
    assert.equal(f.module, 'M2')
    assert.equal(f.layer, 2)
    assert.ok(f.id.startsWith('M2-'), f.id)
  }
}

for (const s of scenarios) {
  test(`${s.id}: M2 matches the answer key and never crashes`, async () => {
    const record = await load(s)
    const { flags, notes } = run(record, {})
    assert.ok(!flags.some((f) => f.id === 'M2-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    assertValid(flags)
    for (const f of flags) assert.equal(f.stage_used, s.stage)
    for (const want of s.key.flags.filter((k) => k.module === 'M2')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${flags.map((f) => f.id).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy control raises no high or medium M2 flag', async () => {
  for (const id of ['s01-healthy-development', 's10-healthy-project-failing-firm']) {
    const { flags } = run(await load(scenarios.find((x) => x.id === id)), {})
    assert.deepEqual(flags.filter((f) => f.severity !== 'low').map((f) => f.id), [], id)
  }
})

test('each stage uses its own benchmark set', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    const rows = comparisons(project(stage), {})
    assert.ok(rows.length > 0, stage)
    for (const r of rows) {
      assert.equal(r.stage, stage)
      assert.equal(r.setName, BENCHMARK_SETS[stage].name)
    }
    assert.ok(run(project(stage), {}).notes[0].includes(BENCHMARK_SETS[stage].name), stage)
  }
  // The same rent sits in a different range at each stage.
  const range = (stage) => comparisons(project(stage), {}).find((r) => r.id === 'rent-0').range
  assert.deepEqual(range('development'), { low: 1300, median: 1500, high: 1700 })
  assert.deepEqual(range('completed'), BENCHMARK_SETS.completed.rents.find((x) => x.unitType === '1br' && x.amiLevel === null).range)
})

test('cost per square foot is compared for development and lease-up, not for completed', () => {
  for (const stage of ['development', 'lease_up']) {
    const cost = comparisons(project(stage), {}).filter((r) => r.metric === 'cost')
    assert.equal(cost.length, 3)
    assert.ok(cost.every((r) => ['within', 'above', 'below'].includes(r.status)), stage)
  }
  const done = comparisons(project('completed'), {}).filter((r) => r.metric === 'cost')
  assert.ok(done.every((r) => r.status === 'not-applicable'))
  assert.ok(!run(project('completed'), {}).flags.some((f) => f.id.startsWith('M2-cost')))
})

test('a rent within the range raises no rent flag; above or below does, with the numbers and the cells', () => {
  const inRange = run(project(), {})
  assert.ok(!inRange.flags.some((f) => f.id.startsWith('M2-rent')))
  assert.equal(comparisons(project(), {}).find((r) => r.id === 'rent-0').status, 'within')

  // 1,950 against a development range of 1,300 to 1,700: 15% above the top.
  const high = run(project('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = 1950)), {})
  const flag = high.flags.find((f) => f.id === 'M2-rent-above-comps')
  assert.ok(flag)
  assert.equal(flag.severity, 'medium')
  assert.match(flag.evidence, /\$1,950/)
  assert.match(flag.evidence, /\$1,300 to \$1,700/)
  assert.ok(flag.cell_refs.length > 0)
  assert.ok(flag.follow_up.endsWith('?'))

  const veryHigh = run(project('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = 2500)), {})
  assert.equal(veryHigh.flags.find((f) => f.id === 'M2-rent-above-comps').severity, 'high')

  const slightlyHigh = run(project('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = 1750)), {})
  assert.equal(slightlyHigh.flags.find((f) => f.id === 'M2-rent-above-comps').severity, 'low')

  // Rents below the market are the cautious direction: flagged, but low.
  const low = run(project('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = 800)), {})
  assert.equal(low.flags.find((f) => f.id === 'M2-rent-below-comps').severity, 'low')
})

test('lease-up compares achieved rent from the T-12, net of free rent', () => {
  const t12 = (concessions) =>
    project('lease_up', (p) => {
      p.data.t12.rows = ['2025-10', '2025-11', '2025-12'].map((month) => ({ month, residentialRevenue: 78000, concessions, propertyManagement: 4167, propertyTaxes: 10000 }))
    })
  const row = comparisons(t12(0), {}).find((r) => r.id === 'rent-achieved')
  assert.equal(row.value, 1950)
  assert.equal(row.status, 'above')
  assert.ok(run(t12(0), {}).flags.some((f) => f.id === 'M2-rent-above-comps' && f.severity === 'medium'))
  // With 18,000 a month of free rent the achieved rent is 1,500, inside the range.
  assert.equal(comparisons(t12(-18000), {}).find((r) => r.id === 'rent-achieved').status, 'within')
  // Development never uses the T-12 for rent.
  assert.equal(comparisons(project('development', (p) => (p.data.t12.rows = [{ month: '2025-12', residentialRevenue: 90000 }])), {}).find((r) => r.id === 'rent-achieved'), undefined)
})

test('affordable units are compared only with the same AMI level, never with market rent', () => {
  const at60 = project('development', (p) => {
    p.data.residentialIncome.rows[0].amiLevel = '60%'
    p.data.residentialIncome.rows[0].monthlyRent = 1500
  })
  const row = comparisons(at60, {}).find((r) => r.id === 'rent-0')
  assert.deepEqual(row.range, BENCHMARK_SETS.development.rents.find((x) => x.unitType === '1br' && x.amiLevel === 60).range)
  assert.equal(row.status, 'above') // 1,500 is market rent, well above the 60% AMI range
  assert.ok(run(at60, {}).flags.some((f) => f.id === 'M2-rent-above-comps'))

  // No benchmark for 70% AMI: a low "no comparable benchmark" flag, and no comparison with market rent.
  const at70 = project('development', (p) => (p.data.residentialIncome.rows[0].amiLevel = 0.7))
  const r70 = comparisons(at70, {}).find((r) => r.id === 'rent-0')
  assert.equal(r70.status, 'no-benchmark')
  assert.equal(r70.range, null)
  const flags = run(at70, {}).flags
  const none = flags.find((f) => f.id === 'M2-rent-no-benchmark')
  assert.equal(none.severity, 'low')
  assert.match(none.evidence, /70% AMI/)
  assert.ok(!flags.some((f) => f.id === 'M2-rent-above-comps' || f.id === 'M2-rent-below-comps'))
})

test('missing data gives a low flag naming what is missing, never a zero', () => {
  const noRent = project('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = null))
  const row = comparisons(noRent, {}).find((r) => r.id === 'rent-0')
  assert.equal(row.status, 'missing')
  assert.equal(row.value, null)
  const f = run(noRent, {}).flags.find((x) => x.id === 'M2-rent-missing')
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /monthly rent/i)

  const noRows = run(project('development', (p) => (p.data.residentialIncome.rows = [])), {}).flags
  assert.ok(noRows.find((x) => x.id === 'M2-rent-missing'))
  assert.ok(noRows.find((x) => x.id === 'M2-expenses-missing'))

  const noBudget = project('development', (p) => {
    for (const line of Object.values(p.data.budget.lines)) line.amount = null
  })
  assert.equal(run(noBudget, {}).flags.find((x) => x.id === 'M2-cost-missing').severity, 'low')
  assert.ok(comparisons(noBudget, {}).filter((r) => r.metric === 'cost').every((r) => r.status === 'missing' && r.value === null))

  const noSqft = run(project('development', (p) => (p.data.residentialIncome.rows[0].sqft = null)), {}).flags
  assert.match(noSqft.find((x) => x.id === 'M2-cost-missing').evidence, /square feet/i)

  // A completed project without a T-12 cannot compare actual expenses.
  const noT12 = run(project('completed'), {}).flags
  assert.equal(noT12.find((x) => x.id === 'M2-expenses-missing').severity, 'low')

  // An unbelievable rent is refused, not compared.
  assert.equal(comparisons(project('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = -5)), {}).find((r) => r.id === 'rent-0').status, 'missing')
  for (const flags of [noRows, noSqft, noT12]) assertValid(flags)
})

test('expenses below the market are the risky direction and scale with distance', () => {
  const lowExp = project('development', (p) => {
    p.data.operatingExpenses.lines.propertyTaxes.amount = 40000 // 120,000 a year in total, 3,000 a unit
  })
  const f = run(lowExp, {}).flags.find((x) => x.id === 'M2-expenses-below-comps')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /\$3,000 a year/)
  const highExp = project('development', (p) => (p.data.operatingExpenses.lines.propertyTaxes.amount = 400000))
  assert.equal(run(highExp, {}).flags.find((x) => x.id === 'M2-expenses-above-comps').severity, 'low')
})

test('severity follows the distance outside the range', () => {
  const at = (metric, status, percentOutside) => severityFor({ metric, status, percentOutside })
  assert.equal(at('rent', 'above', 0.05), 'low')
  assert.equal(at('rent', 'above', 0.2), 'medium')
  assert.equal(at('rent', 'above', 0.4), 'high')
  assert.equal(at('expenses', 'below', 0.3), 'high')
  assert.equal(at('cost', 'above', 0.3), 'high')
  assert.equal(at('cost', 'below', 0.3), 'low')
  assert.equal(at('rent', 'within', 0), null)
})

test('context.benchmarks can supply the sets, and a broken set gives a low flag', () => {
  const custom = structuredClone(BENCHMARK_SETS)
  custom.development.name = 'Test set'
  custom.development.rents = custom.development.rents.map((r) => (r.unitType === '1br' && r.amiLevel === null ? { ...r, range: { low: 1000, median: 1100, high: 1200 } } : r))
  const rows = comparisons(project(), { benchmarks: custom })
  assert.equal(rows[0].setName, 'Test set')
  assert.equal(rows.find((r) => r.id === 'rent-0').status, 'above')

  const broken = { ...BENCHMARK_SETS, development: { ...BENCHMARK_SETS.development, rents: [] } }
  const { flags } = run(project(), { benchmarks: broken })
  assert.equal(flags.length, 1)
  assert.equal(flags[0].id, 'M2-benchmarks-missing')
  assert.equal(flags[0].severity, 'low')
  assert.deepEqual(comparisons(project(), { benchmarks: broken }), [])
})

test('bad input never crashes', () => {
  const inputs = [undefined, null, 42, 'text', {}, { data: null }, { data: { stage: { stage: 'development' } } }, { data: { stage: { stage: 'sideways' } } }]
  for (const input of inputs) {
    const out = run(input, undefined)
    assert.ok(Array.isArray(out.flags))
    assert.ok(out.flags.length >= 1)
    assert.ok(!out.flags.some((f) => f.id === 'M2-check-failed'), JSON.stringify(input))
    assertValid(out.flags)
    assert.deepEqual(comparisons(input, undefined), [])
  }
  // Odd values inside an otherwise good record.
  const odd = project('lease_up', (p) => {
    p.data.residentialIncome.rows.push(null, { unitType: '2 BR', amiLevel: 'lots', units: 'ten', monthlyRent: Infinity })
    p.data.t12.rows = [{ month: 'June', residentialRevenue: 5 }, { month: '2025-12', residentialRevenue: Number.NaN, propertyTaxes: -1 }]
    p.data.budget.lines.land.amount = 1e15
  })
  const out = run(odd, { benchmarks: 'nonsense' })
  assert.ok(!out.flags.some((f) => f.id === 'M2-check-failed'), out.notes.join(' | '))
  assertValid(out.flags)
  assert.ok(comparisons(odd, {}).length > 0)
})

test('MODULE_ID is M2 and comparison rows cannot be changed', () => {
  assert.equal(MODULE_ID, 'M2')
  const rows = comparisons(project(), {})
  assert.ok(rows.every((r) => Object.isFrozen(r)))
})
