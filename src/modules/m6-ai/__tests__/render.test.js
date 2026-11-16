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
    assert.match(html, /only made-up data/)
    assert.match(html, /Get AI second opinion/)
    // Off until the reviewer confirms and types a code: the button starts disabled, and no answer is shown.
    assert.match(html, /<button[^>]*disabled=""[^>]*>Get AI second opinion/)
    assert.doesNotMatch(html, /EXAMPLE LAYOUT/)
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
test('an answer is plain prose with small evidence numbers, and every finding it used is in a separate Evidence box after it', async () => {
  const loaded = await loadScenario(scenarios.find((x) => x.id.startsWith('s15')))
  const [a, b, c] = loaded.flags.map((f) => f.id)
  const answer = {
    second_opinion: 'agrees_with_caveats',
    summary: 'The story in plain words.',
    connections: [{ headline: 'One cause', explanation: 'These findings share a cause.', flag_ids: [b, a], check_first: b, cites: [] }],
    look_first: [{ flag_id: c, reason: 'This is worth reading first.' }],
    questions: [{ question: 'Please confirm the loan terms.', reason: '', flag_ids: [a] }],
    integrity_screen: [{ title: 'A cell looks odd', why: 'It does not fit.', cites: ['Details!H28'], confidence: 'low' }],
    cannot_tell: [],
    confidence: 'medium',
    confidence_reason: 'Test.',
  }
  const outcome = { answer, dropped: [], askedAt: 'now', example: false, truncated: false }
  const html = plain(renderToString(createElement(AnswerView, { outcome, flags: loaded.flags, map: loaded.map })))
  // Compare as reading text: no tags, no HTML escapes, single spaces.
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')
  const marker = 'Evidence behind this opinion'
  assert.equal(html.split(marker).length, 2, 'one Evidence box')
  const [proseHtml, boxHtml] = html.split(marker)
  const prose = text(proseHtml)
  const box = text(boxHtml)
  // Nothing in the prose is a flag id or a cell: those live only in the box.
  for (const id of [a, b, c]) assert.ok(!prose.includes(id), `${id} is not in the prose`)
  assert.ok(!prose.includes('Details!H28'))
  assert.ok(!prose.includes('..'), 'no doubled full stops where a finding’s title meets the AI’s words')
  // The prose says where to look instead: b (1), a (2), c (3), then the cell (4).
  assert.match(prose, /These findings share a cause\. · evidence 1, 2/)
  assert.match(prose, /This is worth reading first\. · evidence 3/)
  assert.match(prose, /Please confirm the loan terms\. · evidence 2/)
  assert.match(prose, /It does not fit\. · evidence 4/)
  // The box holds every finding and the cell, numbered in that order, with the checks' own wording.
  for (const id of [b, a, c]) assert.ok(box.includes(id), `${id} is in the box`)
  assert.ok(box.includes('Details!H28'))
  assert.ok(box.indexOf(b) < box.indexOf(a) && box.indexOf(a) < box.indexOf(c) && box.indexOf(c) < box.indexOf('Details!H28'))
  for (const id of [a, b, c]) assert.ok(box.includes(text(loaded.flags.find((f) => f.id === id).evidence)), `the checks' own evidence for ${id} is shown`)
  assert.match(box, /They come from the rules, not from the AI/)
})

test('an answer with nothing to point at has no Evidence box', async () => {
  const loaded = await loadScenario(scenarios[0])
  const outcome = { answer: { second_opinion: 'cannot_tell', summary: 'Nothing.', connections: [], look_first: [], questions: [], integrity_screen: [], cannot_tell: [], confidence: 'low', confidence_reason: '' }, dropped: [], askedAt: 'now', example: false, truncated: false }
  const html = plain(renderToString(createElement(AnswerView, { outcome, flags: loaded.flags, map: loaded.map })))
  assert.ok(!html.includes('Evidence behind this opinion'))
  assert.match(html, /Nothing clear found beyond what the checks already flag/)
})
