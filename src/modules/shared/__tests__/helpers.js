// Test helpers: build small fake workbooks in code, so tests need no binary files and never touch real data.

import { zipSync, strToU8 } from 'fflate'
import { FIRM_TABS, DETAILS_ANCHORS, BUDGET_ANCHORS } from '../import/workbookMap.js'
import { blankProject } from '../records.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// cells: { A1: 'text' | 123 | true | { error: '#REF!' } | { formula: 'A1+1', value: 3 } }
function cellXml(addr, v, shared) {
  if (typeof v === 'number') return `<c r="${addr}"><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${addr}" t="b"><v>${v ? 1 : 0}</v></c>`
  if (typeof v === 'string') {
    return shared ? `<c r="${addr}" t="s"><v>${shared(v)}</v></c>` : `<c r="${addr}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
  }
  if (v && v.error) return `<c r="${addr}" t="e"><v>${esc(v.error)}</v></c>`
  if (v && v.formula !== undefined) {
    return typeof v.value === 'string'
      ? `<c r="${addr}" t="str"><f>${esc(v.formula)}</f><v>${esc(v.value)}</v></c>`
      : `<c r="${addr}"><f>${esc(v.formula)}</f><v>${v.value}</v></c>`
  }
  throw new Error(`Cannot write cell ${addr}`)
}

// sheets: [{ name, state?: 'hidden' | 'veryHidden', cells, rawXml? }]
export function makeXlsx({ sheets, date1904 = false, sharedStrings = false, extraParts = {} }) {
  const sst = []
  const shared = sharedStrings ? (s) => (sst.includes(s) ? sst.indexOf(s) : sst.push(s) - 1) : null
  const parts = { ...extraParts }
  sheets.forEach((sheet, i) => {
    let xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    const rows = new Map()
    for (const [addr, v] of Object.entries(sheet.cells ?? {})) {
      const r = Number(addr.match(/\d+/)[0])
      if (!rows.has(r)) rows.set(r, [])
      rows.get(r).push(cellXml(addr, v, shared))
    }
    for (const [r, cells] of [...rows].sort((a, b) => a[0] - b[0])) xml += `<row r="${r}">${cells.join('')}</row>`
    parts[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheet.rawXml ?? `${xml}</sheetData></worksheet>`)
  })
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`)
    .join('')
  parts['xl/workbook.xml'] = strToU8(
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${sheetTags}</sheets></workbook>`,
  )
  parts['xl/_rels/workbook.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `</Relationships>`,
  )
  if (sharedStrings) parts['xl/sharedStrings.xml'] = strToU8(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`)
  return zipSync(parts, { level: 6 })
}

// Overwrite the "uncompressed size" a zip file claims for one part (to simulate a lying header).
export function forgeSize(zipBytes, partName, fakeSize) {
  const bytes = zipBytes.slice()
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < bytes.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      const nameLen = view.getUint16(i + 28, true)
      if (new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLen)) === partName) view.setUint32(i + 24, fakeSize, true)
    }
  }
  return bytes
}

// Cells holding the label text a tab's layout check looks for.
export const anchorCells = (list) => Object.fromEntries(list.map(([addr, text]) => [addr, text]))

// A small but complete applicant workbook (all made up).
export function applicantWorkbook({ cover = {}, details = {}, budget = {}, extraSheets = [], date1904 = false, sharedStrings = false } = {}) {
  const sheets = [
    { name: 'Cover', cells: { ...anchorCells(FIRM_TABS.Cover), G2: 'Version 1.9', C8: 'Maple Ridge Partners', C9: 1, C10: 0, C17: 'Pat Sample', ...cover } },
    { name: 'Balance Sheet', cells: { ...anchorCells(FIRM_TABS['Balance Sheet']), B9: 120000, D9: 90000 } },
    { name: 'Principal PFS', cells: { ...anchorCells(FIRM_TABS['Principal PFS']), D11: 40000 } },
    { name: 'Consol Financials & Projections', cells: { ...anchorCells(FIRM_TABS['Consol Financials & Projections']), C5: 2025, C9: 150000 } },
    { name: 'Cap Table', cells: { ...anchorCells(FIRM_TABS['Cap Table']), C8: 2000000, D8: 1500000 } },
    {
      name: 'Development Project 1 Details',
      cells: {
        ...anchorCells(DETAILS_ANCHORS),
        E3: 'Harbor View Lofts', E4: '1 Sample Way', E20: 2026, E21: 2027, E22: 2028,
        D28: 'Example Bank', E28: 'Hard Debt', F28: 3000000, G28: 360, H28: 0.065,
        D58: '1-bdr', E58: 30, F58: 1, G58: 700, H58: 1500, P60: 0.07,
        E139: 90000,
        ...details,
      },
    },
    { name: 'Development Project 1 Budget', cells: { ...anchorCells(BUDGET_ANCHORS), G3: 600000, G15: 150000, ...budget } },
    ...extraSheets,
  ]
  return makeXlsx({ sheets, date1904, sharedStrings })
}

// A project built from round numbers so every ratio can be checked by hand (same one used throughout the calculator tests).
export function roundNumberProject(stage = 'development') {
  const p = blankProject()
  p.data.stage.stage = stage
  p.data.sources.rows = [
    { lienPriority: 1, name: 'Bank', type: 'hard_debt', amount: 3000000, termMonths: 360, interestRate: 0.06, paymentOverride: null },
    { lienPriority: 2, name: 'Sponsor', type: 'developer_equity', amount: 2000000, termMonths: null, interestRate: null, paymentOverride: null },
    { lienPriority: 3, name: 'Deferred fee', type: 'other', amount: 550000, termMonths: null, interestRate: null, paymentOverride: null },
  ]
  const L = p.data.budget.lines
  L.land.amount = 1000000; L.concreteMasonry.amount = 2000000; L.carpentry.amount = 1500000; L.constructionContingency.amount = 400000
  L.architectureEngineering.amount = 300000; L.softCostContingency.amount = 50000; L.rentUpReserve.amount = 200000; L.operatingReserve.amount = 100000
  p.data.residentialIncome.rows = [{ amiLevel: null, unitType: '1-bdr', units: 40, baths: 1, sqft: 700, monthlyRent: 1500 }]
  p.data.residentialIncome.stabilizedVacancy = 0.05
  p.data.commercialIncome.rows = [{ leaseType: 'nnn', description: 'Retail', sqft: 5000, rentPerSqft: 20 }]
  p.data.commercialIncome.stabilizedVacancy = 0.1
  p.data.otherIncome.rows = [{ description: 'Parking', monthlyIncome: 1000 }]
  const E = p.data.operatingExpenses.lines
  E.propertyManagement.amount = 50000; E.propertyTaxes.amount = 120000; E.replacementReserves.amount = 20000
  p.data.otherExpenses.rows = [{ description: 'Security', amount: 10000 }]
  return p
}

// One T-12 month: effective revenue 65,333, expenses 14,833, so NOI 50,500 (above the round-number project's 48,833 a month).
export const t12Month = (month, over = {}) => ({
  month, residentialRevenue: 60000, commercialRevenue: 8333, otherRevenue: 1000, vacancyLoss: 3000, concessions: 1000, occupancy: 0.95,
  propertyManagement: 4000, propertyTaxes: 10000, otherExpenses: 833, noiReported: null, debtService: null, ...over,
})

// A small seeded random generator, so a failing random test can be replayed.
export function rng(seed) {
  let s = seed >>> 0
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  return { next, pick: (list) => list[Math.floor(next() * list.length)], between: (a, b) => a + next() * (b - a) }
}
