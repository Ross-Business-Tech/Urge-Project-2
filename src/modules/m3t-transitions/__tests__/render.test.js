// Draws the real stage-change screen for every sample project at every stage, so a mistake that only shows when the page
// is drawn is caught here and not by a person opening the link.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyStageAndDate, blankProject } from '../../shared/index.js'
import { scenarios } from '../../shared/samples/scenarios.js'

let server
let TransitionPanel

before(async () => {
  server = await createServer({ configFile: new URL('../../../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  TransitionPanel = (await server.ssrLoadModule('/src/modules/m3t-transitions/TransitionPanel.jsx')).default
})

after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')
const draw = (project, context = {}) => plain(renderToString(createElement(TransitionPanel, { project, context })))
const recordFor = (s, stage) => {
  const record = s.build().projects[0].record
  if (s.t12) record.data.t12.rows = s.t12.rows
  return applyStageAndDate(record, { stage, asOfDate: s.asOf })
}

test('the stage-change screen draws for every sample project at every stage', () => {
  for (const s of scenarios) {
    for (const stage of ['development', 'lease_up', 'completed']) {
      const html = draw(recordFor(s, stage))
      assert.ok(!html.includes('could not be shown'), `${s.id} as ${stage} crashed`)
      assert.match(html, /Stage changes/)
      assert.match(html, /What has to be true for it to go well/)
      assert.match(html, { development: /Next: T1 delivery/, lease_up: /Next: T2 stabilization/, completed: /Next: T3 refinance or sale/ }[stage])
    }
  }
})

test('the lease-up project shows its lease-up picture and the occupancy screen flag', () => {
  const s = scenarios.find((x) => x.id === 's09-passes-dscr-low-occupancy-high-rent')
  const html = draw(recordFor(s, 'lease_up'))
  assert.match(html, /Lease-up so far/)
  assert.match(html, /82%/)
  assert.match(html, /Stability streak/)
  assert.match(html, /Ask the sponsor:/)
})

test('a project with no stage, or no project at all, shows a plain message', () => {
  assert.match(draw(blankProject()), /Choose the project’s stage first/)
  assert.match(draw(null), /Stage changes/)
})
