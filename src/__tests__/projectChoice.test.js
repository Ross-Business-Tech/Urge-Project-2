// The project a reviewer picks stays picked: every analysis screen shows the same project.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { demoReadyResult } from '../modules/shared/samples/demoReview.js'

let server
let LoadedProject
let ProjectChoiceContext
before(async () => {
  server = await createServer({ configFile: new URL('../../vite.config.js', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  ;({ default: LoadedProject } = await server.ssrLoadModule('/src/LoadedProject.jsx'))
  ;({ ProjectChoiceContext } = await server.ssrLoadModule('/src/ProjectChoice.js'))
})
after(async () => {
  await server?.close()
})

const plain = (html) => html.replaceAll('<!-- -->', '')

async function draw(choiceId) {
  const result = await demoReadyResult()
  const review = { result: { ...result, report: result.report }, editRecord: () => {}, changeProject: () => {}, changeSettings: () => {} }
  const shown = (record) => createElement('p', { id: 'shown' }, `shown: ${record.data.identity.name}`)
  const screen = createElement(LoadedProject, { review, onGoLoad: () => {} }, shown)
  const tree = choiceId === undefined ? screen : createElement(ProjectChoiceContext.Provider, { value: { id: choiceId, setId: () => {} } }, screen)
  return { html: plain(renderToString(tree)), result }
}

const idOf = (result, name) => result.report.projects.find((p) => p.name === name).id

test('with no shared choice a screen opens on the first project', async () => {
  const { html } = await draw(undefined)
  assert.match(html, /shown: Maple Court Apartments/)
})

test('a shared choice is the project every screen shows', async () => {
  const result = await demoReadyResult()
  const harbor = idOf(result, 'Harbor Point Towers')
  const { html } = await draw(harbor)
  assert.match(html, /shown: Harbor Point Towers/)
  assert.match(html, /<option value="[^"]*" selected="">Harbor Point Towers<\/option>/, 'and the picker agrees')
})

test('a choice that is not in this workbook falls back to the first project', async () => {
  const { html } = await draw('no-such-project')
  assert.match(html, /shown: Maple Court Apartments/)
})
