import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios, t12Rows } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { applyStageAndDate, replaceT12Rows, compareSeverity, validateFlag, blankProject } from '../../shared/index.js'
import { run, checklist, summary } from '../index.js'
import { parseMonth } from '../checks.js'

async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return { record, context: { firm: out.firm } }
}
const byId = (id) => scenarios.find((x) => x.id === id)
const ids = (flags) => flags.map((f) => f.id)
const withT12 = (record, rows) => replaceT12Rows(record, parseT12Template(buildT12Template({ rows })))
const asStage = (record, stage) => applyStageAndDate(record, { stage })
const edit = (record, fn) => {
  const r = structuredClone(record)
  fn(r)
  return r
}

for (const s of scenarios) {
  test(`${s.id}: M3T matches the answer key`, async () => {
    const { record, context } = await load(s)
    const { flags, notes } = run(record, context)
    assert.ok(!ids(flags).includes('M3T-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const want of s.key.flags.filter((k) => k.module === 'M3T')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}: ${got?.evidence}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${ids(flags).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy development and completed controls raise no high or medium flag', async () => {
  for (const id of ['s01-healthy-development', 's10-healthy-project-failing-firm']) {
    const { record, context } = await load(byId(id))
    const bad = run(record, context).flags.filter((f) => f.severity !== 'low')
    assert.deepEqual(bad.map((f) => `${f.id}: ${f.evidence}`), [], id)
  }
})

test('high rent with low occupancy: high, with the numbers, and the stability test can still pass', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const f = run(record, context).flags.find((x) => x.id === 'M3T-high-rent-low-occupancy')
  assert.equal(f.severity, 'high')
  assert.equal(f.transition, 'T2')
  assert.match(f.evidence, /82%/)
  assert.match(f.evidence, /90% floor/)
  assert.ok(f.cell_refs.length > 0)
})

test('high rent alone, or low occupancy alone, is not that flag', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const fullButExpensive = withT12(record, t12Rows({ months: 6, occupancy: 0.95, rentFactor: 1.3 }))
  assert.ok(!ids(run(fullButExpensive, context).flags).includes('M3T-high-rent-low-occupancy'))
  const emptyButCheap = withT12(record, t12Rows({ months: 6, occupancy: 0.82, rentFactor: 1.0 }))
  assert.ok(!ids(run(emptyButCheap, context).flags).includes('M3T-high-rent-low-occupancy'))
})

test('every flag from a transition check says which transition it is about', async () => {
  for (const id of ['s01-healthy-development', 's09-passes-dscr-low-occupancy-high-rent', 's10-healthy-project-failing-firm']) {
    const { record, context } = await load(byId(id))
    for (const r of checklist(record, context)) {
      for (const f of r.flags.filter((x) => !x.id.endsWith('-missing'))) assert.equal(f.transition, r.transition, f.id)
    }
  }
})

test('each stage runs its own hand-off and leaves the others', async () => {
  const dev = await load(byId('s01-healthy-development'))
  const lease = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const done = await load(byId('s10-healthy-project-failing-firm'))
  const status = (rows, id) => rows.find((r) => r.id === id).status
  const d = checklist(dev.record, dev.context)
  assert.notEqual(status(d, 'delivery-date'), 'not_applicable')
  assert.equal(status(d, 'pace'), 'not_applicable')
  assert.equal(status(d, 'refinance'), 'not_applicable')
  const l = checklist(lease.record, lease.context)
  assert.equal(status(l, 'delivery-date'), 'not_applicable')
  assert.notEqual(status(l, 'pace'), 'not_applicable')
  assert.equal(status(l, 'refinance'), 'not_applicable')
  const c = checklist(done.record, done.context)
  assert.equal(status(c, 'pace'), 'not_applicable')
  assert.equal(status(c, 'refinance'), 'pass')
})

test('T1: a passed completion date is medium; a thin reserve against a delay is flagged', async () => {
  const { record, context } = await load(byId('s01-healthy-development'))
  const late = edit(record, (r) => (r.data.timeline.constructionCompletion = '2025-06'))
  const f = run(late, context).flags.find((x) => x.id === 'M3T-delivery-overdue')
  assert.equal(f.severity, 'medium')
  assert.equal(f.transition, 'T1')
  const thin = edit(record, (r) => {
    r.data.budget.lines.rentUpReserve.amount = 20000
    r.data.budget.lines.operatingReserve.amount = 20000
  })
  const g = run(thin, context).flags.find((x) => x.id === 'M3T-delivery-delay-buffer')
  assert.equal(g.severity, 'high')
  assert.match(g.evidence, /6 months of delay/)
})

test('T2: a stalled lease-up is high; a slow one is late; a fast one is fine', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const rising = (start, step, n = 6) => t12Rows({ months: n }).map((r, i) => ({ ...r, occupancy: Math.min(1, start + step * i) }))
  const stalled = run(record, context).flags.find((x) => x.id === 'M3T-occupancy-stalled')
  assert.equal(stalled.severity, 'high')
  // 40% rising 1 point a month needs ~45 more months: far later than the underwritten 2028-03
  const slow = run(withT12(record, rising(0.4, 0.01)), context).flags.find((x) => x.id === 'M3T-stabilization-late')
  assert.equal(slow.severity, 'high')
  assert.equal(slow.transition, 'T2')
  // 60% rising 8 points a month reaches 90% in 2 months
  const fast = run(withT12(record, rising(0.6, 0.08)), context).flags
  assert.ok(!ids(fast).includes('M3T-stabilization-late') && !ids(fast).includes('M3T-occupancy-stalled'))
})

test('T2: heavy concessions are flagged by size', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const give = (share) => withT12(record, t12Rows({ months: 6, occupancy: 0.92 }).map((r) => ({ ...r, concessions: Math.round(r.residentialRevenue * share) })))
  assert.equal(run(give(0.07), context).flags.find((x) => x.id === 'M3T-concessions-heavy').severity, 'medium')
  assert.equal(run(give(0.15), context).flags.find((x) => x.id === 'M3T-concessions-heavy').severity, 'high')
  assert.ok(!ids(run(give(0.02), context).flags).includes('M3T-concessions-heavy'))
})

test('T2: a loan due before the estimated stabilization is high', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const rising = t12Rows({ months: 6 }).map((r, i) => ({ ...r, occupancy: 0.6 + 0.04 * i }))
  // loan assumed to start at completion (2024-06); a 12-month term is due 2025-06, before the estimated 2025-12 stabilization
  const short = edit(withT12(record, rising), (r) => {
    r.data.timeline.constructionCompletion = '2024-06'
    r.data.sources.rows[0].termMonths = 12
  })
  const f = run(short, context).flags.find((x) => x.id === 'M3T-stabilization-after-maturity')
  assert.equal(f.severity, 'high')
  assert.equal(f.transition, 'T2')
})

test('T3: a loan due soon is tested at a higher rate; one far away is not', async () => {
  const { record, context } = await load(byId('s10-healthy-project-failing-firm'))
  const far = run(record, context).flags
  assert.ok(!ids(far).some((id) => id.startsWith('M3T-refinance')))
  // completion 2023-06, as of 2026-01: a 40-month term is due in 9 months, on 3,000,000 of debt over 40 months (the old terms)
  const soon = edit(record, (r) => (r.data.sources.rows[0].termMonths = 40))
  assert.ok(!ids(run(soon, context).flags).includes('M3T-refinance-dscr-short'), 'the healthy income still covers a refinance')
  const weak = edit(withT12(soon, t12Rows({ rentFactor: 0.5 })), (r) => (r.data.sources.rows[0].termMonths = 40))
  const f = run(weak, context).flags.find((x) => x.id === 'M3T-refinance-dscr-short')
  assert.equal(f.severity, 'high')
  assert.equal(f.transition, 'T3')
  assert.match(f.evidence, /today's 6%/)
})

test('T3: a low debt yield is flagged', async () => {
  const { record, context } = await load(byId('s10-healthy-project-failing-firm'))
  const f = edit(record, (r) => {
    r.data.sources.rows[0].termMonths = 40
    r.data.sources.rows[0].amount = 9000000
    r.data.sources.rows[0].interestRate = 0.01
  })
  assert.ok(ids(run(f, context).flags).includes('M3T-refinance-debt-yield-low'))
})

test('the next-transition summary names the next hand-off, when, and what must be true', async () => {
  const dev = await load(byId('s01-healthy-development'))
  const a = summary(dev.record, dev.context).next
  assert.equal(a.transition, 'T1')
  assert.equal(a.when.text, '2027-06')
  assert.equal(a.when.monthsAway, 17)
  assert.ok(a.mustBeTrue.length >= 3)
  assert.equal(a.status, 'on_track')

  const lease = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const b = summary(lease.record, lease.context).next
  assert.equal(b.transition, 'T2')
  assert.equal(b.status, 'at_risk')
  assert.ok(b.flagIds.includes('M3T-high-rent-low-occupancy'))

  const done = await load(byId('s10-healthy-project-failing-firm'))
  const c = summary(done.record, done.context).next
  assert.equal(c.transition, 'T3')
  assert.match(c.when.text, /^\d{4}-\d{2}$/)
  assert.match(run(done.record, done.context).notes.join(' '), /Next transition: T3/)
})

test('missing data: low flags, never a crash; no stage: one low flag', async () => {
  const lease = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const noT12 = edit(lease.record, (r) => (r.data.t12.rows = []))
  const { flags, notes } = run(noT12, lease.context)
  assert.ok(!ids(flags).includes('M3T-check-failed'), notes.join())
  assert.ok(flags.some((f) => f.id === 'M3T-pace-missing' && f.severity === 'low'))
  const none = run(applyStageAndDate(lease.record, { stage: null }), {})
  assert.equal(none.flags.length, 1)
  assert.equal(none.flags[0].severity, 'low')
})

test('the record is never changed', async () => {
  const { record, context } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const before = JSON.stringify(record)
  run(record, context)
  summary(record, context)
  assert.equal(JSON.stringify(record), before)
})

test('a blank project with only a stage runs every check without crashing', () => {
  for (const stage of ['development', 'lease_up', 'completed']) {
    const p = applyStageAndDate(blankProject(), { stage, asOfDate: '2026-01-15' })
    const { flags, notes } = run(p, {})
    assert.ok(!ids(flags).includes('M3T-check-failed'), notes.join())
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
  }
})

test('scrambled records never crash a check or produce a malformed flag', async () => {
  const { record } = await load(byId('s09-passes-dscr-low-occupancy-high-rent'))
  const junk = [null, NaN, Infinity, -5, 1e15, 'abc', '', {}, [], true, 6.5, '2027-13', 99999]
  let seed = 777
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const pick = (o) => {
    const keys = Object.keys(o)
    return keys[Math.floor(rand() * keys.length)]
  }
  for (let i = 0; i < 1500; i++) {
    const r = structuredClone(record)
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
    for (const stage of ['development', 'lease_up', 'completed']) {
      const { flags, notes } = run(asStage(r, stage), {})
      assert.ok(!ids(flags).includes('M3T-check-failed'), notes.join(' | '))
      for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    }
  }
})

test('parseMonth reads years and months and refuses anything else', () => {
  assert.equal(parseMonth('2027-06').idx, 2027 * 12 + 5)
  assert.equal(parseMonth(2027).yearOnly, true)
  assert.equal(parseMonth('soon'), null)
})
