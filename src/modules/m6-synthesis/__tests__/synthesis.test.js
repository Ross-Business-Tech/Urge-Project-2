import test from 'node:test'
import assert from 'node:assert/strict'
import { makeFlag, applyStageAndDate } from '../../shared/index.js'
import { scenarios } from '../../shared/samples/scenarios.js'
import {
  MODULE_ID,
  synthesize,
  followUpList,
  followUpText,
  layersCovered,
  run,
  downsideImpact,
  dollarsFromEvidence,
  dscrShortfallFromEvidence,
  plainText,
} from '../index.js'
import { run as runM1 } from '../../m1-integrity/index.js'
import { run as runM4 } from '../../m4-scenarios/index.js'

// A made-up project record: only the parts M6 reads.
const project = (stage = 'development', name = 'Maple Court Apartments') => ({ data: { stage: { stage, asOfDate: '2026-01-15' }, identity: { name } } })

const flag = (over) =>
  makeFlag({
    stage_used: 'development',
    severity: 'medium',
    title: 'A made-up finding.',
    evidence: 'Some numbers.',
    follow_up: 'Can you explain this?',
    ...over,
  })

// Realistic flags matching the answer key ids.
const sourcesUses = flag({
  id: 'M1-sources-uses',
  module: 'M1',
  severity: 'high',
  title: 'Sources do not equal uses.',
  evidence: 'Sources 5,200,000 vs uses 5,550,000: a 350,000 gap (6.3%).',
  cell_refs: ['Details!F42', 'Budget!G102'],
  follow_up: 'Where will the missing 350,000 come from?',
})
const contingency = flag({
  id: 'M3D-contingency-low',
  module: 'M3D',
  severity: 'high',
  title: 'The construction contingency is thin.',
  evidence: 'Contingency 1.1% of hard cost vs a 5% to 10% benchmark.',
  cell_refs: ['Budget!C14'],
  follow_up: 'Why is the contingency so small, and who covers an overrun?',
})
const dscrLow = flag({
  id: 'M3D-dscr-under-minimum',
  module: 'M3D',
  severity: 'high',
  title: 'Income does not cover the loan by the lender’s minimum.',
  evidence: 'DSCR 1.09 vs a 1.20 minimum.',
  follow_up: 'What would bring coverage up to 1.20×?',
})
const fundingGap = flag({
  id: 'M4-downside-funding-gap',
  module: 'M4',
  severity: 'high',
  title: 'In the downside case, the budget and reserves run out before the project is paid for.',
  evidence: 'Funding gap $820,000: overrun $700,000 against $400,000 of contingency. Stress: cost overrun +20%.',
  follow_up: 'In the downside case, where would the extra $820,000 come from?',
})
const residue = flag({ id: 'M1-template-residue', module: 'M1', severity: 'medium', title: 'Placeholder text left in.', evidence: 'Project name still reads the placeholder.', follow_up: 'Please send a completed form.' })
const rentHigh = flag({ id: 'M2-rent-above-comps', module: 'M2', severity: 'medium', title: 'Rents are above comparable properties.', evidence: 'Achieved rents 30% above comps.', follow_up: 'What supports rents this far above the market?' })
const missingT12 = flag({ id: 'M3C-missing-data', module: 'M3C', stage_used: 'completed', severity: 'low', title: 'Actuals could not be checked.', evidence: 'Missing: T-12', follow_up: 'Please provide the missing information: T-12' })

test('the module id and the shared interface hold', () => {
  assert.equal(MODULE_ID, 'M6')
  const r = run(project(), {})
  assert.deepEqual(r.flags, [])
  assert.ok(r.notes[0].includes('synthesize'))
})

test('ranks by severity first', () => {
  const { ranked, counts } = synthesize(project(), [
    { module: 'M3C', flags: [missingT12], notes: [] },
    { module: 'M1', flags: [residue, sourcesUses], notes: [] },
    { module: 'M2', flags: [rentHigh], notes: [] },
  ])
  assert.deepEqual(
    ranked.map((i) => i.severity),
    ['high', 'medium', 'medium', 'low'],
  )
  assert.equal(ranked[0].id, 'M1-sources-uses')
  assert.deepEqual(ranked.map((i) => i.rank), [1, 2, 3, 4])
  assert.deepEqual({ high: counts.high, medium: counts.medium, low: counts.low, total: counts.total }, { high: 1, medium: 2, low: 1, total: 4 })
})

test('within a severity, the larger downside effect comes first, then DSCR shortfall, then unknown in layer order', () => {
  const { ranked, notes } = synthesize(project(), [
    { module: 'M3D', flags: [contingency, dscrLow], notes: [] },
    { module: 'M1', flags: [sourcesUses], notes: [] },
    { module: 'M4', flags: [fundingGap], notes: [] },
  ])
  assert.deepEqual(
    ranked.map((i) => i.id),
    ['M4-downside-funding-gap', 'M1-sources-uses', 'M3D-dscr-under-minimum', 'M3D-contingency-low'],
  )
  assert.equal(ranked[0].impact.value, 820000)
  assert.equal(ranked[1].impact.value, 350000)
  assert.equal(ranked[2].impact.kind, 'dscr')
  assert.equal(ranked[3].impact.kind, 'unknown')
  assert.ok(notes.some((n) => n.includes('3 of 4 items have a known effect')))
})

test('a caller can give the downside effect directly, and a debt service turns a DSCR gap into dollars', () => {
  const ctx = { impacts: { 'M3D-contingency-low': 1_000_000 }, downside: { debtService: 500_000 } }
  const { ranked } = synthesize(project(), [{ module: 'M3D', flags: [dscrLow, contingency] }, { module: 'M1', flags: [sourcesUses] }], ctx)
  assert.deepEqual(
    ranked.map((i) => i.id),
    ['M3D-contingency-low', 'M1-sources-uses', 'M3D-dscr-under-minimum'],
  )
  assert.equal(Math.round(ranked[2].impact.value), 55000) // 0.11 × 500,000
})

test('when no effect is known, ranking says so and keeps layer order', () => {
  const { ranked, notes } = synthesize(project(), [{ module: 'M2', flags: [rentHigh] }, { module: 'M1', flags: [residue] }])
  assert.deepEqual(
    ranked.map((i) => i.id),
    ['M1-template-residue', 'M2-rent-above-comps'],
  )
  assert.ok(notes.some((n) => n.includes('None of the items say how much')))
})

test('reading dollars and DSCR from evidence never reads a percentage as money', () => {
  assert.equal(dollarsFromEvidence('Sources 5,200,000 vs uses 5,550,000: a 350,000 gap (6.3%).'), 350000)
  assert.equal(dollarsFromEvidence('Downside DSCR 0.85× (base case 1.40×). Short by $42,500 a year.'), 42500)
  assert.equal(dollarsFromEvidence('Contingency 1.1% of hard cost vs a 5% to 10% benchmark.'), null)
  assert.equal(dollarsFromEvidence('A gap of 12% in occupancy.'), null)
  assert.equal(dollarsFromEvidence(undefined), null)
  assert.ok(Math.abs(dscrShortfallFromEvidence('Base case DSCR 1.10× against the lender’s minimum of 1.20×.') - 0.1) < 1e-9)
  assert.equal(dscrShortfallFromEvidence('DSCR 2.71 vs a 1.20 minimum.'), null)
  assert.ok(Math.abs(dscrShortfallFromEvidence('DSCR 1.05×', 1.2) - 0.15) < 1e-9)
  assert.equal(downsideImpact(residue, null).kind, 'unknown')
})

test('the same id from two sources is kept once, at its most serious', () => {
  const lowCopy = flag({ ...contingency, severity: 'low', evidence: 'Older copy.' })
  const { ranked, counts, notes } = synthesize(project('lease_up'), [
    { module: 'M3D-a', flags: [lowCopy] },
    { module: 'M3D-b', flags: [contingency] },
    { module: 'M3D', flags: [contingency] },
  ])
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].severity, 'high')
  assert.equal(ranked[0].merged, 2)
  assert.equal(counts.duplicatesRemoved, 2)
  assert.ok(notes.some((n) => n.includes('2 duplicate flags removed')))
})

test('a malformed module result becomes a visible note and an M6 flag, and good flags are still kept', () => {
  const bad = [
    null,
    42,
    { module: 'M2', flags: 'oops' },
    { module: 'M3T', flags: [{ id: 'M3T-x', severity: 'critical' }, sourcesUses] },
    { module: 'nonsense', flags: [residue] },
    {
      module: 'M5',
      get flags() {
        throw new Error('boom')
      },
    },
    { module: 'M1', flags: [sourcesUses], notes: ['ran fine', 7] },
  ]
  const r = synthesize(project(), bad)
  const ids = r.ranked.map((i) => i.id)
  assert.ok(ids.includes('M1-sources-uses'))
  assert.ok(ids.includes('M1-template-residue'))
  assert.ok(ids.includes('M6-results-unreadable'))
  assert.equal(r.ranked.find((i) => i.id === 'M6-results-unreadable').severity, 'medium')
  assert.ok(r.notes.some((n) => n.includes('M2 (Benchmarking) did not return a list of flags')))
  assert.ok(r.notes.some((n) => n.includes('could not be read')))
  assert.ok(r.notes.some((n) => n.includes('M1: ran fine')))
  assert.ok(r.counts.unreadable >= 4)
  // The tool's own problem is not a question for the sponsor.
  assert.ok(!r.followUps.some((l) => l.includes('maintains this tool')))
})

test('no high flag is ever hidden or lowered', () => {
  const highs = [sourcesUses, contingency, dscrLow, fundingGap]
  const r = synthesize(project(), [{ module: 'M1', flags: [sourcesUses, residue] }, { module: 'M3D', flags: [contingency, dscrLow] }, { module: 'M4', flags: [fundingGap] }, 'garbage'])
  for (const h of highs) assert.equal(r.ranked.find((i) => i.id === h.id)?.severity, 'high', h.id)
  const firstNonHigh = r.ranked.findIndex((i) => i.severity !== 'high')
  assert.equal(firstNonHigh, highs.length)
})

test('empty and bad input never crash', () => {
  for (const input of [undefined, null, [], {}, 'text', 0, [undefined], [{}], [{ flags: null }]]) {
    for (const p of [undefined, null, {}, project(), { data: null }]) {
      const r = synthesize(p, input, input)
      assert.ok(Array.isArray(r.ranked))
      assert.ok(Array.isArray(r.followUps))
      assert.ok(Array.isArray(r.notes))
      assert.equal(typeof r.headline, 'string')
      assert.equal(typeof r.coverage.sentence, 'string')
    }
  }
  const empty = synthesize(project(), [])
  assert.equal(empty.ranked.length, 0)
  assert.equal(empty.headline, 'Nothing was flagged by the checks that ran.')
  assert.ok(synthesize(project(), undefined).notes[0].includes('No results'))
  assert.deepEqual(followUpList(undefined), [])
  assert.deepEqual(followUpList([null, 3, {}]), [])
  assert.equal(followUpText([], project()), '')
})

test('follow-up list: numbered, high first, asked once, plain text that pastes cleanly', () => {
  const sameQuestion = flag({ id: 'M2-cost-high', module: 'M2', severity: 'low', title: 'x.', evidence: 'y.', follow_up: 'Where will the missing 350,000 come from?' })
  const fancy = flag({ id: 'M4-downside-dscr-thin', module: 'M4', severity: 'medium', title: 'x.', evidence: 'y.', follow_up: 'Is there a cure if coverage dips under the lender’s 1.20× — a “guarantee”, a reserve…\nor a *cash* sweep?' })
  const { ranked, followUps } = synthesize(project(), [{ module: 'M2', flags: [sameQuestion] }, { module: 'M4', flags: [fancy] }, { module: 'M1', flags: [sourcesUses] }])
  assert.deepEqual(followUps, followUpList(ranked))
  assert.deepEqual(followUps, [
    '1. Where will the missing 350,000 come from?',
    '2. Is there a cure if coverage dips under the lender\'s 1.20x - a "guarantee", a reserve... or a cash sweep?',
  ])
  for (const line of followUps) assert.match(line, /^[\x20-\x7E]+$/, 'only plain printable characters')

  // Even if given out of order, high comes first.
  const reversed = followUpList([...ranked].reverse())
  assert.ok(reversed[0].includes('350,000'))

  const text = followUpText(ranked, project())
  assert.ok(text.startsWith('Questions about Maple Court Apartments:\n\n1. '))
  assert.equal(plainText('a b–c'), 'a b-c')
})

test('layers covered: names the layers that were not run, and layer 3 depends on the stage', () => {
  const dev = layersCovered([{ module: 'M1', flags: [] }, { module: 'M3D', flags: [] }, { module: 'M3T', flags: [] }, { module: 'M4', flags: [] }], 'development')
  assert.deepEqual(
    dev.notRun.map((l) => l.layer),
    [2, 5],
  )
  assert.ok(dev.sentence.includes('2 Benchmarking'))
  assert.ok(dev.sentence.includes('5 Sponsor and portfolio'))

  const leaseUp = layersCovered([{ module: 'M3D', flags: [] }, { module: 'M3T', flags: [] }], 'lease_up')
  const l3 = leaseUp.layers.find((l) => l.layer === 3)
  assert.equal(l3.checked, false)
  assert.equal(l3.partly, true)
  assert.deepEqual(l3.missing, ['M3C'])
  assert.ok(leaseUp.sentence.includes('completed risk not run'))

  const all = layersCovered(['M1', 'M2', 'M3C', 'M3T', 'M4', 'M5'].map((module) => ({ module, flags: [] })), 'completed')
  assert.equal(all.notRun.length, 0)
  assert.equal(all.sentence, 'All six layers were checked.')

  // A result with no flag list does not count as run; layer 6 (M6 itself) always does.
  const none = layersCovered([{ module: 'M1', flags: 'x' }], 'development')
  assert.deepEqual(
    none.notRun.map((l) => l.layer),
    [1, 2, 3, 4, 5],
  )
  assert.equal(layersCovered(null).notRun.length, 5)
})

test('a sound project under a failing sponsor says so (answer key s10)', () => {
  const liquidity = flag({ id: 'M5-firm-liquidity', module: 'M5', stage_used: 'completed', severity: 'high', title: 'The sponsor has almost no cash.', evidence: 'Firm cash 20,000 against 600,000 of payables.', follow_up: 'How would the firm cover a shortfall?' })
  const r = synthesize(project('completed'), [{ module: 'M5', flags: [liquidity] }, { module: 'M3C', flags: [missingT12] }])
  assert.equal(r.headline, 'The project looks sound on its own numbers, but the sponsor is a serious risk.')
})

// With the real M1 and M4 already on the team branch, the sample projects give realistic module results.
const recordFor = (s) => {
  const built = s.build()
  const record = built.projects[0].record
  if (s.t12) record.data.t12.rows = s.t12.rows
  return { record: applyStageAndDate(record, { stage: s.stage, asOfDate: s.asOf }), firm: built.firm }
}

test('with real module results, every sample keeps every high flag and lists each id once', () => {
  for (const s of scenarios) {
    const { record, firm } = recordFor(s)
    const results = [
      { module: 'M1', ...runM1(record, { firm }) },
      { module: 'M4', ...runM4(record, {}) },
      { module: 'M1', ...runM1(record, { firm }) }, // the same module twice: every flag is a duplicate
    ]
    const r = synthesize(record, results, {})
    const ids = r.ranked.map((i) => i.id)
    assert.equal(new Set(ids).size, ids.length, `${s.id}: duplicate ids`)
    const highIn = new Set(results.flatMap((x) => x.flags).filter((f) => f.severity === 'high').map((f) => f.id))
    for (const id of highIn) assert.equal(r.ranked.find((i) => i.id === id)?.severity, 'high', `${s.id}: ${id} lost`)
    for (const k of s.key.flags.filter((f) => f.must && ['M1', 'M4'].includes(f.module))) {
      assert.ok(ids.includes(k.id), `${s.id}: expected ${k.id}`)
    }
    assert.ok(r.coverage.sentence.includes('Not run yet'))
  }
})
