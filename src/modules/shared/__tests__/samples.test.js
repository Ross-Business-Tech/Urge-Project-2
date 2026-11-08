import test from 'node:test'
import assert from 'node:assert/strict'
import { importWorkbook } from '../import/importWorkbook.js'
import { recordsToWorkbook } from '../samples/toWorkbook.js'
import { healthyFirm, healthyProject } from '../samples/baseline.js'

// Blank cells read back as null; a record that never set the field has no entry. Both mean "left empty".
const strip = (rec) => JSON.parse(JSON.stringify(rec.data, (_, v) => (v === null ? undefined : v)))

test('a workbook built from healthy records reads back as the same records', async () => {
  const firm = healthyFirm()
  const project = healthyProject()
  const out = await importWorkbook(recordsToWorkbook({ firm, projects: [{ record: project }] }))
  assert.deepEqual(out.report.layoutProblems, [])
  assert.deepEqual(out.report.errorCells, [])
  assert.equal(out.projects.length, 1)
  const read = strip(out.projects[0])
  const want = strip(project)
  for (const g of Object.keys(want)) {
    if (g === 'stage') continue
    assert.deepEqual(read[g], want[g], `project group ${g}`)
  }
  const readFirm = strip(out.firm)
  // The generator fills in the Cover's project counts, as an applicant would.
  const wantFirm = strip(firm)
  Object.assign(wantFirm.identity, { developmentProjectCount: 1, completedProjectCount: 0 })
  for (const g of ['identity', 'owners', 'balanceSheet', 'principalStatement', 'earnings', 'capital']) {
    assert.deepEqual(readFirm[g], wantFirm[g], `firm group ${g}`)
  }
})

// ---- Every sample scenario builds, imports, and matches its answer key where the key gives a number.
import { scenarios } from '../samples/scenarios.js'
import { buildT12Template, parseT12Template } from '../import/t12Template.js'
import { dscr } from '../calculators.js'

const KINDS = ['development', 'completed']
const importScenario = async (s) => {
  const built = s.build()
  return importWorkbook(recordsToWorkbook(built))
}

test('there is a scenario for every planted problem the spec asks for', () => {
  assert.ok(scenarios.length >= 15)
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length)
  for (const s of scenarios) {
    assert.ok(KINDS.concat('lease_up').includes(s.stage), s.id)
    assert.ok(s.key.summary && Array.isArray(s.key.flags), s.id)
    for (const f of s.key.flags) assert.ok(f.module && f.id && f.about, `${s.id} ${f.id}`)
  }
})

for (const s of scenarios) {
  test(`${s.id}: imports cleanly and the calculators match the key`, async () => {
    const out = await importScenario(s)
    assert.deepEqual(out.report.layoutProblems, [], 'layout')
    const built = s.build()
    assert.ok(out.projects.length >= 1, 'at least one project with data')
    const record = out.projects[0]
    record.data.stage.stage = s.stage
    record.data.stage.asOfDate = s.asOf
    const want = s.key.ratios.dscr
    if (typeof want === 'number') {
      const got = dscr(record)
      assert.ok(got.ok, `DSCR should be available: ${JSON.stringify(got)}`)
      assert.ok(Math.abs(got.value - want) < 0.005, `DSCR ${got.value} vs key ${want}`)
    } else if (want === 'not available') {
      assert.equal(dscr(record).ok, false)
    }
    if (s.t12) {
      const parsed = parseT12Template(buildT12Template({ rows: s.t12.rows }))
      assert.equal(parsed.rows.length, s.t12.rows.length, 'T-12 months survive the template round trip')
    }
    void built
  })
}

test('planted problems are visible to the importer where the importer can see them', async () => {
  const by = Object.fromEntries(scenarios.map((s) => [s.id, s]))

  const errors = await importScenario(by['s04-error-cells'])
  assert.equal(errors.report.errorCells.length, 2)

  const hidden = await importScenario(by['s06-hidden-tab-with-data'])
  assert.equal(hidden.projects.length, 2)
  assert.ok(hidden.report.notes.some((n) => /very hidden but contains data/.test(n)))
  assert.ok(hidden.report.notes.some((n) => /Cover says 1 development project/.test(n)))

  const residue = await importScenario(by['s05-template-residue'])
  assert.match(residue.firm.data.identity.name, /Enter firm name/)

  const equity = await importScenario(by['s15-equity-with-rate-and-term'])
  assert.equal(equity.projects[0].data.sources.rows[1].interestRate, 0.08)

  const typed = await importScenario(by['s13-typed-payment-too-low'])
  assert.equal(typed.projects[0].data.sources.rows[0].paymentOverride, 100000)

  const stage = await importScenario(by['s07-stage-contradicts-data'])
  assert.equal(stage.projects[0].data.timeline.stabilization, '2024-06')
})

test('the answer key file is up to date', async () => {
  const { renderAnswerKey } = await import('../samples/answerKey.js')
  const { readFileSync } = await import('node:fs')
  const onDisk = readFileSync(new URL('../samples/ANSWER-KEY.md', import.meta.url), 'utf8')
  assert.equal(onDisk, renderAnswerKey(), 'run: node src/modules/shared/samples/writeKey.mjs')
})

test('the committed sample files all load', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  for (const s of scenarios) {
    const file = new URL(`../../../../sample-files/${s.id}.xlsx`, import.meta.url)
    assert.ok(existsSync(file), `missing ${s.id}.xlsx: run node src/modules/shared/samples/writeFiles.mjs`)
    const out = await importWorkbook(new Uint8Array(readFileSync(file)))
    assert.deepEqual(out.report.layoutProblems, [], s.id)
    assert.ok(out.projects.length >= 1, s.id)
    if (s.t12) assert.ok(existsSync(new URL(`../../../../sample-files/${s.id}-t12.xlsx`, import.meta.url)), `${s.id} t12`)
  }
})

test('workbook facts: tab visibility, error cells and typed-over totals', async () => {
  const by = Object.fromEntries(scenarios.map((s) => [s.id, s]))

  const clean = await importScenario(by['s01-healthy-development'])
  assert.equal(clean.facts.errorCellsTotal, 0)
  assert.equal(clean.facts.typedOverTotal, 0)
  const proj = clean.facts.sheets.find((s) => s.name === 'Development Project 1 Details')
  assert.deepEqual([proj.state, proj.hasData, proj.errorCount], ['visible', true, 0])
  assert.equal(clean.facts.sheets.find((s) => s.name === 'Cover').hasData, null)

  const errors = await importScenario(by['s04-error-cells'])
  assert.deepEqual(errors.facts.errorCells.map((e) => `${e.tab}!${e.cell}=${e.value}`).sort(), ['Development Project 1 Details!E139=#REF!', 'Development Project 1 Details!H28=#DIV/0!'])
  assert.equal(errors.facts.sheets.find((s) => s.name === 'Development Project 1 Details').errorCount, 2)

  const hidden = await importScenario(by['s06-hidden-tab-with-data'])
  const tab = hidden.facts.sheets.find((s) => s.name === 'Development Project 2 Details')
  assert.deepEqual([tab.state, tab.hasData], ['veryHidden', true])

  const typed = await importScenario(by['s16-typed-over-total'])
  assert.deepEqual(typed.facts.typedOver, [{ tab: 'Development Project 1 Budget', cell: 'G102', value: 5000000 }])
})

test('facts survive saving a review, and an older review without them still opens', async () => {
  const { buildReview, serializeReview, parseReview } = await import('../reviewFile.js')
  const out = await importScenario(scenarios.find((s) => s.id === 's16-typed-over-total'))
  const back = parseReview(serializeReview(buildReview(out)))
  assert.deepEqual(back.facts.typedOver, out.facts.typedOver)

  const old = JSON.parse(serializeReview(buildReview(out)))
  old.facts = { sheets: old.facts.sheets.map((s) => ({ name: s.name, state: s.state })) }
  const opened = parseReview(JSON.stringify(old))
  assert.deepEqual([opened.facts.errorCells, opened.facts.typedOver, opened.facts.sheets[0].errorCount], [[], [], 0])

  const bad = JSON.parse(serializeReview(buildReview(out)))
  bad.facts.typedOver = [{ tab: 'x', cell: 'A1', value: 'lots' }]
  assert.throws(() => parseReview(JSON.stringify(bad)))
})
