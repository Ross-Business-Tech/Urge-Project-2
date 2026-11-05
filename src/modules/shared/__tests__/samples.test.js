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
