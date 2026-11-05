import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { importWorkbook, ImportError } from '../import/importWorkbook.js'
import { DETAILS_ANCHORS, FIRM_TABS } from '../import/workbookMap.js'
import { makeXlsx, forgeSize, applicantWorkbook, anchorCells } from './helpers.js'

const load = (bytes) => importWorkbook(bytes, { fileName: 'test.xlsx' })
const completedTab = (name, extra = {}) => ({
  name,
  cells: { ...anchorCells(DETAILS_ANCHORS), E3: name, D28: 'Bank', E28: 'Hard Debt', F28: 900000, G28: 240, H28: 0.06, D58: '2-bdr', E58: 10, G58: 900, H58: 1300, ...extra },
})

test('reads the firm and project, and remembers the cell every value came from', async () => {
  const out = await load(applicantWorkbook())
  assert.equal(out.firm.data.identity.name, 'Maple Ridge Partners')
  assert.equal(out.firm.data.balanceSheet.lines.cash.current, 120000)
  assert.equal(out.firm.data.earnings.rows[0].fiscalYear, 2025)
  assert.equal(out.projects.length, 1)
  const p = out.projects[0]
  assert.equal(p.data.identity.name, 'Harbor View Lofts')
  assert.equal(p.data.sources.rows[0].amount, 3000000)
  assert.equal(p.data.sources.rows[0].type, 'hard_debt')
  assert.equal(p.sources['sources.rows.0.amount'], 'Development Project 1 Details!F28')
  assert.equal(p.data.budget.lines.land.amount, 600000)
  assert.equal(out.report.workbook.version, 'Version 1.9')
  assert.equal(out.report.workbook.versionKnown, true)
})

test('the stage and the as-of date are never filled in', async () => {
  const out = await load(applicantWorkbook())
  assert.equal(out.projects[0].data.stage.stage, null)
  assert.equal(out.projects[0].data.stage.asOfDate, null)
})

test('shared strings and inline strings read the same', async () => {
  const a = await load(applicantWorkbook({ sharedStrings: false }))
  const b = await load(applicantWorkbook({ sharedStrings: true }))
  assert.deepEqual(a.firm.data, b.firm.data)
  assert.deepEqual(a.projects[0].data, b.projects[0].data)
})

test('a hidden tab that contains data is reported', async () => {
  const out = await load(applicantWorkbook({ extraSheets: [{ ...completedTab('Completed Project 1 Details'), state: 'veryHidden' }] }))
  assert.ok(out.report.notes.some((n) => /very hidden but contains data/.test(n)))
  assert.ok(out.report.notes.some((n) => /Cover says 0 completed projects, but 1/.test(n)))
})

test('unused template tabs (placeholder name only) do not count as projects with data', async () => {
  const out = await load(applicantWorkbook({ extraSheets: [{ name: 'Completed Project 2 Details', cells: { ...anchorCells(DETAILS_ANCHORS), E3: 'Completed Project 2' } }] }))
  assert.equal(out.projects.length, 1)
})

test('error cells and text in a number field are reported', async () => {
  const out = await load(applicantWorkbook({ details: { E139: { error: '#REF!' }, F28: 'lots' } }))
  assert.ok(out.report.notes.some((n) => /shows an Excel error/.test(n)))
  assert.ok(out.report.notes.some((n) => /F28 holds text or an unexpected value where a dollar amount was expected/.test(n)))
  assert.equal(out.report.errorCells[0].value, '#REF!')
})

test('a formula that comes out as zero is not an entry, but a typed zero is', async () => {
  const out = await load(applicantWorkbook({ details: { P60: { formula: 'A1*0', value: 0 }, O86: 0, G84: 1000, H84: 20 } }))
  assert.equal(out.projects[0].data.residentialIncome.stabilizedVacancy, null)
  assert.equal(out.projects[0].data.commercialIncome.stabilizedVacancy, 0)
})

test('a tab with a different layout is skipped, never misread', async () => {
  const out = await load(applicantWorkbook({ extraSheets: [{ name: 'Completed Project 3 Details', cells: { D3: 'Something else', E3: 'Mystery', D28: 'x' } }] }))
  assert.equal(out.projects.length, 1)
  assert.ok(out.report.layoutProblems.some((l) => l.tab === 'Completed Project 3 Details'))
})

test('swapped column headers are noticed (term and interest swapped)', async () => {
  const out = await load(applicantWorkbook({ details: { G27: 'Interest %', H27: 'Term (Months)', G28: 0.065, H28: 360 } }))
  assert.ok(out.projects.every((p) => p.data.sources.rows.length === 0), 'no loan values were read from the tab with moved columns')
  assert.ok(out.report.layoutProblems[0].problems.some((p) => /term/.test(p)))
  assert.ok(out.report.notes.some((n) => /different layout than expected/.test(n)))
})

test('the layout check accepts the normal headers', async () => {
  const out = await load(applicantWorkbook())
  assert.deepEqual(out.report.layoutProblems, [])
})

// Dates: Excel files use one of two date systems, and a file says which.
for (const [label, date1904] of [['1900 date system', false], ['1904 date system (Mac)', true]]) {
  test(`dates read correctly in the ${label}`, async () => {
    const day = Date.UTC(2026, 5, 30)
    const serial = (day - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 86400000
    const out = await load(
      makeXlsx({
        date1904,
        sheets: [
          { name: 'Cover', cells: { ...anchorCells(FIRM_TABS.Cover), G2: 'Version 1.9' } },
          { name: 'Consol Financials & Projections', cells: { ...anchorCells(FIRM_TABS['Consol Financials & Projections']), C5: serial, C9: 150000 } },
          { name: 'Principal PFS', cells: { ...anchorCells(FIRM_TABS['Principal PFS']), B7: serial } },
        ],
      }),
    )
    assert.equal(out.firm.data.earnings.rows[0].fiscalYear, 2026)
    assert.equal(out.firm.data.principalStatement.statementDate, '2026-06-30')
  })
}

test('hostile cell text and sheet names are inert', async () => {
  const out = await load(
    applicantWorkbook({
      details: { E3: '<script>window.__xss=1</script>', D28: '"><svg onload=alert(1)>' },
      extraSheets: [{ name: '__proto__', cells: { A1: 'x' } }, { name: 'constructor', cells: { A1: 'y' } }],
    }),
  )
  assert.equal(out.projects[0].data.identity.name, '<script>window.__xss=1</script>')
  assert.equal(out.projects[0].data.sources.rows[0].name, '"><svg onload=alert(1)>')
  assert.equal({}.polluted, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'x'), false)
})

test('files that are not workbooks get a plain message', async () => {
  for (const bytes of [new Uint8Array(), strToU8('hello'), strToU8('PK\u0003\u0004 not really a zip'), zipSync({ 'readme.txt': strToU8('hi') })]) {
    await assert.rejects(() => load(bytes), (e) => e instanceof ImportError && /Excel workbook|could not be opened/.test(e.message))
  }
})

test('a password-protected or old-format file gets its own message', async () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  await assert.rejects(() => load(ole), (e) => e instanceof ImportError && /password|old/.test(e.message))
})

test('projects are identified by their full tab name, so "03" and "3" cannot collide', async () => {
  const out = await load(applicantWorkbook({ extraSheets: [completedTab('Completed Project 03 Details'), completedTab('Completed Project 3 Details')] }))
  const ids = out.projects.map((p) => p.meta.projectId)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(out.projects.length, 3)
})

// ---- Attacks found in the code review

test('cells that are never closed do not take quadratic time (a 3 KB file used to freeze the page)', async () => {
  const rawXml = `<worksheet><sheetData>${'<c r="A1"><v>1</v>'.repeat(40000)}</sheetData></worksheet>`
  const bytes = applicantWorkbook({ extraSheets: [{ name: 'Completed Project 1 Details', cells: {}, rawXml }] })
  const t0 = Date.now()
  await load(bytes)
  const ms = Date.now() - t0
  assert.ok(ms < 1500, `took ${ms} ms (it was about 5000 ms before the fix)`)
})

test('a large well-formed sheet reads in linear time', async () => {
  const cells = {}
  for (let i = 1; i <= 100000; i++) cells[`A${i}`] = i
  const bytes = makeXlsx({ sheets: [{ name: 'Cover', cells: { ...anchorCells(FIRM_TABS.Cover), ...cells } }] })
  const t0 = Date.now()
  await load(bytes)
  assert.ok(Date.now() - t0 < 3000)
})

test('a sheet with an absurd number of cells is refused', async () => {
  let body = ''
  for (let i = 1; i <= 2_100_000; i++) body += `<c r="A${i}"><v>1</v></c>` // distinct addresses, so they all count
  const rawXml = `<worksheet><sheetData>${body}</sheetData></worksheet>`
  await assert.rejects(() => load(applicantWorkbook({ extraSheets: [{ name: 'Completed Project 1 Details', cells: {}, rawXml }] })), (e) => e instanceof ImportError && /too many cells/.test(e.message))
})

test('a zip that lies about its size is refused quickly, not inflated', async () => {
  const big = new Uint8Array(150 * 1024 * 1024).fill(32) // 150 MB of spaces; compresses to a tiny file
  const bomb = forgeSize(
    zipSync(
      {
        'xl/workbook.xml': strToU8('<workbook xmlns:r="x"><sheets><sheet name="Cover" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': big,
      },
      { level: 1 },
    ),
    'xl/worksheets/sheet1.xml',
    1000, // the header claims 1 KB
  )
  assert.ok(bomb.length < 1024 * 1024, 'the bomb file itself is small')
  const t0 = Date.now()
  await assert.rejects(() => load(bomb), (e) => e instanceof ImportError && /more data than/.test(e.message))
  assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0} ms`)
})
