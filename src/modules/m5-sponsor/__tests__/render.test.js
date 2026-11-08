// Draws the real sponsor page (the .jsx file) so a mistake that only shows when the page is drawn is caught here.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyStageAndDate } from '../../shared/index.js'
import { scenarios, t12Rows } from '../../shared/samples/scenarios.js'
import { healthyFirm, healthyProject } from '../../shared/samples/baseline.js'

let server
let SponsorPanel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  SponsorPanel = (await server.ssrLoadModule('/src/modules/m5-sponsor/SponsorPanel.jsx')).default
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (props) => plain(renderToString(createElement(SponsorPanel, props)))

test('the sponsor page draws for every sample, with its sections', () => {
  for (const s of scenarios) {
    const built = s.build()
    const projects = built.projects.map((p) => applyStageAndDate(p.record, { stage: s.stage, asOfDate: s.asOf }))
    if (s.t12) projects[0].data.t12.rows = s.t12.rows
    const html = draw({ firm: built.firm, projects, context: { project: projects[0] } })
    assert.ok(!html.includes('could not be shown'), s.id)
    for (const text of ['Global coverage', 'Liquidity cover', 'Fee dependence', 'Credibility score', "The sponsor's projects", 'Projected vs. delivered']) {
      assert.ok(html.includes(text.replace("'", '&#x27;')), `${s.id}: missing ${text}`)
    }
  }
})

test('the failing firm shows its flag and the projected-vs-delivered table', () => {
  const s = scenarios.find((x) => x.id === 's10-healthy-project-failing-firm')
  const built = s.build()
  const project = applyStageAndDate(built.projects[0].record, { stage: 'completed', asOfDate: s.asOf })
  project.data.t12.rows = t12Rows()
  const html = draw({ firm: built.firm, projects: [project], context: {} })
  assert.ok(html.includes('own numbers hold up'))
  assert.ok(html.includes('0.03×'))
  assert.ok(html.includes('Stabilization'))
  assert.ok(html.includes('Delivered'))
})

test('the sponsor page survives missing or broken props', () => {
  const dev = applyStageAndDate(healthyProject(), { stage: 'development', asOfDate: '2026-01-15' })
  for (const props of [{}, { firm: null, projects: null, context: null }, { firm: 'x', projects: [null, 3, dev] }, { firm: healthyFirm(), projects: [] }]) {
    const html = draw(props)
    assert.ok(html.includes('Sponsor and portfolio'))
    assert.ok(!html.includes('NaN'))
  }
})
