import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../index.js'
import { importWorkbook } from '../import/importWorkbook.js'
import { applicantWorkbook } from './helpers.js'

const sourcesGroup = M.projectSchema.find((g) => g.id === 'sources')
const load = async () => (await importWorkbook(applicantWorkbook({ details: { D29: 'Second', E29: 'Mezzanine Debt', F29: 500000, G29: 120, H29: 0.11, D30: 'Third', E30: 'Developer Equity', F30: 250000 } }))).projects[0]

// ---------------------------------------------------------------- typed text
test('numbers: the way people type them', () => {
  const P = M.parseInput
  assert.deepEqual(P('dollars', '$250,000'), { value: 250000 })
  assert.deepEqual(P('dollars', '1,234.50'), { value: 1234.5 })
  assert.deepEqual(P('dollars', '(4,000.50)'), { value: -4000.5 })
  assert.deepEqual(P('dollars', '  '), { value: null })
  assert.deepEqual(P('number', '1 250'), { value: 1250 })
  assert.deepEqual(P('percent', '6.5%'), { value: 0.065 })
  assert.deepEqual(P('percent', '6.5'), { value: 0.065 })
})

test('numbers: misplaced commas are refused, not silently turned into a different number', () => {
  for (const text of ['1,5', '1,2,3', '1,000,00', '12,34', ',5', '1,,000']) assert.ok(M.parseInput('dollars', text).error, `refuses "${text}"`)
})

test('numbers: text that is not a plain number is refused', () => {
  for (const text of ['lots', '1e9', '0x10', 'Infinity', '1_000', '12abc', '--5', '5%%']) assert.ok(M.parseInput('number', text).error, `refuses "${text}"`)
})

test('numbers: limits for the field are enforced', () => {
  const P = M.parseInput
  assert.ok(P('number', '-40', { min: 0 }).error, 'a unit count cannot be negative')
  assert.ok(P('percent', '650', { min: 0, max: 1 }).error, '650% is refused where 100% is the most')
  assert.ok(P('percent', '-5', { min: 0, max: 1 }).error)
  assert.deepEqual(P('percent', '100', { min: 0, max: 1 }), { value: 1 }, 'the boundary itself is fine')
  assert.deepEqual(P('percent', '0', { min: 0, max: 1 }), { value: 0 })
  assert.ok(P('number', '2.5', { integer: true }).error)
  assert.ok(P('number', '1300', { max: 1200 }).error)
  assert.ok(P('dollars', '1000000000000000').error, 'anything past a trillion is refused')
  assert.ok(P('percent', '5000').error, 'a default percentage limit applies even with no field limits')
})

test('numbers: what is shown can be typed back without change', () => {
  for (const v of [0.065, 0.0525, 0.1, 0.07, 0.123456, 1, 0]) assert.equal(M.parseInput('percent', M.formatForInput('percent', v)).value, v)
  for (const v of [0, 1, 1234.5, 3000000, 0.5]) assert.equal(M.parseInput('dollars', M.formatForInput('dollars', v)).value, v)
})

test('text, dates and months', () => {
  assert.deepEqual(M.parseInput('text', '  hi  '), { value: 'hi' })
  assert.equal(M.parseInput('text', 'x'.repeat(900)).value.length, 500)
  assert.deepEqual(M.parseInput('date', '2026-03-31'), { value: '2026-03-31' })
  assert.ok(M.parseInput('date', '2026-02-30').error)
  assert.deepEqual(M.parseInput('yearMonth', '2026-03'), { value: '2026-03' })
  assert.deepEqual(M.parseInput('yearMonth', '2026'), { value: '2026' })
  assert.ok(M.parseInput('yearMonth', '2026-13').error)
})

// ---------------------------------------------------------------- the schema carries the limits
test('the schema states the limits for the fields the calculators use', () => {
  const col = (group, key) => M.projectSchema.find((g) => g.id === group).columns.find((c) => c.key === key)
  assert.equal(col('sources', 'amount').min, 0)
  assert.equal(col('sources', 'interestRate').max, 1)
  assert.equal(col('sources', 'termMonths').max, 1200)
  assert.equal(col('residentialIncome', 'units').min, 0)
  assert.equal(col('t12', 'occupancy').max, 1)
  assert.equal(col('t12', 'vacancyLoss').min, undefined, 'vacancy and concessions may be typed either way')
  assert.match(col('sources', 'paymentOverride').label, /yearly/i)
})

// ---------------------------------------------------------------- editing a record
test('editing keeps the applicant original and puts it back', async () => {
  const rec = await load()
  const path = 'sources.rows.0.amount'
  const was = M.getValue(rec, path)
  assert.equal(M.provenance(rec, path).kind, 'workbook')
  const r1 = M.setValue(rec, path, 3200000)
  assert.equal(M.provenance(r1, path).kind, 'changed')
  assert.equal(M.provenance(r1, path).original, was)
  assert.equal(M.provenance(M.setValue(r1, path, 3300000), path).original, was, 'the original is still the applicant value after a second edit')
  const back = M.setValue(r1, path, was)
  assert.equal(M.provenance(back, path).kind, 'workbook')
  assert.equal(back.sources[path], rec.sources[path])
  assert.ok(!(path in back.originals))
  const cleared = M.setValue(r1, path, '')
  assert.equal(M.getValue(cleared, path), null)
  assert.equal(M.provenance(cleared, path).kind, 'changed')
  assert.equal(M.setValue(rec, path, was), rec, 'setting the same value changes nothing')
})

test('editing never changes the record it was given', async () => {
  const rec = await load()
  const frozen = JSON.stringify(rec)
  M.setValue(rec, 'identity.name', 'New name')
  M.addTableRow(rec, sourcesGroup)
  M.removeTableRow(rec, sourcesGroup, 0)
  assert.equal(JSON.stringify(rec), frozen)
})

test('editing refuses values of the wrong kind', async () => {
  const rec = await load()
  assert.throws(() => M.setValue(rec, 'sources.rows.0.amount', 'lots of money'), /not valid/i)
  assert.throws(() => M.setValue(rec, 'sources.rows.0.amount', -5), /not valid/i)
  assert.throws(() => M.setValue(rec, 'sources.rows.0.interestRate', 6.5), /not valid/i)
  assert.throws(() => M.setValue(rec, 'residentialIncome.rows.0.units', -5), /not valid/i)
  assert.throws(() => M.setValue(rec, 'identity.name', { a: 1 }), /not valid/i)
  assert.throws(() => M.setValue(rec, 'identity.confidential', 'maybe'), /not valid/i)
  assert.equal(M.getValue(M.setValue(rec, 'sources.rows.0.interestRate', 1), 'sources.rows.0.interestRate'), 1, 'a boundary value is fine')
})

test('putting back an applicant value is allowed even if it was out of range', async () => {
  const rec = await importWorkbook(applicantWorkbook({ details: { H28: 6.5 } })).then((o) => o.projects[0])
  const path = 'sources.rows.0.interestRate'
  assert.equal(M.getValue(rec, path), 6.5, 'the applicant typed it; we keep what they said')
  const fixed = M.setValue(rec, path, 0.065)
  const restored = M.setValue(fixed, path, M.provenance(fixed, path).original, { restore: true })
  assert.equal(M.getValue(restored, path), 6.5)
})

test('editing cannot invent structure or touch built-in objects', async () => {
  const rec = await load()
  for (const bad of ['nope.field', 'identity.nope', '__proto__.x', 'identity.__proto__', 'sources.rows.99.amount', 'identity']) {
    assert.throws(() => M.setValue(rec, bad, 1), undefined, bad)
  }
  assert.equal({}.polluted, undefined)
})

test('rows: adding stops at the maximum; removing keeps each remaining row\'s history', async () => {
  const rec = await load()
  const n = rec.data.sources.rows.length
  let full = rec
  for (let i = 0; i < 30; i++) full = M.addTableRow(full, sourcesGroup)
  assert.equal(full.data.sources.rows.length, sourcesGroup.maxRows)

  // Change a value in the last workbook row, then remove the FIRST row: that change must follow its row up.
  const changed = M.setValue(rec, `sources.rows.${n - 1}.amount`, 111111)
  const original = changed.originals[`sources.rows.${n - 1}.amount`]
  const removed = M.removeTableRow(changed, sourcesGroup, 0)
  assert.equal(removed.data.sources.rows.length, n - 1)
  assert.equal(removed.data.sources.rows[n - 2].amount, 111111)
  assert.deepEqual(removed.originals[`sources.rows.${n - 2}.amount`], original)
  assert.ok(!(`sources.rows.${n - 1}.amount` in removed.originals))
  assert.equal(removed.originals['sources.removedRows'].length, 1, 'the removed workbook row is kept in the history')
  assert.match(removed.originals['sources.removedRows'][0].sources.amount, /!F28$/)
  assert.equal(M.removeTableRow(rec, sourcesGroup, 99), rec, 'removing a row that is not there changes nothing')

  // A hand-typed row leaves no history when removed.
  let withHand = M.addTableRow(rec, sourcesGroup)
  withHand = M.setValue(withHand, `sources.rows.${n}.name`, 'Hand typed')
  const handRemoved = M.removeTableRow(withHand, sourcesGroup, n)
  assert.ok(!('sources.removedRows' in handRemoved.originals))
})

test('counting how much of a group is filled in', async () => {
  const rec = await load()
  const c = M.countGroup(sourcesGroup, rec.data.sources)
  assert.equal(c.total, rec.data.sources.rows.length * sourcesGroup.columns.length)
  const more = M.setValue(M.addTableRow(rec, sourcesGroup), `sources.rows.${rec.data.sources.rows.length}.name`, 'X')
  const c2 = M.countGroup(sourcesGroup, more.data.sources)
  assert.equal(c2.total, c.total + sourcesGroup.columns.length)
  assert.equal(c2.filled, c.filled + 1)
})

// ---------------------------------------------------------------- stage and date
test('stage and as-of date: chosen by the underwriter, validated, never changing anything else', async () => {
  const rec = await load()
  assert.equal(rec.data.stage.stage, null)
  const a = M.applyStageAndDate(rec, { stage: 'development' })
  assert.equal(a.sources['stage.stage'], 'manual')
  assert.deepEqual(M.projectReadiness(a).missing, ['asOfDate'])
  const b = M.applyStageAndDate(a, { asOfDate: '2026-11-05' })
  assert.equal(M.projectReadiness(b).ready, true)
  assert.equal(rec.data.stage.stage, null, 'the original is unchanged')
  assert.deepEqual(M.reviewReadiness([b, rec]), { ready: false, total: 2, waiting: 1 })
  for (const bad of ['spring', 'Development', '', 7]) assert.throws(() => M.applyStageAndDate(rec, { stage: bad }), /Unknown stage/)
  for (const bad of ['2026-02-30', '11/05/2026', 'today', '2026-1-5']) assert.throws(() => M.applyStageAndDate(rec, { asOfDate: bad }), /valid date/)
  assert.equal(JSON.stringify({ ...b.data, stage: 0 }), JSON.stringify({ ...rec.data, stage: 0 }), 'nothing else changed')
})
