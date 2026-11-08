import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { applyStageAndDate, compareSeverity, validateFlag } from '../../shared/index.js'
import { blankFirm } from '../../shared/records.js'
import { healthyFirm, healthyProject } from '../../shared/samples/baseline.js'
import { t12Rows } from '../../shared/samples/scenarios.js'
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

// The development samples have no completed projects, so they rightly raise the "no track record" flag (medium for a project
// still being built). Apart from that, only s10 raises anything above low.
const loud = (flags) => flags.filter((f) => f.severity !== 'low' && f.id !== 'M5-no-track-record')

test('only s10 raises a high or medium M5 flag (apart from "no track record"); every other sample stays quiet', async () => {
  for (const s of scenarios) {
    const { record, context } = await load(s)
    const flags = run(record, context).flags
    if (s.id.startsWith('s10')) assert.ok(loud(flags).length > 0)
    else assert.deepEqual(loud(flags).map((f) => f.id), [], s.id)
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
  assert.equal(loud(flags).length, 0, 'the other measures are still healthy')
})

test('s04 and s14: broken project numbers give a low flag for global coverage, nothing louder', async () => {
  for (const id of ['s04', 's14']) {
    const { record, context } = await load(sample(id))
    const { flags } = run(record, context)
    assert.ok(byId(flags, 'M5-firm-global-dscr-missing'), id)
    assert.equal(loud(flags).length, 0, id)
  }
})

test('a blank firm gives one low flag about the firm, not four', async () => {
  const { record, context } = await load(sample('s01'))
  const { flags } = run(record, { ...context, firm: blankFirm() })
  const firmFlags = flags.filter((f) => f.id.startsWith('M5-firm'))
  assert.equal(firmFlags.length, 1)
  assert.equal(firmFlags[0].id, 'M5-firm-missing')
  assert.equal(firmFlags[0].severity, 'low')
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

// ---- Track record flags (M5-b) ---------------------------------------------------------------

const finished = (name, rows, { stabilization = '2025-03', size = 1 } = {}) => {
  const p = healthyProject({ name })
  p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization }
  p.data.t12.rows = rows
  if (size !== 1) p.data.sources.rows = p.data.sources.rows.map((x) => ({ ...x, amount: typeof x.amount === 'number' ? x.amount * size : x.amount }))
  return applyStageAndDate(p, { stage: 'completed', asOfDate: '2026-01-15' })
}
const underway = (stage = 'development') => applyStageAndDate(healthyProject({ name: 'Harbor View Lofts' }), { stage, asOfDate: '2026-01-15' })
const POOR = () => t12Rows({ rentFactor: 0.85, occupancy: 0.85 })
const review = (reviewed, others, firm = healthyFirm()) => run(reviewed, { firm, projects: [reviewed, ...others] })

test('no completed projects: a medium flag for a project still being built, a low note for other stages', () => {
  const dev = review(underway('development'), []).flags.find((f) => f.id === 'M5-no-track-record')
  assert.equal(dev.severity, 'medium')
  assert.match(dev.follow_up, /who else .* carries the delivery risk/)
  assert.deepEqual(validateFlag(dev), [])
  for (const stage of ['lease_up', 'completed']) {
    // a completed project under review is itself a completed project, so only lease-up can be checked here
    if (stage === 'completed') continue
    const f = review(underway(stage), []).flags.find((x) => x.id === 'M5-no-track-record')
    assert.equal(f.severity, 'low', stage)
    assert.match(f.follow_up, /provide the sponsor’s completed projects/)
  }
})

test('a project that fell short raises its own flag, even when the average looks fine', () => {
  const dev = underway()
  const { flags } = review(dev, [finished('Alder Court', t12Rows({})), finished('Birch Row', POOR())])
  const f = flags.find((x) => x.id === 'M5-delivery-shortfall-birch-row')
  assert.ok(f, flags.map((x) => x.id).join(', '))
  assert.equal(f.severity, 'high')
  assert.deepEqual(validateFlag(f), [])
  assert.match(f.title, /Birch Row/)
  assert.match(f.evidence, /Income \(NOI, a year\): promised \$586,000, delivered \$432,192/)
  assert.ok(f.cell_refs.length > 0, 'names the underwriting cells')
  assert.match(f.follow_up, /What caused it/)
  assert.match(f.follow_up, /T-12 NOI is 74% of underwritten/, 'acronyms keep their capitals in the question for the sponsor')
  assert.ok(!flags.some((x) => x.id === 'M5-delivery-shortfall-alder-court'), 'the good project is not flagged')
  assert.ok(!flags.some((x) => x.id.startsWith('M5-track-record-')), 'the average (64) is not low enough to flag')
})

test('every completed project that fell short is flagged separately, with a different id', () => {
  const { flags } = review(underway(), [finished('Birch Row', POOR()), finished('Cedar Flats', POOR())])
  const ids = flags.filter((f) => f.id.startsWith('M5-delivery-shortfall')).map((f) => f.id)
  assert.deepEqual(ids.sort(), ['M5-delivery-shortfall-birch-row', 'M5-delivery-shortfall-cedar-flats'])
})

test('a poor record overall raises the headline credibility flag', () => {
  const { flags } = review(underway(), [finished('Birch Row', POOR()), finished('Cedar Flats', POOR())])
  const f = flags.find((x) => x.id === 'M5-track-record-failing')
  assert.ok(f)
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /Credibility \d+\/100 \(Failing\) from 2 completed projects/)
  assert.deepEqual(validateFlag(f), [])
})

test('a good record raises no track record flag at all', () => {
  const { flags } = review(underway(), [finished('Alder Court', t12Rows({})), finished('Willow Street', t12Rows({ occupancy: 0.96 }))])
  assert.deepEqual(flags.filter((f) => /^M5-(delivery|track|scale|no-track)/.test(f.id)).map((f) => f.id), [])
})

test('a big step up in size is flagged, with the multiple in the question', () => {
  const { flags } = review(underway(), [finished('Alder Court', t12Rows({}), { size: 0.25 })])
  const f = flags.find((x) => x.id === 'M5-scale-step-up')
  assert.ok(f)
  assert.ok(f.severity === 'high' || f.severity === 'medium')
  assert.match(f.follow_up, /4\.0× the largest/)
  assert.ok(!flags.some((x) => x.id.startsWith('M5-delivery-shortfall')), 'the past project itself was fine')
})

test('completed projects with no T-12 raise one low "could not be checked" flag, never a delivery flag', () => {
  const { flags } = review(underway(), [finished('Cedar Flats', [])])
  const f = flags.find((x) => x.id === 'M5-track-record-missing')
  assert.ok(f)
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /load a T-12 for each completed project/)
  assert.ok(!flags.some((x) => x.id.startsWith('M5-delivery-shortfall')))
})

test('the Cover reporting more completed projects than are loaded raises a low flag', () => {
  const firm = healthyFirm()
  firm.data.identity.completedProjectCount = 3
  const { flags } = review(underway(), [finished('Alder Court', t12Rows({}))], firm)
  const f = flags.find((x) => x.id === 'M5-track-record-partial')
  assert.ok(f)
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /reports 3 completed projects, but 1 is loaded/)
})

test('the track record flags still run when the firm record is blank', () => {
  const { flags } = review(underway(), [finished('Birch Row', POOR()), finished('Cedar Flats', POOR())], blankFirm())
  assert.ok(flags.some((f) => f.id === 'M5-firm-missing'))
  assert.ok(flags.some((f) => f.id === 'M5-track-record-failing'))
})

test('every track record flag passes the shared flag checks and the module is never changed by running', () => {
  const dev = underway()
  const others = [finished('Alder Court', t12Rows({}), { size: 0.25 }), finished('Birch Row', POOR())]
  const before = JSON.stringify([dev, others])
  const { flags } = review(dev, others)
  assert.equal(JSON.stringify([dev, others]), before)
  for (const f of flags) {
    assert.deepEqual(validateFlag(f), [], f.id)
    assert.ok(!f.id.endsWith('check-failed'), f.id)
  }
})
