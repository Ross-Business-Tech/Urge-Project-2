import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { applyStageAndDate, compareSeverity, validateFlag } from '../../shared/index.js'
import { blankFirm } from '../../shared/records.js'
import { run } from '../index.js'

// Load a scenario the way an underwriter would: import the workbook, choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  const record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  return { record, context: { firm: out.firm, facts: out.facts, report: out.report, projects: out.projects.map((p) => (p === out.projects[0] ? record : p)) } }
}
const byId = (flags, id) => flags.find((f) => f.id === id)
const sample = (id) => scenarios.find((s) => s.id.startsWith(id))

for (const s of scenarios) {
  test(`${s.id}: M5 matches the answer key`, async () => {
    const { record, context } = await load(s)
    const { flags, notes } = run(record, context)
    assert.ok(!flags.some((f) => f.id === 'M5-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    for (const f of flags) {
      assert.deepEqual(validateFlag(f), [], f.id)
      assert.equal(f.module, 'M5')
      assert.equal(f.layer, 5)
      assert.equal(f.stage_used, s.stage)
    }
    for (const want of s.key.flags.filter((k) => k.module === 'M5')) {
      const got = byId(flags, want.id)
      assert.ok(got, `should raise ${want.id}; got ${flags.map((f) => f.id).join(', ') || 'nothing'}`)
      assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
    }
  })
}

test('only s10 raises a high or medium M5 flag; every other sample stays quiet', async () => {
  for (const s of scenarios) {
    const { record, context } = await load(s)
    const loud = run(record, context).flags.filter((f) => f.severity !== 'low')
    if (s.id.startsWith('s10')) assert.ok(loud.length > 0)
    else assert.deepEqual(loud.map((f) => f.id), [], s.id)
  }
})

test('s10: the failing firm raises the headline and every measure, each with cells and a question', async () => {
  const { record, context } = await load(sample('s10'))
  const { flags } = run(record, context)
  for (const id of ['M5-firm-health-failing', 'M5-firm-liquidity', 'M5-firm-global-dscr', 'M5-firm-fee-dependence', 'M5-firm-leverage']) {
    const f = byId(flags, id)
    assert.ok(f, id)
    assert.equal(f.severity, 'high', id)
    assert.ok(f.cell_refs.length > 0, `${id} names cells`)
    assert.ok(f.follow_up.endsWith('?'), `${id} asks a question`)
  }
  const liq = byId(flags, 'M5-firm-liquidity')
  assert.ok(liq.cell_refs.includes('Balance Sheet!B9'), 'firm cash cell')
  assert.ok(liq.cell_refs.includes('Balance Sheet!B38'), 'accounts payable cell')
  assert.match(liq.evidence, /\$20,000/)
  assert.match(liq.evidence, /\$600,000/)
  assert.match(liq.follow_up, /\$20,000 against \$600,000/)
  assert.ok(!flags.some((f) => f.id === 'M5-firm-health-weak'), 'failing, not weak')
})

test('a weak (not failing) firm raises medium flags, not high', async () => {
  const { record, context } = await load(sample('s01'))
  const bs = context.firm.data.balanceSheet.lines
  bs.cash = { current: 70_000, prior: 700_000 } // about 0.9x of 80,000 owed: weak, not failing
  const { flags } = run(record, context)
  const liq = byId(flags, 'M5-firm-liquidity')
  assert.ok(liq, 'liquidity flagged')
  assert.equal(liq.severity, 'medium')
})

test('a development project is asked about cost overruns; other stages are not', async () => {
  const dev = await load(sample('s01'))
  dev.context.firm.data.balanceSheet.lines.cash = { current: 10_000, prior: 700_000 }
  assert.match(byId(run(dev.record, dev.context).flags, 'M5-firm-liquidity').follow_up, /cost overrun/)
  const done = await load(sample('s10'))
  assert.doesNotMatch(byId(run(done.record, done.context).flags, 'M5-firm-liquidity').follow_up, /overrun/)
})

test('a measure that cannot be worked out raises one low flag naming what is missing', async () => {
  const { record, context } = await load(sample('s01'))
  context.firm.data.balanceSheet.lines.cash = { current: null, prior: null }
  const { flags } = run(record, context)
  const f = byId(flags, 'M5-firm-liquidity-missing')
  assert.ok(f)
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /No cash or investments/)
  assert.equal(flags.filter((x) => x.severity !== 'low').length, 0, 'the other measures are still healthy')
})

test('s04 and s14: broken project numbers give a low flag for global coverage, nothing louder', async () => {
  for (const id of ['s04', 's14']) {
    const { record, context } = await load(sample(id))
    const { flags } = run(record, context)
    assert.ok(byId(flags, 'M5-firm-global-dscr-missing'), id)
    assert.equal(flags.filter((x) => x.severity !== 'low').length, 0, id)
  }
})

test('a blank firm gives one low flag, not four', async () => {
  const { record, context } = await load(sample('s01'))
  const { flags } = run(record, { ...context, firm: blankFirm() })
  assert.equal(flags.length, 1)
  assert.equal(flags[0].id, 'M5-firm-missing')
  assert.equal(flags[0].severity, 'low')
})

test('no firm record and no stage are each a low flag that says what to do', async () => {
  const { record, context } = await load(sample('s01'))
  const noFirm = run(record, { ...context, firm: null })
  assert.equal(noFirm.flags[0].id, 'M5-firm-missing')
  assert.match(noFirm.flags[0].evidence, /load the applicant workbook/)
  const unstaged = run({ ...record, data: { ...record.data, stage: { ...record.data.stage, stage: null } } }, context)
  assert.equal(unstaged.flags[0].id, 'M5-stage-missing')
  assert.equal(unstaged.flags[0].severity, 'low')
})

test('the module never crashes the review: garbage in becomes one "check failed" flag', async () => {
  const { record } = await load(sample('s01'))
  const out = run(record, { firm: { data: {} } })
  assert.equal(out.flags.length, 1)
  assert.equal(out.flags[0].id, 'M5-check-failed')
  assert.equal(run(null, null).flags[0].module, 'M5')
})

test('flags are frozen and the project is never changed', async () => {
  const { record, context } = await load(sample('s10'))
  const before = JSON.stringify([record, context.firm])
  const { flags } = run(record, context)
  assert.equal(JSON.stringify([record, context.firm]), before)
  assert.ok(Object.isFrozen(flags[0]))
})

test('the headline flag comes first, before the individual measures', async () => {
  const { record, context } = await load(sample('s10'))
  assert.equal(run(record, context).flags[0].id, 'M5-firm-health-failing')
})
