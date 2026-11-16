// Draws the real AI screen (the .jsx file) for every sample project, so a mistake that only shows when the page is drawn is
// caught here. Vite loads the screen code exactly as the browser build would, and React draws it to text.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { scenarios, loadScenario } from './helpers.js'

let server
let AiPanel
let AnswerView

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  ;({ default: AiPanel, AnswerView } = await server.ssrLoadModule('/src/modules/m6-ai/AiPanel.jsx'))
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (s) => plain(renderToString(createElement(AiPanel, { record: s.record, firm: s.firm, settings: s.settings, result: s.result })))

for (const scenario of scenarios) {
  test(`${scenario.id}: the AI screen draws, shows the rules’ findings first, and sends nothing by itself`, async () => {
    const loaded = await loadScenario(scenario)
    const html = draw(loaded)
    assert.match(html, /What the checks found/)
    assert.match(html, /AI second opinion/)
    assert.match(html, /What happens when you press the button/)
    assert.match(html, /See exactly what would be sent/)
    // A client-facing screen: no test or demo wording, no confirmation box, no example button. (The data preview box can quote
    // the checks' own labels, such as a benchmark's "made-up sample" name, so it is left out of this check: it is the data.)
    const screenText = html.replace(/<pre>[\s\S]*?<\/pre>/, '')
    assert.doesNotMatch(screenText, /made-up|made up|instructor|example layout|not AI|EXAMPLE/i)
    assert.doesNotMatch(html, /type="checkbox"/)
    assert.match(html, /Get AI second opinion/)
    // Off until the reviewer types the access code: the button starts disabled, and no answer is shown.
    assert.match(html, /<button[^>]*disabled=""[^>]*>Get AI second opinion/)
    assert.doesNotMatch(html, /Advice only/)
    // The data preview on screen holds labels, not real names.
    for (const word of ['Harbor View Lofts', 'Maple Ridge Partners', 'Pat Sample']) assert.ok(!html.includes(word), word)
    assert.match(html, /\[Project A\]/)
    // The counts on screen are the rules' own counts.
    if (loaded.flags.length === 0) assert.match(html, /raised no findings/)
    else {
      const count = (sev) => loaded.flags.filter((f) => f.severity === sev).length
      assert.ok(html.includes(`${count('high')} high · ${count('medium')} medium · ${count('low')} low`), 'severity counts')
    }
  })
}

test('a project with no stage chosen is told to choose one, and cannot ask', async () => {
  const loaded = await loadScenario(scenarios[0])
  loaded.record = structuredClone(loaded.record)
  loaded.record.data.stage.stage = null
  const html = draw(loaded)
  assert.match(html, /Choose a stage and an “as of” date/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>Get AI second opinion/)
})

// ---------------------------------------------------------------- the answer reads as prose, with the evidence in its own box
test('an answer is plain prose with no sources in it, and every finding it used is in a separate Evidence box that says what each supports', async () => {
  const loaded = await loadScenario(scenarios.find((x) => x.id.startsWith('s15')))
  const [a, b, c] = loaded.flags.map((f) => f.id)
  const answer = {
    second_opinion: 'agrees_with_caveats',
    summary: 'The story in plain words, with cash of $900,000 mentioned.',
    summary_pointers: [a, 'Balance Sheet!B9'],
    connections: [{ headline: 'One cause', explanation: 'These findings share a cause.', flag_ids: [b, a], check_first: b, cites: [] }],
    look_first: [{ flag_id: c, reason: 'This is worth reading first.' }],
    questions: [{ question: 'Please confirm the loan terms.', reason: '', flag_ids: [a] }],
    integrity_screen: [{ title: 'A cell looks odd', why: 'It does not fit.', cites: ['Details!H28'], confidence: 'low' }],
    cannot_tell: [],
    confidence: 'medium',
    confidence_reason: 'Test.',
  }
  const data = [{ cell: 'Balance Sheet!B9', label: 'Firm balance sheet: Cash (Current period)', value: '$900,000' }]
  const outcome = { answer, dropped: [], askedAt: 'now', truncated: false }
  const html = plain(renderToString(createElement(AnswerView, { outcome, flags: loaded.flags, map: loaded.map, data })))
  // Compare as reading text: no tags, no HTML escapes, single spaces.
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')
  const marker = 'Evidence behind this opinion'
  assert.equal(html.split(marker).length, 2, 'one Evidence box')
  const [proseHtml, boxHtml] = html.split(marker)
  const prose = text(proseHtml)
  const box = text(boxHtml)
  // The wording carries no sources: no ids, no cells, no markers, no brackets.
  for (const id of [a, b, c]) assert.ok(!prose.includes(id), `${id} is not in the prose`)
  assert.ok(!prose.includes('Details!H28') && !prose.includes('Balance Sheet!B9'))
  assert.ok(!/evidence \d/i.test(prose), 'no "evidence 1" markers either')
  assert.ok(!prose.includes('..'), 'no doubled full stops')
  assert.match(prose, /cash of \$900,000 mentioned/, 'a figure may be stated plainly')
  // The box holds every finding and cell, in reading order: summary first (a, then the cell), then b, c and the data cell.
  const order = [a, 'Balance Sheet!B9', b, c, 'Details!H28'].map((x) => box.indexOf(x))
  assert.ok(order.every((i) => i >= 0), 'everything is in the box')
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'in reading order')
  for (const id of [a, b, c]) assert.ok(box.includes(text(loaded.flags.find((f) => f.id === id).evidence)), `the checks' own evidence for ${id} is shown`)
  // Each piece of evidence says which ideas it supports, and which figures it explains.
  assert.match(box, /Supports The summary · One cause · Question 1: Please confirm the loan terms\./, 'the first finding supports three ideas')
  assert.match(box, /Spreadsheet cell Balance Sheet!B9 Firm balance sheet: Cash \(Current period\): \$900,000 Supports The summary Explains \$900,000/, 'the cell says what it holds, what it supports and the figure it explains')
  assert.match(box, /Supports Look first: /)
  assert.match(box, /Supports Data screen: A cell looks odd/)
  assert.match(box, /They come from the rules and your workbook, not from the AI/)
})

test('an answer with nothing to point at has no Evidence box', async () => {
  const loaded = await loadScenario(scenarios[0])
  const outcome = { answer: { second_opinion: 'cannot_tell', summary: 'Nothing.', connections: [], look_first: [], questions: [], integrity_screen: [], cannot_tell: [], confidence: 'low', confidence_reason: '' }, dropped: [], askedAt: 'now', truncated: false }
  const html = plain(renderToString(createElement(AnswerView, { outcome, flags: loaded.flags, map: loaded.map })))
  assert.ok(!html.includes('Evidence behind this opinion'))
  assert.match(html, /Nothing clear found beyond what the checks already flag/)
})

test('the AI review sees the same benchmark findings as the screens: the team’s ranges are passed through', async () => {
  const { collectFlags } = await import('../collect.js')
  const loaded = await loadScenario(scenarios[0])
  const entries = [{ id: 'v', metric: 'vacancy', low: 0.2, high: 0.3, typical: null }]
  const without = collectFlags(loaded.record, { firm: loaded.firm, settings: loaded.settings, result: loaded.result })
  const withIt = collectFlags(loaded.record, { firm: loaded.firm, settings: loaded.settings, result: loaded.result, bm: { benchmarks: entries } })
  assert.ok(!without.flags.some((f) => f.id.startsWith('M2-yours')))
  assert.ok(withIt.flags.some((f) => f.id.startsWith('M2-yours-vacancy')), 'a range the team entered produces its finding in the AI input')
})
