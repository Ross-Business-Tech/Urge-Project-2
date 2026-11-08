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
  assert.match(r.headline, /^Sponsor Strong \(98\/100\) and project sound \(\d\.\d\d×\)\.$/)
  assert.equal(r.projects[0].state, 'sound')
})

test('s10: a sound project under a failing firm says the sponsor is the risk', () => {
  const { health, projects } = setup('s10', 's10')
  const r = soWhat(health, projects)
  assert.equal(health.label, 'Failing')
  assert.match(r.headline, /^Sponsor is the risk: Failing \(5\/100\)\. Project is sound \(2\.71×\)\.$/)
  assert.equal(r.tone, 'amber')
  assert.match(r.projects[0].text, /^Sound alone \(2\.71× vs 1\.20× minimum\), but the Failing sponsor/)
})

test('a failing sponsor matters most for a project still being built', () => {
  const f = sample('s10').build()
  const ds = sample('s01')
  const dev = staged(ds, ds.build().projects[0].record)
  const r = soWhat(firmHealth(f.firm, [dev]), [dev])
  assert.match(r.projects[0].text, /must fund any overrun or delay/)
})

test('thin project, strong sponsor: the sponsor may have to support it', () => {
  const f = sample('s01').build()
  const ps = sample('s08')
  const p = staged(ps, ps.build().projects[0].record)
  const r = soWhat(firmHealth(f.firm, [p]), [p])
  assert.equal(r.projects[0].state, 'thin')
  assert.match(r.headline, /^Sponsor Strong \(\d+\/100\), but project coverage is thin \(.*vs 1\.20× minimum\)\.$/)
})

test('thin project and failing sponsor: the highest-risk combination', () => {
  const f = sample('s10').build()
  const ps = sample('s08')
  const p = staged(ps, ps.build().projects[0].record)
  const r = soWhat(firmHealth(f.firm, [p]), [p])
  assert.equal(r.tone, 'warn')
  assert.match(r.headline, /^Highest risk: Failing \(\d+\/100\) sponsor and thin project coverage/)
})

test('a project with no usable numbers is not judged, and the sentence says why', () => {
  const { health } = setup('s01', 's01')
  const r = soWhat(health, [blankProject()])
  assert.equal(r.projects[0].state, 'unknown')
  assert.match(r.projects[0].text, /not available/)
  assert.match(r.headline, /not available/)
})

test('no sponsor score and no projects both give a sensible sentence, never a crash', () => {
  assert.match(soWhat({ ok: false }, [blankProject()]).headline, /Sponsor not scored/)
  assert.match(soWhat(setup('s01', 's01').health, []).headline, /No projects/)
})

test('a project with no stage asks for one instead of guessing', () => {
  const f = sample('s10').build()
  const ps = sample('s01')
  const unstaged = ps.build().projects[0].record // no stage chosen yet
  const r = soWhat(firmHealth(f.firm, [unstaged]), [unstaged])
  assert.equal(r.projects[0].needsStage, true)
  assert.match(r.projects[0].text, /Choose a stage/)
  assert.doesNotMatch(r.projects[0].text, /overrun|absorb a miss/)
  const staged1 = staged(ps, ps.build().projects[0].record)
  assert.equal(soWhat(firmHealth(f.firm, [staged1]), [staged1]).projects[0].needsStage, false)
})

test('the track record gets its own line, and a weak one stops the card from showing all clear', () => {
  const { health, projects } = setup('s01', 's01')
  const clear = soWhat(health, projects)
  assert.equal(clear.tone, 'good')
  assert.equal(clear.trackLine, null)
  assert.equal(soWhat(health, projects, undefined, { ok: true, label: 'Strong', score: 96 }).trackLine, 'Track record: Strong (96/100).')
  assert.equal(soWhat(health, projects, undefined, { ok: true, label: 'Strong', score: 96 }).tone, 'good')
  const weak = soWhat(health, projects, undefined, { ok: true, label: 'Weak', score: 54 })
  assert.equal(weak.trackLine, 'Track record: Weak (54/100).')
  assert.equal(weak.tone, 'amber')
  assert.equal(soWhat(health, projects, undefined, { ok: false, noTrackRecord: true }).trackLine, 'Track record: none to judge.')
  assert.match(soWhat(health, projects, undefined, { ok: false, noDeliveryEvidence: true }).trackLine, /not scored/)
})
