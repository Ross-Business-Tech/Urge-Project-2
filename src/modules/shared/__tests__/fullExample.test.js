// The fully filled-in example (sample-files/full-example-*): the committed files load the way the app loads them, every part of
// the workbook is filled in, nothing in it is broken, and the example benchmark file shows what the README says it shows.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { importWorkbook } from '../import/importWorkbook.js'
import { parseT12Template } from '../import/t12Template.js'
import { applyStageAndDate, replaceT12Rows, parseEntries, usableEntries, problemsByEntry, validateFlag } from '../index.js'
import { FULL_EXAMPLE, UNIT_MIX, EXAMPLE_BENCHMARKS } from '../samples/fullExample.js'
import { run as integrity } from '../../m1-integrity/index.js'
import { benchmarkEffects } from '../../../benchmarkEffects.js'

const file = (name) => readFileSync(new URL(`../../../../sample-files/${name}`, import.meta.url))

async function load(kind) {
  const out = await importWorkbook(file(`${FULL_EXAMPLE[kind].file}.xlsx`))
  assert.equal(out.projects.length, 1)
  let record = applyStageAndDate(out.projects[0], { stage: FULL_EXAMPLE[kind].stage, asOfDate: FULL_EXAMPLE[kind].asOf })
  if (kind === 'completed') record = replaceT12Rows(record, parseT12Template(file(`${FULL_EXAMPLE.completed.file}-t12.xlsx`)))
  return { out, record }
}

for (const kind of ['development', 'completed']) {
  test(`${kind}: the workbook loads with every part filled in`, async () => {
    const { out, record } = await load(kind)
    const d = record.data
    assert.equal(d.identity.name, 'Riverside Commons')
    assert.equal(d.residentialIncome.rows.length, UNIT_MIX.length)
    assert.deepEqual(d.residentialIncome.rows.map((r) => r.unitType), UNIT_MIX.map((r) => r.unitType))
    assert.deepEqual([...new Set(d.residentialIncome.rows.map((r) => r.unitType))], ['Studio', '1 BR', '2 BR', '3 BR'])
    assert.ok(d.residentialIncome.rows.some((r) => r.amiLevel !== null), 'one unit type is income-restricted')
    assert.equal(d.residentialIncome.rows.reduce((a, r) => a + r.units, 0), 100)
    assert.ok(d.commercialIncome.rows.length >= 2 && d.otherIncome.rows.length >= 2)
    assert.ok(d.sources.rows.length >= 5, 'several loans and equity')
    assert.ok(Object.values(d.operatingExpenses.lines).every((l) => typeof l.amount === 'number'), 'every expense line is filled in')
    for (const role of ['generalContractor', 'architect', 'devPartner1', 'devPartner2', 'other1', 'other2']) assert.ok(d.team.lines[role].firmName, role)
    assert.ok(d.timeline.constructionStart && d.timeline.constructionCompletion && d.timeline.stabilization)
    // "Other" catch-all lines are left blank, and so are buying existing buildings and related-party fees, which this project does not have.
    const budget = Object.entries(d.budget.lines).filter(([k]) => !/Other\d?$/.test(k) && !['buildings', 'relatedPartyFees'].includes(k))
    assert.ok(budget.every(([, l]) => typeof l.amount === 'number' && l.amount > 0), `every budget line is filled in: ${budget.filter(([, l]) => !(l.amount > 0)).map(([k]) => k)}`)
    assert.ok(out.firm.data.identity.name)
  })

  test(`${kind}: sources equal uses, and the data integrity checks find nothing wrong`, async () => {
    const { out, record } = await load(kind)
    const uses = Object.values(record.data.budget.lines).reduce((a, l) => a + (l.amount ?? 0), 0)
    const sources = record.data.sources.rows.reduce((a, r) => a + (r.amount ?? 0), 0)
    assert.equal(sources, uses)
    const { flags } = integrity(record, { firm: out.firm, facts: out.facts, report: out.report })
    assert.deepEqual(flags.filter((f) => f.severity !== 'low').map((f) => `${f.id}: ${f.title}`), [])
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
  })
}

test('the T-12 has twelve months with every expense line the budget has', () => {
  const { rows } = parseT12Template(file(`${FULL_EXAMPLE.completed.file}-t12.xlsx`))
  assert.equal(rows.length, 12)
  for (const key of ['propertyManagement', 'leasingExpense', 'auditTax', 'miscAdmin', 'elevatorContract', 'propertyTaxes']) assert.ok(rows.every((r) => typeof r[key] === 'number' && r[key] > 0), key)
})

test('the example benchmarks file opens, every range is usable, and it matches the ranges in the code', () => {
  const read = parseEntries(readFileSync(new URL('../../../../sample-files/full-example-benchmarks.json', import.meta.url), 'utf8'))
  assert.equal(read.ok, true)
  assert.equal(read.changedAt, '2026-11-16T12:00:00.000Z')
  assert.equal(read.entries.length, EXAMPLE_BENCHMARKS.length)
  assert.deepEqual(problemsByEntry(read.entries), {})
  assert.equal(usableEntries(read.entries).length, EXAMPLE_BENCHMARKS.length)
})

const statuses = (res) => Object.fromEntries(res.items.map((i) => [i.id, i.status]))

test('development: the example benchmarks show what the README says', async () => {
  const { record } = await load('development')
  const res = benchmarkEffects(record, EXAMPLE_BENCHMARKS, {})
  assert.deepEqual(statuses(res), {
    'rent-studio': 'within', 'rent-1br': 'within', 'rent-1br-60': 'within', 'rent-2br': 'above', 'rent-2br-60': 'within',
    expense: 'above', 'cost-hard': 'within', 'cost-soft': 'above', 'cost-total': 'within', contingency: 'within',
    interest: 'within', coverage: 'above', 'loan-to-cost': 'within', equity: 'above', 'break-even': 'within', yield: 'below', 'debt-yield': 'within', vacancy: 'within',
  })
  assert.deepEqual(res.notCompared, ['Rent for 3br (market rate): no range entered, so 1 unit row not compared.'])
})

test('completed: ranges for cost and contingency are not used, and the rest are compared', async () => {
  const { record } = await load('completed')
  const s = statuses(benchmarkEffects(record, EXAMPLE_BENCHMARKS, {}))
  for (const id of ['cost-hard', 'cost-soft', 'cost-total']) assert.equal(s[id], 'unused', id)
  assert.equal(s.contingency, 'unused')
  assert.equal(s['rent-2br'], 'above')
  assert.equal(s['rent-studio'], 'within')
  assert.equal(s.expense, 'above')
  assert.equal(s.interest, 'within')
  assert.equal(s.coverage, 'above')
  assert.equal(s.vacancy, 'within')
  assert.equal(s['loan-to-cost'], 'not_available', 'a finished project has no cost to compare loans with')
})
