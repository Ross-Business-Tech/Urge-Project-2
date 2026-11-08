import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { parseT12Template } from '../../shared/import/t12Template.js'
import { applyStageAndDate, replaceT12Rows, compareSeverity, validateFlag } from '../../shared/index.js'
import { run as runM1 } from '../../m1-integrity/index.js'
import { run, trackRecord, firmHealth } from '../index.js'
import { soWhat } from '../soWhat.js'
import { sponsorSamples, t12FileName, AS_OF } from '../samples/sponsorSamples.js'

const dir = new URL('../../../../sample-files/sponsors/', import.meta.url)

// Do what a user does with the committed files: load the workbook, choose each project's stage, load each project's T-12.
async function loadAsAUserWould(sample) {
  const out = await importWorkbook(readFileSync(new URL(`${sample.id}.xlsx`, dir)))
  const projects = out.projects.map((p) => {
    const history = sample.past.find((x) => x.name === p.data.identity.name)
    if (!history) return applyStageAndDate(p, { stage: 'development', asOfDate: AS_OF })
    const completed = applyStageAndDate(p, { stage: 'completed', asOfDate: AS_OF })
    return replaceT12Rows(completed, parseT12Template(readFileSync(new URL(t12FileName(sample, history), dir))))
  })
  const reviewed = projects.find((p) => p.data.stage.stage === 'development')
  return { out, projects, reviewed, context: { firm: out.firm, projects } }
}

for (const sample of sponsorSamples) {
  test(`${sample.id}: the files load, and M5 shows what the README says`, async () => {
    const { out, projects, reviewed, context } = await loadAsAUserWould(sample)

    // The workbook holds the new building and every past project, one tab each, and the Cover agrees.
    assert.equal(projects.length, 1 + sample.past.length)
    assert.ok(!out.report.notes.some((n) => /The Cover says/.test(n)), out.report.notes.join(' | '))
    assert.equal(out.firm.data.identity.completedProjectCount, sample.past.length)

    // The credibility score
    const track = trackRecord(out.firm, projects, undefined, reviewed)
    assert.equal(track.ok, true, track.reason)
    const want = sample.key.credibility
    assert.equal(track.label, want.label, `${track.score}`)
    assert.ok(track.score >= want.min, `score ${track.score} is below ${want.min}`)
    if (want.max) assert.ok(track.score <= want.max, `score ${track.score} is above ${want.max}`)
    assert.equal(track.projects.filter((p) => p.score !== null).length, want.projectsScored)
    assert.equal(track.summary.count, sample.past.length)
    assert.equal(track.declared, sample.past.length, 'the Cover count is read')

    // The sponsor's firm is healthy in all three, so any flag comes from the track record.
    assert.equal(firmHealth(out.firm, projects).label, 'Strong')

    // The flags
    const { flags, notes } = run(reviewed, context)
    assert.ok(!flags.some((f) => f.id === 'M5-check-failed'), notes.join(' | '))
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const e of sample.key.expect) {
      const got = flags.find((f) => f.id === e.id)
      assert.ok(got, `should raise ${e.id}; got ${flags.map((f) => f.id).join(', ') || 'nothing'}`)
      assert.ok(compareSeverity(got.severity, e.severity) <= 0, `${e.id} is ${got.severity}, key wants at least ${e.severity}`)
    }
    for (const id of sample.key.forbid) assert.ok(!flags.some((f) => f.id === id), `should not raise ${id}`)
    if (sample.key.expect.length === 0) assert.deepEqual(flags.filter((f) => f.severity !== 'low').map((f) => f.id), [], 'nothing above low')
  })

  test(`${sample.id}: the integrity checks find nothing serious in the files`, async () => {
    const { out, projects } = await loadAsAUserWould(sample)
    for (const p of projects) {
      const high = runM1(p, { firm: out.firm, facts: out.facts, report: out.report, projects }).flags.filter((f) => f.severity === 'high')
      assert.deepEqual(high.map((f) => f.id), [], `${p.data.identity.name}: ${high.map((f) => f.evidence).join(' | ')}`)
    }
  })
}

test('without a T-12 for a past project, the track record says it cannot be compared', async () => {
  const sample = sponsorSamples[1]
  const out = await importWorkbook(readFileSync(new URL(`${sample.id}.xlsx`, dir)))
  const projects = out.projects.map((p) => applyStageAndDate(p, { stage: p.data.identity.name === 'Lakeside Terrace' ? 'development' : 'completed', asOfDate: AS_OF }))
  const track = trackRecord(out.firm, projects, undefined, projects.find((p) => p.data.stage.stage === 'development'))
  assert.equal(track.ok, false)
  assert.equal(track.noDeliveryEvidence, true)
})

test('the three sponsors are different from each other, and every name is made up', () => {
  const names = sponsorSamples.flatMap((s) => [s.firm().data.identity.name, s.newBuild().data.identity.name, ...s.past.map((p) => p.name)])
  assert.equal(new Set(names).size, names.length, 'no name is used twice')
  assert.equal(new Set(sponsorSamples.map((s) => s.id)).size, 3)
})

test('the big step-up sponsor is not shown as all clear on the So what card', async () => {
  const { projects, reviewed, out } = await loadAsAUserWould(sponsorSamples[2])
  const track = trackRecord(out.firm, projects, undefined, reviewed)
  const card = soWhat(firmHealth(out.firm, projects), projects, undefined, track)
  assert.match(card.trackLine, /4\.0× the largest the sponsor has completed/)
  assert.equal(card.tone, 'amber')
})
