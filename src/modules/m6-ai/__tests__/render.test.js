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

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  ;({ default: AiPanel } = await server.ssrLoadModule('/src/modules/m6-ai/AiPanel.jsx'))
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
