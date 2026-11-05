// Where each part of the firm and project records lives in the applicant workbook (cover version 1.9).
// Built by M0. The schema says WHAT we store; this file says WHERE to read it.
//
// Group specs come in four shapes:
//   fields: { key: 'C8' }                              single cells
//   table:  { first, last, cols, keepIf }              one row per entry; a row is kept if any `keepIf` column has a value
//   grid:   { cols }                                   fixed lines; each line's row number comes from the schema
//   years:  { headerRow, cols }                        one entry per column (a fiscal year); lines come from the schema
// A spec may also have `fields` (single cells) in addition to its table or grid.

import { firmSchema, projectSchema } from '../schema.js'

export const KNOWN_VERSIONS = ['version 1.9']
export const PROJECT_TAB = /^(Development|Completed) Project (\d+) Details$/

// Words that must appear at known cells, so a changed layout is noticed instead of silently misread.
// Each entry is [cell, text that the cell's label should contain].
export const FIRM_TABS = {
  Cover: [
    ['B8', 'name of firm'],
    ['B9', 'number of development projects'],
    ['B10', 'number of completed projects'],
  ],
  'Balance Sheet': [
    ['A9', 'cash'],
    ['A34', 'total assets'],
    ['A38', 'accounts payable'],
    ['A53', 'capital stock'],
    ['A59', 'total liabilities'],
  ],
  'Principal PFS': [
    ['A11', 'cash checking'],
    ['A19', 'real estate owned'],
    ['A30', 'property mortgages'],
    ['A36', 'net worth'],
  ],
  'Consol Financials & Projections': [
    ['A9', 'developer fee'],
    ['A17', 'total revenue'],
    ['A21', 'salaries'],
    ['A33', 'total sg a'],
  ],
  'Cap Table': [
    ['B8', 'secured debt'],
    ['B19', 'total capitalization'],
  ],
}

// Every column header the project map reads is checked, so moved or swapped columns are noticed instead of misread.
export const DETAILS_ANCHORS = [
  ['D3', 'development name'],
  ['D10', 'firm name'],
  ['E10', 'firm principal'],
  ['F10', 'ownership percentage'],
  ['C20', 'construction start'],
  ['D27', 'name of source'],
  ['E27', 'type of source'],
  ['G27', 'term'],
  ['H27', 'interest'],
  ['K27', 'payment override'],
  ['C45', 'acquisition'],
  ['C57', 'ami'],
  ['D57', 'unit type'],
  ['E57', 'units'],
  ['F57', 'baths'],
  ['G57', 'sq ft'],
  ['H57', 'mo rent'],
  ['C83', 'lease type'],
  ['D83', 'description'],
  ['G83', 'sq ft'],
  ['H83', 'rent sq ft'],
  ['G103', 'monthly income'],
  ['C124', 'property management'],
  ['C132', 'replacement reserves'],
  ['C138', 'property liability'],
  ['C139', 'property taxes'],
]

export const BUDGET_ANCHORS = [
  ['A1', 'total development costs'],
  ['B3', 'land'],
  ['B40', 'construction contingency'],
  ['B49', 'architectural'],
  ['B61', 'construction interest'],
  ['B76', 'developer fee'],
  ['B85', 'rent up reserve'],
  ['B87', 'operating reserve'],
  ['B88', 'soft cost contingency'],
]

export const COVER_VERSION_CELL = 'G2'

const FIRM_YEAR_COLUMNS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']

export const firmMap = {
  identity: {
    tab: 'Cover',
    fields: { name: 'C8', street: 'C13', cityStateZip: 'C14', principalName: 'C17', developmentProjectCount: 'C9', completedProjectCount: 'C10' },
  },
  owners: {
    tab: 'Cover',
    table: {
      rows: [
        { name: 'C17', ownershipPct: 'C18' },
        { name: 'C21', ownershipPct: 'C22' },
        { name: 'C24', ownershipPct: 'C25' },
        { name: 'C27', ownershipPct: 'C28' },
      ],
      keepIf: ['name', 'ownershipPct'],
    },
  },
  balanceSheet: { tab: 'Balance Sheet', fields: { currentPeriod: 'B6', priorPeriod: 'D6' }, grid: { cols: { current: 'B', prior: 'D' } } },
  principalStatement: { tab: 'Principal PFS', fields: { name: 'B5', statementDate: 'B7' }, grid: { cols: { amount: 'D' } } },
  earnings: { tab: 'Consol Financials & Projections', years: { headerRow: 5, cols: FIRM_YEAR_COLUMNS } },
  capital: { tab: 'Cap Table', grid: { cols: { committed: 'C', funded: 'D' } } },
  // The project list is filled in from the project tabs that were found, not from cells.
  projects: { tab: null },
}

// Project groups. `tab` is 'details' (the project's Details tab) or 'budget' (its Budget tab, development projects only).
export const projectMap = {
  identity: { tab: 'details', fields: { name: 'E3', address: 'E4', constructionType: 'E5', propertyType: 'E6', confidential: 'D184' } },
  stage: { tab: null }, // chosen by the underwriter, never read
  team: { tab: 'details', grid: { cols: { firmName: 'D', principal: 'E', ownershipPct: 'F' } } },
  timeline: { tab: 'details', fields: { constructionStart: 'E20', constructionCompletion: 'E21', stabilization: 'E22' } },
  sources: {
    tab: 'details',
    table: {
      first: 28,
      last: 41,
      cols: { lienPriority: 'C', name: 'D', type: 'E', amount: 'F', termMonths: 'G', interestRate: 'H', paymentOverride: 'K' },
      keepIf: ['name', 'type', 'amount'],
    },
  },
  budget: { tab: 'budget', grid: { cols: { amount: 'G' } } },
  residentialIncome: {
    tab: 'details',
    table: {
      first: 58,
      last: 78,
      cols: { amiLevel: 'C', unitType: 'D', units: 'E', baths: 'F', sqft: 'G', monthlyRent: 'H' },
      keepIf: ['unitType', 'units', 'sqft', 'monthlyRent'],
    },
    fields: { rentIncreaseYear2: 'P58', rentIncreaseYear3: 'Q58', rentIncreaseFuture: 'R58', stabilizedVacancy: 'P60' },
  },
  commercialIncome: {
    tab: 'details',
    table: {
      first: 84,
      last: 98,
      cols: { leaseType: 'C', description: 'D', sqft: 'G', rentPerSqft: 'H' },
      keepIf: ['sqft', 'rentPerSqft'],
    },
    fields: { rentIncreaseYear2: 'O84', rentIncreaseYear3: 'P84', rentIncreaseFuture: 'Q84', stabilizedVacancy: 'O86' },
  },
  otherIncome: {
    tab: 'details',
    table: { first: 104, last: 113, cols: { description: 'D', monthlyIncome: 'G' }, keepIf: ['monthlyIncome'] },
    fields: { inflationYear2: 'J105', inflationYear3: 'K105', inflationFuture: 'L105' },
  },
  operatingExpenses: { tab: 'details', grid: { cols: { amount: 'E' } } },
  otherExpenses: { tab: 'details', table: { first: 141, last: 145, cols: { description: 'D', amount: 'E' }, keepIf: ['amount'] } },
  t12: { tab: null }, // loaded separately from the T-12 template
}

// Check that every schema group has a map entry and every mapped key exists in the schema.
// Returns a list of problems (empty list means the map and schema agree).
export function checkMapCoverage() {
  const problems = []
  const check = (schema, map, label) => {
    for (const g of schema) {
      const spec = map[g.id]
      if (!spec) {
        problems.push(`${label}: no map entry for group ${g.id}`)
        continue
      }
      const keysIn = (list) => new Set((list || []).map((i) => i.key))
      const fieldKeys = keysIn(g.fields)
      const colKeys = keysIn(g.columns)
      for (const k of Object.keys(spec.fields || {})) if (!fieldKeys.has(k)) problems.push(`${label}.${g.id}: unknown field ${k}`)
      if (spec.table) {
        const cols = spec.table.cols || spec.table.rows?.[0] || {}
        for (const k of Object.keys(cols)) if (!colKeys.has(k)) problems.push(`${label}.${g.id}: unknown column ${k}`)
        for (const k of spec.table.keepIf || []) if (!colKeys.has(k)) problems.push(`${label}.${g.id}: unknown keepIf ${k}`)
      }
      if (spec.grid) for (const k of Object.keys(spec.grid.cols)) if (!colKeys.has(k)) problems.push(`${label}.${g.id}: unknown grid column ${k}`)
    }
    for (const id of Object.keys(map)) if (!schema.some((g) => g.id === id)) problems.push(`${label}: map has unknown group ${id}`)
  }
  check(firmSchema, firmMap, 'firm')
  check(projectSchema, projectMap, 'project')
  return problems
}
