// Renders the real scenario screens (the .jsx files) for every sample project, so a mistake that only shows when the page
// is drawn (a helper used before it is defined, a missing label) is caught here and not by a person opening the link.
// Vite loads the screen code exactly as the browser build would, and React draws it to text.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyStageAndDate, DEFAULT_SETTINGS } from '../../shared/index.js'
import { scenarios } from '../../shared/samples/scenarios.js'

let server
let ScenarioPanel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  ;({ ScenarioPanel } = await server.ssrLoadModule('/src/modules/m4-scenarios/ScenarioPanel.jsx'))
})

after(async () => {
  await server?.close()
})

// React's server output separates pieces of text with invisible <!-- --> markers; take them out so the text can be matched.
const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (record) => plain(renderToString(createElement(ScenarioPanel, { record, settings: DEFAULT_SETTINGS })))
const recordFor = (s, stage = s.stage) => {
  const record = s.build().projects[0].record
  if (s.t12) record.data.t12.rows = s.t12.rows
  return applyStageAndDate(record, { stage, asOfDate: s.asOf })
}

test('the scenario screen draws for every sample project, at every stage, with all of its sections', () => {
  for (const s of scenarios) {
    for (const stage of ['development', 'lease_up', 'completed']) {
      const html = draw(recordFor(s, stage))
      assert.ok(!html.includes('could not be shown'), `${s.id} as ${stage} crashed`)
      for (const text of ['Downside', 'Base', 'Upside', 'Starting from', 'How far can it go before it breaks?', 'What hurts most? One lever at a time']) {
        assert.ok(html.includes(text), `${s.id} as ${stage} is missing "${text}"`)
      }
    }
  }
})

test('the delay and absorption rows of the break-even table are drawn with their numbers', () => {
  const html = draw(recordFor(scenarios[0], 'development'))
  assert.match(html, /Construction delay can reach/)
  assert.match(html, /16\.7 months/)
  assert.match(html, /Holds up even at 120 months/)
  assert.match(html, /11\.4% over budget/)
})

test('a project with no stage asks for one, and a project whose numbers are refused says so, instead of failing', () => {
  const bare = scenarios[0].build().projects[0].record
  assert.match(draw(bare), /Choose a stage above/)
  const refused = draw(recordFor(scenarios.find((s) => s.id === 's14-rate-typed-as-whole-number')))
  assert.match(refused, /cannot be stress-tested/)
  assert.ok(!refused.includes('could not be shown'))
})
