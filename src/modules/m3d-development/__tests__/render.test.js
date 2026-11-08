// Draws the development risk panel for every sample project at every stage, so a mistake that only shows when the page
// is drawn is caught here and not by a person opening the link.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyStageAndDate } from '../../shared/index.js'
import { scenarios } from '../../shared/samples/scenarios.js'

let server
let Panel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  Panel = (await server.ssrLoadModule('/src/modules/m3d-development/DevelopmentRiskPanel.jsx')).default
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (project, context = {}) => plain(renderToString(createElement(Panel, { project, context })))

test('the panel draws the four checks for every sample project as development and lease-up', () => {
  for (const s of scenarios) {
    for (const stage of ['development', 'lease_up']) {
      const html = draw(applyStageAndDate(s.build().projects[0].record, { stage, asOfDate: s.asOf }))
      assert.ok(!html.includes('could not be completed'), `${s.id} as ${stage} failed`)
      for (const text of ['Budget realism', 'Schedule', 'Capital stack and takeout risk', 'Team completeness']) assert.ok(html.includes(text), `${s.id} as ${stage} is missing "${text}"`)
    }
  }
})

test('a thin contingency shows as flagged with the question for the sponsor', () => {
  const s = scenarios.find((x) => x.id === 's03-thin-contingency')
  const html = draw(applyStageAndDate(s.build().projects[0].record, { stage: 'development', asOfDate: s.asOf }))
  assert.match(html, /Flagged · high/)
  assert.match(html, /Ask the sponsor:/)
  assert.match(html, /1\.1% of hard costs, below the 5% to 10% benchmark/)
})

test('no stage, a completed project and a lease-up project each get a plain explanation', () => {
  const record = scenarios[0].build().projects[0].record
  assert.match(draw(record), /Choose a stage above/)
  assert.match(draw(applyStageAndDate(record, { stage: 'completed', asOfDate: '2026-01-15' })), /This project is completed/)
  const html = draw(applyStageAndDate(record, { stage: 'lease_up', asOfDate: '2026-01-15' }))
  assert.match(html, /only the parts still projected are checked/)
  assert.match(html, /Not needed/)
})
