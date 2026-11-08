// Draws the real completed-risk panel (the .jsx file) for the sample projects, so a mistake that only shows when the page
// is drawn is caught here and not by a person opening the link.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { scenarios } from '../../shared/samples/scenarios.js'
import { healthyProject } from '../../shared/samples/baseline.js'

let server
let Panel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  Panel = (await server.ssrLoadModule('/src/modules/m3c-completed/CompletedRiskPanel.jsx')).default
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (project, context = {}) => plain(renderToString(createElement(Panel, { project, context })))

const withStage = (stage, edit = () => {}) => {
  const p = healthyProject()
  p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' }
  p.data.stage.stage = stage
  p.data.stage.asOfDate = '2026-01-15'
  edit(p)
  return p
}

test('the panel draws the four checks for a completed project, in plain words', () => {
  const html = draw(withStage('completed'))
  for (const title of ['Actuals vs. underwriting', 'Expense normalization', 'Vacancy realism', 'Debt maturity or reset']) assert.ok(html.includes(title), title)
  assert.match(html, /could not run without a T-12|No T-12 is loaded/)
})

test('a flagged check shows the evidence and the question for the sponsor', () => {
  const html = draw(withStage('completed', (p) => (p.data.sources.rows[0].termMonths = 24)))
  assert.match(html, /Ask the sponsor:/)
  assert.match(html, /matures 2026-06/)
})

test('lease-up and development explain what runs', () => {
  assert.match(draw(withStage('lease_up')), /still filling/)
  assert.match(draw(withStage('development')), /no actual results to check yet/)
  assert.match(draw(withStage(null)), /Choose a stage/)
})

test('every sample project draws without crashing', () => {
  for (const s of scenarios) {
    const { projects } = s.build()
    const p = projects[0].record
    p.data.stage.stage = s.stage
    p.data.stage.asOfDate = s.asOf
    if (s.t12) p.data.t12.rows = s.t12.rows
    assert.ok(draw(p).length > 100, s.id)
  }
  assert.ok(draw(null).includes('Choose a stage'))
})
