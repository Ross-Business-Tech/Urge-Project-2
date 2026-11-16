// Draws the real Benchmarks screen and the comparison table, with and without benchmarks entered, so a mistake that only shows
// when the page is drawn is caught here, and so nothing on them calls the team's own numbers made-up.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { healthyProject } from '../../shared/samples/baseline.js'
import { applyStageAndDate, serializeEntries } from '../../shared/index.js'

let server
let Provider
let Editor
let Table
let Impact
before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  ;({ BenchmarksProvider: Provider } = await server.ssrLoadModule('/src/BenchmarksProvider.jsx'))
  ;({ default: Editor } = await server.ssrLoadModule('/src/modules/m2-benchmarks/BenchmarksEditor.jsx'))
  ;({ default: Table } = await server.ssrLoadModule('/src/modules/m2-benchmarks/BenchmarkTable.jsx'))
  ;({ default: Impact } = await server.ssrLoadModule('/src/BenchmarkImpact.jsx'))
})
after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '').replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ')
const memory = (entries, changedAt) => ({ getItem: () => (entries ? serializeEntries(entries, '', changedAt) : null), setItem: () => {} })
const record = () => applyStageAndDate(healthyProject(), { stage: 'development', asOfDate: '2026-01-15' })
const withProvider = (entries, child, changedAt) => createElement(Provider, { storage: memory(entries, changedAt) }, child)
const MADE_UP = /made-up|made up|sample numbers|not real market data/i

test('with nothing entered the Benchmarks screen says so and offers to add one', () => {
  const text = plain(renderToString(withProvider(null, createElement(Editor))))
  assert.match(text, /You have not entered any benchmarks yet, so nothing is compared/)
  assert.match(text, /What do you want to compare\?/)
  assert.match(text, /Add benchmark/)
  assert.doesNotMatch(text, MADE_UP)
})

test('saved benchmarks are shown when the screen opens, with a message for any that are wrong', () => {
  const saved = [
    { id: 'a', metric: 'interestRate', low: 0.05, high: 0.065, typical: null },
    { id: 'b', metric: 'dscr', low: 2, high: 1, typical: null },
    { id: 'c', metric: 'rent', unitType: '2br', ami: '60', low: 900, high: 1100, typical: null },
  ]
  const html = renderToString(withProvider(saved, createElement(Editor)))
  const text = plain(html)
  assert.match(text, /2 of 3 benchmarks are in use/)
  assert.match(text, /Interest rate \(average of the loans\)/)
  assert.match(text, /The low figure is above the high figure\./)
  assert.match(html, /value="5"/, 'a percentage is shown as typed (5, not 0.05)')
  assert.match(html, /value="6\.5"/)
  assert.match(html, /value="2br"/)
  assert.doesNotMatch(text, MADE_UP)
})

test('the comparison table asks for benchmarks when none are entered, and does not fall back to built-in numbers', () => {
  const text = plain(renderToString(withProvider(null, createElement(Table, { record: record(), onOpenBenchmarks: () => {} }))))
  assert.match(text, /You have not entered any benchmarks, so nothing here is compared/)
  assert.match(text, /Enter your benchmarks/)
  assert.doesNotMatch(text, MADE_UP)
  assert.doesNotMatch(text, /Rent: /, 'no rent comparison from built-in numbers')
})

test('the comparison table compares with the ranges entered, in the team’s words', () => {
  const saved = [
    { id: 'a', metric: 'interestRate', low: 0.03, high: 0.04, typical: null },
    { id: 'v', metric: 'vacancy', low: 0.06, high: 0.08, typical: null },
  ]
  const text = plain(renderToString(withProvider(saved, createElement(Table, { record: record(), onOpenBenchmarks: () => {} }))))
  assert.match(text, /Comparison with your benchmarks/)
  assert.match(text, /0 of 2 figures are within your range\. 2 are outside\./)
  assert.match(text, /Interest rate \(average of the loans\)/)
  assert.match(text, /Above range/)
  assert.match(text, /Below range/)
  assert.match(text, /Change your benchmarks/)
  assert.doesNotMatch(text, MADE_UP)
})

test('outside the app (no provider) the table still uses the built-in sets, as the other tests expect', () => {
  const text = plain(renderToString(createElement(Table, { record: record() })))
  assert.match(text, /Market comparison/)
  assert.match(text, /Sample numbers only/)
})

test('a project with no stage chosen is not compared, whatever is entered', () => {
  const blank = healthyProject()
  const saved = [{ id: 'a', metric: 'interestRate', low: 0.03, high: 0.04, typical: null }]
  const text = plain(renderToString(withProvider(saved, createElement(Table, { record: blank }))))
  assert.match(text, /Choose a stage above/)
})

test('the effect summary says what each range found, what was not compared, and where to see it', () => {
  const p = record()
  p.data.residentialIncome.rows.push({ amiLevel: null, unitType: '2 BR', units: 20, baths: 2, sqft: 950, monthlyRent: 1900 })
  const saved = [
    { id: 'a', metric: 'interestRate', low: 0.03, high: 0.04, typical: null },
    { id: 'r', metric: 'rent', unitType: '1br', ami: '', low: 1000, high: 1200, typical: null },
    { id: 'v', metric: 'vacancy', low: 0.05, high: 0.08, typical: null },
  ]
  const text = plain(renderToString(withProvider(saved, createElement(Impact, { record: p, firm: null, settings: undefined, onGo: () => {} }))))
  assert.match(text, /What your benchmarks found/)
  assert.match(text, /2 of 3 compared figures are outside your range\./)
  assert.match(text, /Monthly rent per unit: 1br \(market rate\)/)
  assert.match(text, /Your range: 3\.00% to 4\.00%/)
  assert.match(text, /Above range · high/)
  assert.match(text, /Rent for 2br \(market rate\): no range entered/)
  assert.match(text, /See it on Key numbers/)
  assert.doesNotMatch(text, MADE_UP)
})

test('the effect summary with nothing entered, or no stage, only says what to do', () => {
  const none = plain(renderToString(withProvider(null, createElement(Impact, { record: record() }))))
  assert.match(none, /Add a range below/)
  const noStage = plain(renderToString(withProvider([{ id: 'a', metric: 'vacancy', low: 0.05, high: 0.08, typical: null }], createElement(Impact, { record: healthyProject() }))))
  assert.match(noStage, /Choose a stage above/)
})

// --- the unit type dropdown ---------------------------------------------------------------------------------------------

const rentEntry = (unitType, id = 'r') => ({ id, metric: 'rent', unitType, ami: '', low: 1000, high: 1200, typical: null })
const workbook = [{ type: '1br', units: 40, written: ['1-bdr'] }, { type: '2br', units: 20, written: [] }]

test('the unit type is a dropdown: the workbook’s types with unit counts first, then the standard types it does not have', () => {
  const html = renderToString(withProvider([rentEntry('1br')], createElement(Editor, { workbookTypes: workbook })))
  assert.match(html, /<optgroup label="In this workbook">/)
  assert.match(plain(html), /1 bedroom \(1br\): 40 units, written “1-bdr”/)
  assert.match(plain(html), /2 bedroom \(2br\): 20 units/)
  assert.match(html, /<optgroup label="Other standard types">/)
  const standard = html.slice(html.indexOf('Other standard types'))
  assert.match(standard, /Studio/)
  assert.match(standard, /3 bedroom/)
  assert.doesNotMatch(standard.slice(0, standard.indexOf('</optgroup>')), /2 bedroom/, 'a type the workbook has is not listed twice')
  assert.doesNotMatch(html, /placeholder="for example 2br"/, 'no free-text box for a standard type')
})

test('the chosen type is selected however it was written, and the workbook is said to hold it', () => {
  for (const written of ['1br', '1 BR', '1-bdr', 'one bedroom']) {
    const html = renderToString(withProvider([rentEntry(written)], createElement(Editor, { workbookTypes: workbook })))
    assert.match(html, /<option value="1br" selected="">/, written)
    assert.match(plain(html), /The loaded workbook has 40 units of this type\./, written)
  }
})

test('a type the workbook does not hold says so', () => {
  const html = renderToString(withProvider([rentEntry('3br')], createElement(Editor, { workbookTypes: workbook })))
  assert.match(plain(html), /The loaded workbook has no units of this type, so this range is not used on it\./)
})

test('an unusual type shows as "Other" with its name in a box, and a blank one asks to choose', () => {
  const unusual = renderToString(withProvider([rentEntry('Penthouse')], createElement(Editor, { workbookTypes: workbook })))
  assert.match(unusual, /<option value="__other" selected="">/)
  assert.match(unusual, /value="Penthouse"/)
  const blank = renderToString(withProvider([rentEntry('')], createElement(Editor, { workbookTypes: workbook })))
  assert.match(blank, /<option value="" selected="">Choose a type<\/option>/)
  assert.match(plain(blank), /Enter the unit type, such as studio, 1br or 2br\./)
})

test('with no workbook loaded the dropdown offers the standard types and makes no claim about a workbook', () => {
  const html = renderToString(withProvider([rentEntry('2br')], createElement(Editor)))
  assert.doesNotMatch(html, /In this workbook/)
  assert.match(html, /<optgroup label="Standard types">/)
  assert.match(html, /<option value="2br" selected="">/)
  assert.doesNotMatch(plain(html), /loaded workbook/)
})

// --- when the benchmarks were last changed -------------------------------------------------------------------------------

const SAVED = [{ id: 'v', metric: 'vacancy', low: 0.05, high: 0.08, typical: null }]

test('the Benchmarks screen and the comparison table say when the ranges were last changed', () => {
  const when = '2026-11-16T12:00:00.000Z'
  const editor = plain(renderToString(withProvider(SAVED, createElement(Editor), when)))
  assert.match(editor, /1 of 1 benchmark is in use, last changed November 1[56], 2026\./)
  const table = plain(renderToString(withProvider(SAVED, createElement(Table, { record: record() }), when)))
  assert.match(table, /Compared with: Your benchmarks \(last changed November 1[56], 2026\)\./)
})

test('benchmarks saved without a date say so, instead of showing a made-up one', () => {
  const editor = plain(renderToString(withProvider(SAVED, createElement(Editor))))
  assert.match(editor, /last changed date not recorded yet/)
  const table = plain(renderToString(withProvider(SAVED, createElement(Table, { record: record() }))))
  assert.match(table, /\(last changed date not recorded yet\)/)
})

test('with nothing entered no date is shown', () => {
  assert.doesNotMatch(plain(renderToString(withProvider(null, createElement(Editor)))), /last changed/)
})
