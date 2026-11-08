// Draws the real summary page (the .jsx file) the way the browser build would, so a mistake that only shows when the page
// is drawn is caught here.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { makeFlag } from '../../shared/index.js'

let server
let SynthesisPanel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  SynthesisPanel = (await server.ssrLoadModule('/src/modules/m6-synthesis/SynthesisPanel.jsx')).default
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (props) => plain(renderToString(createElement(SynthesisPanel, props)))
const project = { data: { stage: { stage: 'development', asOfDate: '2026-01-15' }, identity: { name: 'Maple Court Apartments' } } }

const high = makeFlag({
  id: 'M1-sources-uses',
  module: 'M1',
  stage_used: 'development',
  severity: 'high',
  title: 'Sources do not equal uses.',
  evidence: 'Sources 5,200,000 vs uses 5,550,000: a 350,000 gap.',
  cell_refs: ['Details!F42', 'Budget!G102'],
  follow_up: 'Where will the missing 350,000 come from?',
})

test('the summary page shows ranked flags, cells, the question, the copy button and the layers not run', () => {
  const html = draw({ project, moduleResults: [{ module: 'M1', flags: [high], notes: [] }], context: {} })
  assert.ok(html.includes('What to look at first: Maple Court Apartments'))
  assert.ok(html.includes('Sources do not equal uses.'))
  assert.ok(html.includes('Budget!G102'))
  assert.ok(html.includes('Ask the sponsor: '))
  assert.ok(html.includes('Copy 1 follow-up question'))
  assert.ok(html.includes('Not run yet'))
  assert.ok(html.includes('More detail'))
})

test('the summary page draws with no results and with bad input', () => {
  for (const props of [{}, { project: null, moduleResults: null }, { project, moduleResults: 'x', context: 5 }, { project, moduleResults: [null, { module: 'M2' }] }]) {
    const html = draw(props)
    assert.ok(html.includes('What to look at first'))
  }
  assert.ok(draw({ project, moduleResults: [] }).includes('There are no questions for the sponsor.'))
})
