// Draws the real summary at the top of the Key numbers screen, so its wording is checked as people will read it.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { fullExampleBuild, fullExampleT12, FULL_EXAMPLE } from '../modules/shared/samples/fullExample.js'
import { recordsToWorkbook } from '../modules/shared/samples/toWorkbook.js'
import { importWorkbook } from '../modules/shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../modules/shared/import/t12Template.js'
import { applyStageAndDate, replaceT12Rows, DEFAULT_SETTINGS } from '../modules/shared/index.js'

let server
let ScreenSummary
before(async () => {
  server = await createServer({ configFile: new URL('../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  ;({ default: ScreenSummary } = await server.ssrLoadModule('/src/ScreenSummary.jsx'))
})
after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')

async function summaryFor(kind) {
  const out = await importWorkbook(recordsToWorkbook(fullExampleBuild(kind)))
  let record = applyStageAndDate(out.projects[0], { stage: FULL_EXAMPLE[kind].stage, asOfDate: FULL_EXAMPLE[kind].asOf })
  if (kind === 'completed') record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: fullExampleT12() })))
  return plain(renderToString(createElement(ScreenSummary, { kind: 'keynumbers', record, firm: out.firm, settings: DEFAULT_SETTINGS, result: { ...out, projects: [record], settings: DEFAULT_SETTINGS } })))
}

test('one key ratio that meets the settings is not "all 1 key ratios"', async () => {
  const html = await summaryFor('development')
  assert.match(html, /The key ratio meets your settings\./)
  assert.doesNotMatch(html, /All 1 key ratios/)
})

test('several key ratios that meet the settings read "All N key ratios meet your settings"', async () => {
  const html = await summaryFor('completed')
  assert.match(html, /All 2 key ratios meet your settings\./)
})
