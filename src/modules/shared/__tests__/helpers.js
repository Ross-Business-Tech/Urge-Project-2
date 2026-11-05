// Test helpers: build small fake workbooks in code, so tests need no binary files and never touch real data.

import { FIRM_TABS, DETAILS_ANCHORS, BUDGET_ANCHORS } from '../import/workbookMap.js'
import { blankProject } from '../records.js'

// The tests build fake workbooks with the same writer the app uses for the T-12 template.
export { writeXlsx as makeXlsx } from '../import/xlsxWriter.js'
import { writeXlsx as makeXlsx } from '../import/xlsxWriter.js'

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
