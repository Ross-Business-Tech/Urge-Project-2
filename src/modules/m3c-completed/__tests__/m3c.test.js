import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios, t12Rows } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { applyStageAndDate, replaceT12Rows, compareSeverity, validateFlag, blankProject } from '../../shared/index.js'
import { run, checklist } from '../index.js'
import { parseMonth } from '../checks.js'

// Load a scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return { record, context: { firm: out.firm } }
}
const byId = (id) => scenarios.find((x) => x.id === id)
const ids = (flags) => flags.map((f) => f.id)
const healthy = () => load(byId('s10-healthy-project-failing-firm'))
const withT12 = (record, rows) => replaceT12Rows(record, parseT12Template(buildT12Template({ rows })))
// The same T-12 with one line changed in every month (the module reads expenses from the T-12 when there is one).
const editT12 = (record, change) => withT12(record, t12Rows().map((r) => ({ ...r, ...change })))

for (const s of scenarios) {
  test(`${s.id}: M3C matches the answer key`, async () => {
    const { record, context } = await load(s)
    const { flags, notes } = run(record, context)
    assert.ok(!ids(flags).includes('M3C-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const want of s.key.flags.filter((k) => k.module === 'M3C')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}: ${got?.evidence}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${ids(flags).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('a healthy completed project raises no high flag and nothing about actuals', async () => {
  const { record, context } = await healthy()
  const flags = run(record, context).flags
  assert.deepEqual(flags.filter((f) => f.severity === 'high').map((f) => f.id), [])
  for (const id of ['M3C-actuals-vs-underwriting', 'M3C-rents-below-underwriting', 'M3C-vacancy-above-assumption', 'M3C-expenses-over-underwriting', 'M3C-loan-maturity-near', 'M3C-tax-reassessment-risk', 'M3C-reserves-low']) {
    assert.ok(!ids(flags).includes(id), id)
  }
  for (const f of flags) assert.equal(f.stage_used, 'completed')
})

test('no T-12: exactly one low "missing data" flag, and every T-12 check says why it did not run', async () => {
  const { record, context } = await load(byId('s11-missing-t12'))
  const { flags } = run(record, context)
  assert.equal(flags.filter((f) => f.id === 'M3C-missing-data').length, 1)
  assert.equal(flags.find((f) => f.id === 'M3C-missing-data').severity, 'low')
  const rows = checklist(record, context)
  for (const id of ['actuals', 'stability', 'rents', 'expenses', 'vacancy']) assert.equal(rows.find((r) => r.id === id).status, 'not_checked', id)
})

test('a partial T-12 (5 months) still runs the checks', async () => {
  const { record, context } = await load(byId('s12-partial-t12'))
  const rows = checklist(record, context)
  assert.equal(rows.find((r) => r.id === 'actuals').status, 'pass')
  assert.ok(!ids(run(record, context).flags).includes('M3C-missing-data'))
})

test('income well below underwriting: high, with the numbers and the cells', async () => {
  const { record, context } = await healthy()
  const weak = withT12(record, t12Rows({ rentFactor: 0.7 }))
  const f = run(weak, context).flags.find((x) => x.id === 'M3C-actuals-vs-underwriting')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /underwritten/)
  assert.ok(f.cell_refs.length > 0)
  const rent = run(weak, context).flags.find((x) => x.id === 'M3C-rents-below-underwriting')
  assert.equal(rent.severity, 'high')
})

test('slightly under underwriting is medium, and not flagged above the floor', async () => {
  const { record, context } = await healthy()
  const low = withT12(record, t12Rows({ rentFactor: 0.9 }))
  const f = run(low, context).flags.find((x) => x.id === 'M3C-actuals-vs-underwriting')
  assert.equal(f?.severity, 'medium')
  const fine = withT12(record, t12Rows({ rentFactor: 1.2 }))
  assert.ok(!ids(run(fine, context).flags).includes('M3C-actuals-vs-underwriting'))
})

test('vacancy above the assumption is flagged by how far above', async () => {
  const { record, context } = await healthy()
  const med = run(withT12(record, t12Rows({ occupancy: 0.9 })), context).flags.find((x) => x.id === 'M3C-vacancy-above-assumption')
  assert.equal(med.severity, 'medium')
  const high = run(withT12(record, t12Rows({ occupancy: 0.8 })), context).flags.find((x) => x.id === 'M3C-vacancy-above-assumption')
  assert.equal(high.severity, 'high')
})

test('expenses over underwriting', async () => {
  const { record, context } = await healthy()
  const f = run(withT12(record, t12Rows({ expenseFactor: 1.4 })), context).flags.find((x) => x.id === 'M3C-expenses-over-underwriting')
  assert.equal(f.severity, 'high')
})

test('expense lines: key lines missing is medium; the sample (only insurance missing) is low', async () => {
  const { record, context } = await healthy()
  const f = run(record, context).flags.find((x) => x.id === 'M3C-expense-lines-missing')
  assert.equal(f.severity, 'low')
  const bare = editT12(record, { propertyManagement: null, propertyTaxes: null, replacementReserves: null })
  assert.equal(run(bare, context).flags.find((x) => x.id === 'M3C-expense-lines-missing').severity, 'medium')
})

test('low reserves and low property taxes are medium and explain the effect', async () => {
  const { record, context } = await healthy()
  const r = editT12(record, { replacementReserves: 333 })
  assert.equal(run(r, context).flags.find((x) => x.id === 'M3C-reserves-low').severity, 'medium')
  const t = editT12(record, { propertyTaxes: 1500 })
  const f = run(t, context).flags.find((x) => x.id === 'M3C-tax-reassessment-risk')
  assert.equal(f.severity, 'medium')
  assert.match(f.evidence, /DSCR from .* to /)
})

test('loan maturity: far away is quiet, within a year is high, within two is medium, past is high', async () => {
  const { record, context } = await healthy()
  const term = (months) => {
    const r = structuredClone(record)
    r.data.sources.rows[0].termMonths = months
    return run(r, context).flags.find((x) => x.id === 'M3C-loan-maturity-near')
  }
  assert.equal(term(360), undefined)
  // completion 2023-06, as of 2026-01: 31 months elapsed
  assert.equal(term(31 + 6).severity, 'high')
  assert.equal(term(31 + 18).severity, 'medium')
  const past = term(24)
  assert.equal(past.severity, 'high')
  assert.match(past.title, /reached its maturity/)
})

test('a lease-up project runs only what is already actual and labels it completed', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  assert.equal(record.data.stage.stage, 'lease_up')
  const rows = checklist(record, context)
  for (const id of ['actuals', 'stability', 'vacancy']) assert.equal(rows.find((r) => r.id === id).status, 'not_applicable', id)
  const { flags, notes } = run(record, context)
  assert.ok(!ids(flags).includes('M3C-check-failed'), notes.join())
  for (const f of flags) assert.equal(f.stage_used, 'completed')
  assert.match(notes.join(' '), /Lease-up project/)
})

test('a development project gets nothing; no stage gets one low flag', async () => {
  const { record } = await load(byId('s01-healthy-development'))
  assert.deepEqual(run(record, {}).flags, [])
  assert.deepEqual(checklist(record, {}), [])
  const none = run(applyStageAndDate(record, { stage: null }), {})
  assert.equal(none.flags.length, 1)
  assert.equal(none.flags[0].severity, 'low')
})

test('the record is never changed', async () => {
  const { record, context } = await load(byId('s11-missing-t12'))
  const before = JSON.stringify(record)
  run(record, context)
  checklist(record, context)
  assert.equal(JSON.stringify(record), before)
})

test('a blank project with only a stage still runs every check without crashing', () => {
  for (const stage of ['completed', 'lease_up']) {
    const p = applyStageAndDate(blankProject(), { stage, asOfDate: '2026-01-15' })
    const { flags, notes } = run(p, {})
    assert.ok(!ids(flags).includes('M3C-check-failed'), notes.join())
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
  }
})

test('scrambled records never crash a check or produce a malformed flag', async () => {
  const { record } = await healthy()
  const base = withT12(record, t12Rows())
  const junk = [null, NaN, Infinity, -5, 1e15, 'abc', '', {}, [], true, 6.5, '2027-13', 99999]
  let seed = 4242
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const pick = (o) => {
    const keys = Object.keys(o)
    return keys[Math.floor(rand() * keys.length)]
  }
  for (let i = 0; i < 1500; i++) {
    const r = structuredClone(base)
    for (let n = 0; n < 6; n++) {
      let node = r.data[pick(r.data)]
      for (let d = 0; d < 4 && node && typeof node === 'object'; d++) {
        const k = pick(node)
        if (k === undefined) break
        if (typeof node[k] !== 'object' || node[k] === null) {
          node[k] = junk[Math.floor(rand() * junk.length)]
          break
        }
        node = node[k]
      }
    }
    for (const stage of ['completed', 'lease_up']) {
      const { flags, notes } = run(applyStageAndDate(r, { stage }), {})
      assert.ok(!ids(flags).includes('M3C-check-failed'), notes.join(' | '))
      for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    }
  }
})

test('parseMonth reads years and months and refuses anything else', () => {
  assert.equal(parseMonth('2027-06').idx, 2027 * 12 + 5)
  assert.equal(parseMonth(2027).yearOnly, true)
  assert.equal(parseMonth('soon'), null)
})
