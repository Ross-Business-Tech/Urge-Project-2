import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../index.js'
import { importWorkbook } from '../import/importWorkbook.js'
import { applicantWorkbook, anchorCells } from './helpers.js'
import { DETAILS_ANCHORS } from '../import/workbookMap.js'

const second = { name: 'Completed Project 1 Details', cells: { ...anchorCells(DETAILS_ANCHORS), E3: 'Cedar Court', D28: 'Bank', E28: 'Hard Debt', F28: 900000, G28: 240, H28: 0.06, K28: 4000, D58: '2-bdr', E58: 10, G58: 900, H58: 1300 } }
const imported = () => importWorkbook(applicantWorkbook({ extraSheets: [second] }), { fileName: 'test.xlsx' })
const asText = (result, now = new Date('2026-11-05T12:00:00Z')) => M.serializeReview(M.buildReview(result, now))
const mutate = (text, fn) => {
  const r = JSON.parse(text)
  fn(r)
  return JSON.stringify(r)
}
const refused = (text, pattern) => assert.throws(() => M.parseReview(text), (e) => e instanceof M.ReviewFileError && pattern.test(e.message))

test('a saved review reopens exactly as it was saved', async () => {
  const result = await imported()
  const back = M.parseReview(asText(result))
  assert.deepEqual(back.firm, result.firm)
  assert.deepEqual(back.projects, result.projects)
  assert.deepEqual(back.facts, result.facts)
  assert.deepEqual(back.report, result.report)
  assert.deepEqual(back.settings, M.DEFAULT_SETTINGS)
  assert.equal(M.reviewFileName(new Date(2026, 10, 5)), 'underwriting-review-2026-11-05.json')
})

test('files that are not reviews are refused with a plain message', async () => {
  const text = asText(await imported())
  refused('hello there', /could not be read/)
  refused('{"a":1}', /not a saved review/)
  refused('[]', /not a saved review/)
  refused('x'.repeat(M.MAX_REVIEW_BYTES + 1), /too big/)
  refused(mutate(text, (r) => (r.formatVersion = 99)), /newer version/)
  refused(mutate(text, (r) => (r.schemaVersion = 99)), /newer record layout/)
})

test('tampering keys are refused anywhere in the file', async () => {
  const text = asText(await imported())
  refused(text.replace('"kind": "underwriting-review"', '"kind": "underwriting-review", "__proto__": {"x": 1}'), /not allowed/)
  refused(mutate(text, (r) => (r.firm.data.identity.constructor = { a: 1 })), /not allowed/)
  assert.equal({}.x, undefined)
})

// ---------------------------------------------------------------- damaged but plausible-looking files must be refused, not rendered
const DAMAGE = [
  ['a project missing', (r) => delete r.projects],
  ['a project of the wrong kind', (r) => (r.projects[0].kind = 'firm')],
  ['a project with no stage section', (r) => delete r.projects[0].data.stage],
  ['a project with no id', (r) => delete r.projects[0].meta],
  ['a made-up stage', (r) => (r.projects[0].data.stage.stage = 'banana')],
  ['an impossible date', (r) => (r.projects[0].data.stage.asOfDate = '2026-02-30')],
  ['a table that is not a table', (r) => (r.projects[0].data.sources = 'not a table')],
  ['a table whose rows are not a list', (r) => (r.projects[0].data.sources.rows = 'x')],
  ['a table with an empty entry in it', (r) => (r.projects[0].data.sources.rows = [{ amount: 1 }, null])],
  ['a table row that is not an object', (r) => (r.projects[0].data.sources.rows = [5])],
  ['a value that is an object', (r) => (r.projects[0].data.identity.name = { a: 1 })],
  ['a value that is a list', (r) => (r.projects[0].data.sources.rows[0].amount = [1])],
  ['a grid line that is missing', (r) => delete r.projects[0].data.budget.lines.land],
  ['a grid with no lines', (r) => (r.projects[0].data.budget.lines = [])],
  ['a group missing from the firm', (r) => delete r.firm.data.owners],
  ['far too many rows', (r) => (r.projects[0].data.sources.rows = Array.from({ length: 5000 }, () => ({ amount: 1 })))],
  ['a very long text value', (r) => (r.projects[0].data.identity.name = 'x'.repeat(100000))],
  ['the provenance map is not an object', (r) => (r.projects[0].originals = 'x')],
  ['a source that is not text', (r) => (r.projects[0].sources['identity.name'] = { a: 1 })],
  ['two projects with the same id', (r) => (r.projects[1].meta.projectId = r.projects[0].meta.projectId)],
  ['a report file name that is an object', (r) => (r.report.fileName = { a: 1 })],
  ['a report with no notes', (r) => delete r.report.notes],
  ['a report note that is not text', (r) => (r.report.notes = [{ a: 1 }])],
  ['a report project with no groups', (r) => delete r.report.projects[0].groups],
  ['a report group with a non-numeric count', (r) => (r.report.firmGroups[0].filled = 'many')],
  ['a project with data that has no record', (r) => (r.report.projects[0].id = 'somebody-else')],
  ['facts with no sheet list', (r) => delete r.facts.sheets],
]
for (const [name, change] of DAMAGE) {
  test(`damaged file is refused: ${name}`, async () => {
    const text = asText(await imported())
    refused(mutate(text, change), /damaged or incomplete|not allowed|too big/)
  })
}

test('a valid stage, date and settings are kept; bad settings fall back to defaults', async () => {
  const text = asText(await imported())
  const good = M.parseReview(mutate(text, (r) => {
    r.projects[0].data.stage.stage = 'completed'
    r.projects[0].data.stage.asOfDate = '2026-03-31'
    r.settings = { ...M.DEFAULT_SETTINGS, minDscr: 1.35, consecutiveMonths: 6 }
  }))
  assert.equal(good.projects[0].data.stage.stage, 'completed')
  assert.equal(good.settings.minDscr, 1.35)
  assert.equal(good.settings.consecutiveMonths, 6)
  const wild = M.parseReview(mutate(text, (r) => (r.settings = { minDscr: 99, consecutiveMonths: 2.5, occupancyFloor: 'high', noiVsUnderwritten: 0.8 })))
  assert.equal(wild.settings.minDscr, M.DEFAULT_SETTINGS.minDscr)
  assert.equal(wild.settings.consecutiveMonths, M.DEFAULT_SETTINGS.consecutiveMonths)
  assert.equal(wild.settings.occupancyFloor, M.DEFAULT_SETTINGS.occupancyFloor)
  assert.equal(wild.settings.noiVsUnderwritten, 0.8)
  assert.deepEqual(M.parseReview(mutate(text, (r) => delete r.settings)).settings, M.DEFAULT_SETTINGS)
})

test('an older file without provenance maps gets empty ones', async () => {
  const old = M.parseReview(mutate(asText(await imported()), (r) => { delete r.projects[0].originals; delete r.firm.sources }))
  assert.deepEqual(old.projects[0].originals, {})
  assert.deepEqual(old.firm.sources, {})
})

// ---------------------------------------------------------------- typed payments changed from monthly to yearly (layout version 2)
test('a review saved when typed payments were monthly is converted to yearly, history included', async () => {
  const result = await imported()
  const cedar = result.projects.find((p) => p.data.identity.name === 'Cedar Court')
  assert.equal(cedar.data.sources.rows[0].paymentOverride, 4000)
  const edited = M.setValue(cedar, 'sources.rows.0.paymentOverride', 5000) // keeps 4000 as the original
  const v1 = JSON.parse(asText({ ...result, projects: [result.projects[0], edited] }))
  v1.schemaVersion = 1 // pretend an older version of the tool saved this
  const migrated = M.parseReview(JSON.stringify(v1))
  assert.equal(migrated.schemaVersion, M.SCHEMA_VERSION)
  const row = migrated.projects[1].data.sources.rows[0]
  assert.equal(row.paymentOverride, 60000, '5,000 a month is 60,000 a year')
  assert.equal(migrated.projects[1].originals['sources.rows.0.paymentOverride'].value, 48000, 'and the applicant original 4,000 a month is 48,000')
  assert.equal(M.annualDebtService(migrated.projects[1]).value, 60000)
  assert.equal(migrated.projects[0].data.sources.rows[0].paymentOverride, null, 'projects without a typed payment are untouched')
})

test('a review already in the current layout is not converted again', async () => {
  const result = await imported()
  const back = M.parseReview(asText(result))
  assert.equal(back.projects[1].data.sources.rows[0].paymentOverride, 4000)
})
