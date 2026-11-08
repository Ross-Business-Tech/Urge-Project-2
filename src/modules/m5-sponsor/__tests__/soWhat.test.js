import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { applyStageAndDate } from '../../shared/index.js'
import { blankProject } from '../../shared/records.js'
import { firmHealth } from '../index.js'
import { soWhat } from '../soWhat.js'

const sample = (id) => scenarios.find((s) => s.id.startsWith(id))
const staged = (s, record) => applyStageAndDate(record, { stage: s.stage, asOfDate: s.asOf })

function setup(firmId, projectId) {
  const f = sample(firmId).build()
  const ps = sample(projectId)
  const p = staged(ps, ps.build().projects[0].record)
  return { health: firmHealth(f.firm, [p]), projects: [p] }
}

test('sound project, strong sponsor: both look sound', () => {
  const { health, projects } = setup('s01', 's01')
  const r = soWhat(health, projects)
  assert.equal(r.tone, 'good')
  assert.match(r.headline, /both look sound/)
  assert.equal(r.projects[0].state, 'sound')
})

test('s10: a sound project under a failing firm says the sponsor is the risk', () => {
  const { health, projects } = setup('s10', 's10')
  const r = soWhat(health, projects)
  assert.equal(health.label, 'Failing')
  assert.match(r.headline, /project is sound on its own numbers, but the sponsor is the risk/)
  assert.equal(r.tone, 'amber')
  assert.match(r.projects[0].text, /Sound on its own numbers/)
})

test('a failing sponsor matters most for a project still being built', () => {
  const f = sample('s10').build()
  const ds = sample('s01')
  const dev = staged(ds, ds.build().projects[0].record)
  const r = soWhat(firmHealth(f.firm, [dev]), [dev])
  assert.match(r.projects[0].text, /still being built/)
})

test('thin project, strong sponsor: the sponsor may have to support it', () => {
  const f = sample('s01').build()
  const ps = sample('s08')
  const p = staged(ps, ps.build().projects[0].record)
  const r = soWhat(firmHealth(f.firm, [p]), [p])
  assert.equal(r.projects[0].state, 'thin')
  assert.match(r.headline, /sponsor looks able to deliver/)
})

test('thin project and failing sponsor: the highest-risk combination', () => {
  const f = sample('s10').build()
  const ps = sample('s08')
  const p = staged(ps, ps.build().projects[0].record)
  const r = soWhat(firmHealth(f.firm, [p]), [p])
  assert.equal(r.tone, 'warn')
  assert.match(r.headline, /highest-risk/)
})

test('a project with no usable numbers is not judged, and the sentence says why', () => {
  const { health } = setup('s01', 's01')
  const r = soWhat(health, [blankProject()])
  assert.equal(r.projects[0].state, 'unknown')
  assert.match(r.projects[0].text, /not available/)
  assert.match(r.headline, /not available/)
})

test('no sponsor score and no projects both give a sensible sentence, never a crash', () => {
  assert.match(soWhat({ ok: false }, [blankProject()]).headline, /could not be scored/)
  assert.match(soWhat(setup('s01', 's01').health, []).headline, /No projects/)
})
