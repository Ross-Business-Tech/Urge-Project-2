import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../index.js'
import { openWorkbook, ImportError } from '../import/xlsxReader.js'
import { makeXlsx, roundNumberProject, t12Month } from './helpers.js'

const T12 = M.projectSchema.find((g) => g.id === 't12')
const HEADER_ROW = 4
const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const colOf = (key) => COLS[T12.columns.findIndex((c) => c.key === key)]

// A filled-in template: the real template builder, with some rows typed in.
const filled = (rows) => M.buildT12Template({ rows })
// A hand-made sheet (for layouts the template builder would never produce): headers in row 1, data under it.
function sheet(headers, rows, extra = {}) {
  const cells = {}
  headers.forEach((h, i) => (cells[`${COLS[i]}1`] = h))
  rows.forEach((row, r) => row.forEach((v, i) => v !== undefined && (cells[`${COLS[i]}${r + 2}`] = v)))
  return makeXlsx({ sheets: [{ name: 'Whatever', cells }], ...extra })
}

test('the template is a real workbook with the T-12 columns and room for 12 months', () => {
  const bytes = M.buildT12Template()
  const wb = openWorkbook(bytes)
  assert.equal(wb.sheets[0].name, 'T-12')
  const cells = wb.cells('T-12')
  assert.match(cells.get('A1').value, /T-12 template, version 1/)
  assert.match(cells.get('A2').value, /One row per month/)
  T12.columns.forEach((c, i) => assert.equal(cells.get(`${COLS[i]}${HEADER_ROW}`).value, c.label))
  assert.equal(M.parseT12Template(bytes).rows.length, 0, 'a blank template has no months')
})

test('a filled-in template is read back exactly, with the cell each value came from', () => {
  const rows = [t12Month('2026-05-31'), t12Month('2026-06-30', { occupancy: 0.9, debtService: 17000, noiReported: 50000 })]
  const out = M.parseT12Template(filled(rows))
  assert.equal(out.rows.length, 2)
  for (const key of ['residentialRevenue', 'vacancyLoss', 'concessions', 'occupancy', 'propertyTaxes', 'otherExpenses']) assert.equal(out.rows[0][key], rows[0][key], key)
  assert.equal(out.rows[1].month, '2026-06-30')
  assert.equal(out.rows[1].debtService, 17000)
  assert.equal(out.sources['t12.rows.1.debtService'], `T-12 template!${colOf('debtService')}${HEADER_ROW + 2}`)
  assert.deepEqual(out.notes, [])
  assert.equal(Object.keys(out.rows[0]).length, T12.columns.length, 'every column is present (blank ones are null)')
})

test('columns are found by their header, so reordered and extra columns are fine', () => {
  const bytes = sheet(['Occupancy', 'Notes from the owner', 'Month', 'Residential revenue'], [[0.93, 'hello', '2026-06-30', 60000]])
  const out = M.parseT12Template(bytes)
  assert.equal(out.rows[0].month, '2026-06-30')
  assert.equal(out.rows[0].occupancy, 0.93)
  assert.equal(out.rows[0].residentialRevenue, 60000)
  assert.ok(out.notes.some((n) => /Notes from the owner/.test(n) && /ignored/.test(n)))
})

test('a workbook with no Month column is refused with a plain message', () => {
  assert.throws(() => M.parseT12Template(sheet(['Revenue', 'Costs'], [[1, 2]])), (e) => e instanceof ImportError && /Month/.test(e.message))
})

test('months can be Excel dates in either date system, or text', () => {
  const serial = (y, m, d, is1904) => (Date.UTC(y, m - 1, d) - (is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 86400000
  for (const is1904 of [false, true]) {
    const out = M.parseT12Template(sheet(['Month', 'Residential revenue'], [[serial(2026, 3, 31, is1904), 1], ['2026-04', 2], ['2026-05-31', 3]], { date1904: is1904 }))
    assert.deepEqual(out.rows.map((r) => r.month), ['2026-03-31', '2026-04', '2026-05-31'])
  }
})

test('rows without a usable month are skipped and said so', () => {
  const out = M.parseT12Template(sheet(['Month', 'Residential revenue'], [['2026-05-31', 1], ['next tuesday', 2], [undefined, 3], ['2026-02-30', 4]]))
  assert.deepEqual(out.rows.map((r) => r.month), ['2026-05-31'])
  assert.equal(out.notes.filter((n) => /no usable month/i.test(n)).length, 3)
})

test('a percentage typed as a whole number is refused for that cell, not guessed', () => {
  const out = M.parseT12Template(sheet(['Month', 'Occupancy'], [['2026-05-31', 95], ['2026-06-30', '95%'], ['2026-07-31', 0.95]]))
  assert.equal(out.rows[0].occupancy, null)
  assert.ok(out.notes.some((n) => /2026-05-31/.test(n) && /Occupancy/.test(n) && /95%|0\.95/.test(n)))
  assert.equal(out.rows[1].occupancy, 0.95, 'the text "95%" is understood')
  assert.equal(out.rows[2].occupancy, 0.95)
})

test('amounts: text, negatives and Excel errors are refused for that cell; vacancy and concessions may be negative', () => {
  const out = M.parseT12Template(
    sheet(['Month', 'Residential revenue', 'Property taxes', 'Vacancy loss', 'Concessions and free rent', 'Commercial revenue'],
      [['2026-05-31', 'lots', -5000, -3000, -1000, { error: '#REF!' }]]),
  )
  const r = out.rows[0]
  assert.equal(r.residentialRevenue, null)
  assert.equal(r.propertyTaxes, null)
  assert.equal(r.vacancyLoss, -3000)
  assert.equal(r.concessions, -1000)
  assert.equal(r.commercialRevenue, null)
  assert.equal(out.notes.length, 3)
})

test('more than 12 months is refused, not silently cut', () => {
  const rows = Array.from({ length: 13 }, (_, i) => [`2025-${String(i + 1 > 12 ? 12 : i + 1).padStart(2, '0')}-28`, i])
  rows[12][0] = '2026-01-31'
  assert.throws(() => M.parseT12Template(sheet(['Month', 'Residential revenue'], rows)), (e) => e instanceof ImportError && /at most 12/.test(e.message))
})

test('a month entered twice is reported', () => {
  const out = M.parseT12Template(sheet(['Month', 'Residential revenue'], [['2026-06-30', 1], ['2026-06', 2]]))
  assert.equal(out.rows.length, 2)
  assert.ok(out.notes.some((n) => /2026-06/.test(n) && /more than once/.test(n)))
})

test('hostile text in the template is just text', () => {
  const out = M.parseT12Template(sheet(['Month', '<script>x</script>'], [['2026-06-30', 'onerror=alert(1)']]))
  assert.equal(out.rows.length, 1)
  assert.ok(out.notes.every((n) => typeof n === 'string'))
})

test('things that are not workbooks are refused with the usual messages', () => {
  assert.throws(() => M.parseT12Template(new TextEncoder().encode('hello')), ImportError)
})

// ---------------------------------------------------------------- putting it into a project
test('loading a template replaces the T-12 rows and their history, and leaves everything else alone', () => {
  const project = roundNumberProject('completed')
  let p = M.addTableRow(project, T12)
  p = M.setValue(p, 't12.rows.0.month', '2025-01-31')
  assert.equal(p.sources['t12.rows.0.month'], 'manual')
  const parsed = M.parseT12Template(filled(['2026-04-30', '2026-05-31', '2026-06-30'].map((m) => t12Month(m))))
  const next = M.replaceT12Rows(p, parsed)
  assert.equal(next.data.t12.rows.length, 3)
  assert.equal(next.data.t12.rows[0].month, '2026-04-30')
  assert.equal(next.sources['t12.rows.0.month'], `T-12 template!A${HEADER_ROW + 1}`)
  assert.ok(!Object.keys(next.sources).some((k) => k.startsWith('t12.rows.3')))
  assert.equal(JSON.stringify(next.data.sources), JSON.stringify(p.data.sources), 'sources of money untouched')
  assert.equal(p.data.t12.rows.length, 1, 'the original record is unchanged')
})

test('a loaded T-12 feeds the ratios', () => {
  const months = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']
  const parsed = M.parseT12Template(filled(months.map((m) => t12Month(m))))
  const p = M.replaceT12Rows(roundNumberProject('completed'), parsed)
  const trailing = M.keyRatios(p).find((r) => r.id === 'trailing')
  assert.equal(trailing.streak, 6)
  assert.equal(trailing.status, 'ok')
})
