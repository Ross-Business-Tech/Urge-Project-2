// The demo pack (sample-files/demo): one clean firm, a healthy new building that raises nothing, and an unhealthy new building that
// raises a wide spread of findings. If a change to a check makes the healthy project raise a finding, or the unhealthy one look
// fine, the demo no longer shows what it promises, and this fails.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseReview } from '../reviewFile.js'
import { parseEntries, usableEntries, problemsByEntry, toBenchmarkSets, DEFAULT_SETTINGS } from '../index.js'
import { demoReadyResult, demoReviewText } from '../samples/demoReview.js'
import { DEMO_BENCHMARKS, DEMO_AS_OF } from '../samples/demoPack.js'
import { collectFlags } from '../../m6-ai/collect.js'

const file = (name) => readFileSync(new URL(`../../../../sample-files/demo/${name}`, import.meta.url), 'utf8')
const HEALTHY = 'Maple Court Apartments'
const UNHEALTHY = 'Harbor Point Towers'

async function flagsFor(name) {
  const result = await demoReadyResult()
  const record = result.projects.find((p) => p.data.identity.name === name)
  const bm = { benchmarks: DEMO_BENCHMARKS, benchmarkSets: toBenchmarkSets(DEMO_BENCHMARKS) }
  return collectFlags(record, { firm: result.firm, settings: { ...DEFAULT_SETTINGS }, result: { ...result, settings: { ...DEFAULT_SETTINGS } }, bm }).flags
}

test('the saved review opens, with every stage and date chosen and the finished projects’ T-12s loaded', () => {
  const review = parseReview(file('demo-review.json'))
  assert.deepEqual(review.projects.map((p) => p.data.identity.name), [HEALTHY, UNHEALTHY, 'Alder Court', 'Willow Street Flats', 'Maple Row Townhomes'])
  for (const p of review.projects) assert.equal(p.data.stage.asOfDate, DEMO_AS_OF, p.data.identity.name)
  assert.deepEqual(review.projects.map((p) => p.data.stage.stage), ['development', 'development', 'completed', 'completed', 'completed'])
  assert.deepEqual(review.projects.map((p) => p.data.t12.rows.length), [0, 0, 12, 12, 12])
})

test('the committed review is exactly what the builder produces', async () => {
  assert.equal(file('demo-review.json'), await demoReviewText())
})

test('the demo benchmarks file opens and every range is usable', () => {
  const read = parseEntries(file('demo-benchmarks.json'))
  assert.equal(read.ok, true)
  assert.deepEqual(problemsByEntry(read.entries), {})
  assert.equal(usableEntries(read.entries).length, DEMO_BENCHMARKS.length)
  assert.equal(DEMO_BENCHMARKS.length, 19)
})

test('the healthy project raises no finding from any check, with the demo benchmarks', async () => {
  assert.deepEqual((await flagsFor(HEALTHY)).map((f) => `${f.severity} ${f.id}`), [])
})

test('the firm is clean: no sponsor finding on either new building', async () => {
  for (const name of [HEALTHY, UNHEALTHY]) assert.deepEqual((await flagsFor(name)).filter((f) => f.module === 'M5').map((f) => f.id), [], name)
})

test('the unhealthy project raises a wide spread of findings, across every kind of check', async () => {
  const flags = await flagsFor(UNHEALTHY)
  const ids = new Set(flags.map((f) => f.id))
  for (const want of [
    'M1-sources-uses', 'M1-typed-over-formula', // the workbook does not add up
    'M2-rent-above-comps', 'M2-yours-coverage-below', 'M2-yours-equity-share-below', // against your benchmarks
    'M3D-contingency-low', 'M3D-dscr-under-minimum', 'M3D-completion-slipped', 'M3D-lien-priority', 'M3D-team-incomplete', 'M3D-loan-matures-early', // development risk
    'M3T-delivery-overdue', // stage change
    'M4-downside-dscr-shortfall', 'M4-downside-funding-gap', // scenarios
  ]) assert.ok(ids.has(want), `should raise ${want}; got ${[...ids].join(', ')}`)
  assert.ok(flags.filter((f) => f.severity === 'high').length >= 10, 'at least ten high findings')
  assert.ok(new Set(flags.map((f) => f.module)).size >= 4, 'findings come from at least four different checks')
})

test('the figures quoted in the demo script are true', async () => {
  const result = await demoReadyResult()
  const find = (name) => result.projects.find((p) => p.data.identity.name === name)
  const { keyRatios } = await import('../index.js')
  const ratio = (name, id) => keyRatios(find(name), DEFAULT_SETTINGS).find((r) => r.id === id).value
  assert.equal(ratio(HEALTHY, 'dscr').toFixed(2), '1.93')
  assert.equal(ratio(UNHEALTHY, 'dscr').toFixed(2), '0.91')
  const flags = await flagsFor(UNHEALTHY)
  assert.match(flags.find((f) => f.id === 'M1-sources-uses').follow_up, /\$900,000/)
})
