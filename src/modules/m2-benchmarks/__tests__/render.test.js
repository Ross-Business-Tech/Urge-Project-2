// Draws the real market comparison screen (the .jsx file) so a mistake that only shows when the page is drawn is caught here.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyStageAndDate } from '../../shared/index.js'
import { scenarios } from '../../shared/samples/scenarios.js'

let server
let BenchmarkPanel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  BenchmarkPanel = (await server.ssrLoadModule('/src/modules/m2-benchmarks/BenchmarkPanel.jsx')).default
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (project, context = {}) => plain(renderToString(createElement(BenchmarkPanel, { project, context })))

test('the panel draws for every sample project', () => {
  for (const s of scenarios) {
    const record = s.build().projects[0].record
    if (s.t12) record.data.t12.rows = s.t12.rows
    const html = draw(applyStageAndDate(record, { stage: s.stage, asOfDate: s.asOf }))
    assert.match(html, /Market comparison/, s.id)
    assert.match(html, /Market range/, s.id)
  }
})

test('the panel shows a rent above the market with its range', () => {
  const s = scenarios.find((x) => x.id === 's09-passes-dscr-low-occupancy-high-rent')
  const record = s.build().projects[0].record
  record.data.t12.rows = s.t12.rows
  const html = draw(applyStageAndDate(record, { stage: s.stage, asOfDate: s.asOf }))
  assert.match(html, /\$1,950 a month/)
  assert.match(html, /18% above the range/)
  assert.match(html, /Questions for the sponsor/)
})

test('the panel explains itself when there is no stage or nothing to read', () => {
  assert.match(draw(scenarios[0].build().projects[0].record), /Choose a stage/)
  assert.match(draw(null), /Choose a stage/)
  assert.match(draw({ data: { stage: { stage: 'development' } } }), /could not be completed/)
})
