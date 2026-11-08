import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { applyStageAndDate, compareSeverity, validateFlag, blankProject } from '../../shared/index.js'
import { run, checklist } from '../index.js'
import { parseMonth } from '../checks.js'

// Load a scenario the way an underwriter would: import the workbook, then choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  const record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  return { record, context: { firm: out.firm } }
}
const byId = (id) => scenarios.find((x) => x.id === id)
const ids = (flags) => flags.map((f) => f.id)

for (const s of scenarios) {
  test(`${s.id}: M3D matches the answer key`, async () => {
    const { record, context } = await load(s)
    const { flags, notes } = run(record, context)
    assert.ok(!ids(flags).includes('M3D-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const want of s.key.flags.filter((k) => k.module === 'M3D')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}: ${got?.evidence}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${ids(flags).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy control raises no high or medium flag', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const bad = run(record, context).flags.filter((f) => f.severity !== 'low')
  assert.deepEqual(bad.map((f) => `${f.id}: ${f.evidence}`), [])
})

test('thin contingency: high, names the contingency cells and asks the sponsor', async () => {
  const { record, context } = await load(byId('s03-thin-contingency'))
  const f = run(record, context).flags.find((x) => x.id === 'M3D-contingency-low')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /1\.1% of hard cost vs\. 5% to 10%/)
  assert.ok(f.cell_refs.some((c) => c.includes('Budget!G40')), f.cell_refs.join())
  assert.match(f.follow_up, /contingency/)
  assert.equal(f.stage_used, 'development')
})

test('a generous contingency is never flagged', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  record.data.budget.lines.constructionContingency.amount = 900000
  assert.ok(!ids(run(record, context).flags).includes('M3D-contingency-low'))
})

test('DSCR under the minimum: high, with the numbers', async () => {
  const { record, context } = await load(byId('s08-dscr-under-minimum'))
  const f = run(record, context).flags.find((x) => x.id === 'M3D-dscr-under-minimum')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /1\.09× vs\. 1\.20×/)
  const ok = await load(byId('s01-healthy-development'))
  assert.ok(!ids(run(ok.record, ok.context).flags).includes('M3D-dscr-under-minimum'))
})

test('the whole cost borrowed is flagged as debt-to-cost and as short reserves', async () => {
  const { record, context } = await load(byId('s08-dscr-under-minimum'))
  const got = ids(run(record, context).flags)
  assert.ok(got.includes('M3D-debt-to-cost-high'))
  assert.ok(got.includes('M3D-interest-reserve-short'))
})

test('a missing input gives a low "could not be checked" flag, never a crash', async () => {
  const { record, context } = await load(byId('s04-error-cells'))
  const { flags, notes } = run(record, context)
  assert.ok(!ids(flags).includes('M3D-check-failed'), notes.join())
  const missing = flags.filter((f) => f.id.endsWith('-missing'))
  assert.ok(missing.length > 0)
  assert.ok(missing.every((f) => f.severity === 'low'))
})

test('a blank project with only a stage still runs every check without crashing', () => {
  for (const stage of ['development', 'lease_up']) {
    const p = applyStageAndDate(blankProject(), { stage, asOfDate: '2026-01-15' })
    const { flags, notes } = run(p, {})
    assert.ok(!ids(flags).includes('M3D-check-failed'), notes.join())
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
  }
})

test('no stage: one low flag. Completed: nothing to say.', async () => {
  const s01 = await load(byId('s01-healthy-development'))
  const none = applyStageAndDate(s01.record, { stage: null })
  const r = run(none, {})
  assert.equal(r.flags.length, 1)
  assert.equal(r.flags[0].severity, 'low')
  const done = applyStageAndDate(s01.record, { stage: 'completed' })
  assert.deepEqual(run(done, {}).flags, [])
  assert.deepEqual(checklist(done, {}), [])
})

test('the stage and the record are never changed', async () => {
  const { record, context } = await load(byId('s08-dscr-under-minimum'))
  const before = JSON.stringify(record)
  run(record, context)
  checklist(record, context)
  assert.equal(JSON.stringify(record), before)
})

test('schedule: dates out of order are high; an odd construction length is medium', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const flip = applyStageAndDate(record, {})
  flip.data = { ...record.data, timeline: { constructionStart: '2027-06', constructionCompletion: '2026-03', stabilization: '2028-03' } }
  const f = run(flip, context).flags.find((x) => x.id === 'M3D-schedule-inconsistent')
  assert.equal(f.severity, 'high')
  const quick = { ...record, data: { ...record.data, timeline: { constructionStart: '2026-03', constructionCompletion: '2026-06', stabilization: '2028-03' } } }
  const q = run(quick, context).flags.find((x) => x.id === 'M3D-construction-length')
  assert.equal(q.severity, 'medium')
  const years = { ...record, data: { ...record.data, timeline: { constructionStart: 2026, constructionCompletion: 2027, stabilization: 2028 } } }
  const flagsY = run(years, context).flags
  assert.ok(!ids(flagsY).includes('M3D-schedule-inconsistent') && !ids(flagsY).includes('M3D-construction-length'))
})

test('loan maturing before stabilization is high', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const short = structuredClone(record)
  short.data.sources.rows[0].termMonths = 12
  const f = run(short, context).flags.find((x) => x.id === 'M3D-loan-matures-early')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /12 months vs\. 24 months/)
})

test('lien priority: missing ranks are low, a mezzanine loan ahead of the senior loan is medium', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const two = structuredClone(record)
  two.data.sources.rows.push({ lienPriority: null, name: 'Mezz Fund', type: 'mezzanine_debt', amount: 100000, termMonths: 360, interestRate: 0.1, paymentOverride: null })
  assert.equal(run(two, context).flags.find((x) => x.id === 'M3D-lien-priority-unclear').severity, 'low')
  two.data.sources.rows[3].lienPriority = 0.5
  const f = run(two, context).flags.find((x) => x.id === 'M3D-mezzanine-ahead-of-senior')
  assert.equal(f.severity, 'medium')
})

test('sponsor fees above the limit are medium and say how much is deferred', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const heavy = structuredClone(record)
  heavy.data.budget.lines.developerFee.amount = 1200000
  const f = run(heavy, context).flags.find((x) => x.id === 'M3D-sponsor-fees-high')
  assert.equal(f.severity, 'medium')
  assert.match(f.evidence, /\$550,000 is deferred/)
})

test('cost per square foot: too high is medium or high, too low is low', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const rich = structuredClone(record)
  rich.data.budget.lines.concreteMasonry.amount = 9000000
  const f = run(rich, context).flags.find((x) => x.id === 'M3D-cost-per-sqft-high')
  assert.ok(f && f.severity !== 'low')
  const base = run(record, context).flags.find((x) => x.id === 'M3D-cost-per-sqft-low')
  assert.equal(base?.severity, 'low')
})

test('a lease-up project runs only the projected parts and labels them development', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  assert.equal(record.data.stage.stage, 'lease_up')
  const rows = checklist(record, context)
  assert.equal(rows.find((r) => r.id === 'contingency').status, 'not_applicable')
  assert.equal(rows.find((r) => r.id === 'cost-per-sqft').status, 'not_applicable')
  const { flags, notes } = run(record, context)
  assert.ok(!ids(flags).includes('M3D-check-failed'), notes.join())
  for (const f of flags) assert.equal(f.stage_used, 'development')
  assert.match(notes.join(' '), /Lease-up project/)
})

test('parseMonth reads years and months and refuses anything else', () => {
  assert.deepEqual(parseMonth('2027-06'), { idx: 2027 * 12 + 5, yearOnly: false, text: '2027-06' })
  assert.equal(parseMonth(2027).yearOnly, true)
  assert.equal(parseMonth('2027').yearOnly, true)
  assert.equal(parseMonth('soon'), null)
  assert.equal(parseMonth(null), null)
})
