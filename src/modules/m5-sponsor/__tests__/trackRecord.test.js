import test from 'node:test'
import assert from 'node:assert/strict'
import { t12Rows } from '../../shared/samples/scenarios.js'
import { healthyFirm, healthyProject } from '../../shared/samples/baseline.js'
import { applyStageAndDate } from '../../shared/index.js'
import { blankProject } from '../../shared/records.js'
import { trackRecord, monthIndex, TRACK_WEIGHTS } from '../index.js'

const done = (name, rows, stabilization = '2024-06') => {
  const p = healthyProject({ name })
  p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization }
  p.data.t12.rows = rows
  return applyStageAndDate(p, { stage: 'completed', asOfDate: '2026-01-15' })
}
const building = (name = 'New Build') => applyStageAndDate(healthyProject({ name }), { stage: 'development', asOfDate: '2026-01-15' })
const firm = () => healthyFirm()
const part = (r, id) => r.parts.find((p) => p.id === id)
const measure = (r, id, i = 0) => r.projects[i].measures.find((m) => m.id === id)

test('weights add up to 100%', () => {
  assert.ok(Math.abs(Object.values(TRACK_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9)
})

test('monthIndex reads a month, a date and a bare year (December), and refuses anything else', () => {
  assert.equal(monthIndex('2026-06'), monthIndex('2026-06-30'))
  assert.equal(monthIndex('2026'), monthIndex('2026-12'))
  assert.equal(monthIndex('2026-07') - monthIndex('2026-06'), 1)
  for (const bad of [null, undefined, '', 'June 2026', '2026-13', 2026]) assert.equal(monthIndex(bad), null, String(bad))
})

test('a project that delivered what it promised scores Strong', () => {
  const dev = building()
  const r = trackRecord(firm(), [done('Alder Court', t12Rows({})), dev], undefined, dev)
  assert.equal(r.ok, true)
  assert.equal(r.label, 'Strong')
  assert.ok(r.score >= 90, `score ${r.score}`)
  assert.equal(part(r, 'income').ok, true)
  assert.ok(Math.abs(measure(r, 'income').ratio - 1.017) < 0.01, 'T-12 NOI is about 102% of underwritten')
  assert.equal(measure(r, 'income').projected, '$586,000')
})

test('a project that fell short scores Failing, and the table says where', () => {
  const dev = building()
  const r = trackRecord(firm(), [done('Birch Row', t12Rows({ rentFactor: 0.85, occupancy: 0.85 })), dev], undefined, dev)
  assert.equal(r.label, 'Failing')
  assert.ok(r.score < 35, `score ${r.score}`)
  assert.ok(measure(r, 'income').ratio < 0.8)
  assert.equal(measure(r, 'income').status, 'concern')
  assert.ok(Math.abs(measure(r, 'rent').ratio - 0.85) < 1e-9)
  assert.match(measure(r, 'occupancy').note, /10 points below/)
  assert.equal(measure(r, 'stabilization').delivered, 'not stable yet')
})

test('a sponsor with no completed projects has no track record, and no score', () => {
  const r = trackRecord(firm(), [building()], undefined, building())
  assert.equal(r.ok, false)
  assert.equal(r.noTrackRecord, true)
  assert.match(r.reason, /no track record/)
  assert.equal(trackRecord(firm(), [], undefined, null).noTrackRecord, true)
})

test('completed projects with no T-12 are never scored from scale fit alone', () => {
  const dev = building()
  const r = trackRecord(firm(), [done('Cedar Flats', []), dev], undefined, dev)
  assert.equal(r.ok, false)
  assert.equal(r.noDeliveryEvidence, true)
  assert.equal(part(r, 'scale').ok, true, 'scale fit is still shown')
  assert.match(r.reason, /no evidence of delivery/)
})

test('budget and completion date are always "not available", with the reason', () => {
  const r = trackRecord(firm(), [done('Alder Court', t12Rows({}))], undefined, building())
  for (const id of ['budget', 'completion']) {
    const m = measure(r, id)
    assert.equal(m.status, 'unavailable')
    assert.equal(m.score, null)
    assert.ok(m.note.length > 20)
  }
})

test('stabilization: a project that passed the test late is scored by how late', () => {
  // The first four months fail the stability test; the next eight pass. Target was January 2025.
  const rows = [...t12Rows({ rentFactor: 0.5 }).slice(0, 4), ...t12Rows({}).slice(4)]
  const r = trackRecord(firm(), [done('Dover Place', rows, '2025-01')], undefined, building())
  const m = measure(r, 'stabilization')
  assert.equal(m.projected, '2025-01')
  assert.equal(m.delivered, '2025-04')
  assert.equal(m.score, 80, 'three months late')
  assert.match(m.note, /3 months after the target/)
})

test('stabilization: stable throughout a T-12 that starts before the target is on time', () => {
  const r = trackRecord(firm(), [done('Elm Court', t12Rows({}), '2025-06')], undefined, building())
  assert.equal(measure(r, 'stabilization').score, 100)
})

test('stabilization: a bare year is read as December, so a project is not called late for a mid-year date', () => {
  const rows = [...t12Rows({ rentFactor: 0.5 }).slice(0, 4), ...t12Rows({}).slice(4)]
  const r = trackRecord(firm(), [done('Fir Lane', rows, '2025')], undefined, building())
  assert.equal(measure(r, 'stabilization').score, 100, 'stable from 2025-04, before December 2025')
})

test('scale fit: a much bigger project than anything delivered scores low, a similar one scores high', () => {
  const small = done('Alder Court', t12Rows({}))
  const similar = trackRecord(firm(), [small, building()], undefined, building())
  assert.equal(part(similar, 'scale').score, 100)
  const huge = building('Big Tower')
  huge.data.sources.rows = huge.data.sources.rows.map((s) => ({ ...s, amount: typeof s.amount === 'number' ? s.amount * 3.5 : s.amount }))
  const r = trackRecord(firm(), [small, huge], undefined, huge)
  assert.ok(part(r, 'scale').step > 3.4)
  assert.ok(part(r, 'scale').score <= 10, `scale ${part(r, 'scale').score}`)
  assert.ok(r.score < trackRecord(firm(), [small, building()], undefined, building()).score)
})

test('scale fit does not apply when the project under review is itself completed', () => {
  const a = done('Alder Court', t12Rows({}))
  const r = trackRecord(firm(), [a], undefined, a)
  assert.equal(part(r, 'scale').ok, false)
  assert.equal(r.ok, true)
  assert.equal(r.used, 2, 'income and rent/occupancy; stabilization cannot be told for this T-12')
  assert.ok(!r.parts.filter((p) => p.ok).some((p) => p.id === 'scale'))
})

test('several completed projects are averaged, and a weak one pulls the score down', () => {
  const dev = building()
  const good = done('Alder Court', t12Rows({}))
  const poor = done('Birch Row', t12Rows({ rentFactor: 0.85, occupancy: 0.85 }))
  const both = trackRecord(firm(), [good, poor, dev], undefined, dev)
  const onlyGood = trackRecord(firm(), [good, dev], undefined, dev)
  assert.equal(both.summary.count, 2)
  assert.ok(both.score < onlyGood.score)
  assert.ok(both.score > trackRecord(firm(), [poor, dev], undefined, dev).score)
})

test('the Cover reporting more completed projects than are loaded is said out loud', () => {
  const f = firm()
  f.data.identity.completedProjectCount = 3
  const r = trackRecord(f, [done('Alder Court', t12Rows({}))], undefined, building())
  assert.ok(r.notes.some((n) => n.includes('Cover reports 3 completed projects, but only 1 is loaded')))
  assert.equal(r.summary.declared, 3)
})

test('projects with no stage are not counted, and the result says so', () => {
  const r = trackRecord(firm(), [done('Alder Court', t12Rows({})), healthyProject({ name: 'No Stage Yet' })], undefined, building())
  assert.equal(r.summary.count, 1)
  assert.ok(r.notes.some((n) => n.includes('no stage yet')))
})

test('odd input never crashes and never gives NaN: a blank completed project, a missing firm, no settings', () => {
  const blank = applyStageAndDate(blankProject(), { stage: 'completed', asOfDate: '2026-01-15' })
  const r = trackRecord(null, [blank], undefined, undefined)
  assert.equal(r.ok, false)
  assert.ok(r.projects[0].measures.every((m) => m.score === null || Number.isFinite(m.score)))
  assert.equal(trackRecord(firm(), undefined, undefined, undefined).noTrackRecord, true)
  const odd = done('Odd', t12Rows({}))
  odd.data.t12.rows = [{ month: 'not a month', residentialRevenue: 5 }, { month: null }]
  assert.doesNotThrow(() => trackRecord(firm(), [odd], undefined, building()))
})

test('the records are never changed', () => {
  const dev = building()
  const a = done('Alder Court', t12Rows({}))
  const before = JSON.stringify([a, dev, firm()])
  trackRecord(firm(), [a, dev], undefined, dev)
  assert.equal(JSON.stringify([a, dev, firm()]), before)
})
