// The demo pack: one clean firm, one healthy new building and one unhealthy new building, all in one workbook, so a single
// load shows what the tool does with each. Everything here is made up.
//
// The firm is Cedar Hollow Partners, the "proven sponsor" of the sponsor samples: a strong balance sheet and three finished
// projects that met their underwriting. Maple Court Apartments is a sound project. Harbor Point Towers breaks many things at once.

import { fullExampleProject } from './fullExample.js'
import { projectSchema } from '../schema.js'
import { sponsorSamples } from '../../m5-sponsor/samples/sponsorSamples.js'

export const DEMO_AS_OF = '2026-01-15'
export const DEMO_FILE = { workbook: 'demo-workbook', review: 'demo-review', benchmarks: 'demo-benchmarks' }

const proven = sponsorSamples.find((s) => s.id === 'proven-sponsor')

// The firm's finished projects, made three times the size (units, rents roll, costs, loans, income and expenses all scale together,
// and so do their T-12 results), so a new building of this size is not a leap for this firm, and the firm's loan payments stay
// in step with the income that pays them.
const SIZE = 3
const times = (v) => (typeof v === 'number' ? v * SIZE : v)
const bigger = (record) => {
  const d = record.data
  for (const l of Object.values(d.budget.lines)) l.amount = times(l.amount)
  for (const l of Object.values(d.operatingExpenses.lines)) l.amount = times(l.amount)
  for (const r of d.sources.rows) r.amount = times(r.amount)
  for (const r of d.residentialIncome.rows) r.units = times(r.units)
  for (const r of d.commercialIncome.rows) r.sqft = times(r.sqft)
  for (const r of d.otherIncome.rows) r.monthlyIncome = times(r.monthlyIncome)
  for (const r of d.otherExpenses.rows) r.amount = times(r.amount)
  return record
}
const MONEY = ['residentialRevenue', 'commercialRevenue', 'otherRevenue', 'vacancyLoss', 'concessions', 'propertyManagement', 'propertyTaxes', 'propertyLiabilityInsurance', 'replacementReserves', 'electricHeatCommon', 'waterSewer', 'garbage', 'contractRepairs', 'groundsMaintenance']
export const pastProjects = proven.past.map((x) => ({
  ...x,
  record: () => bigger(x.record()),
  t12: x.t12.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, MONEY.includes(k) ? times(v) : v]))),
}))

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const keysIn = (prefix) => BUDGET_ROWS.filter((r) => r.section.startsWith(prefix)).map((r) => r.key)
const CONTINGENCY = ['constructionContingency', 'ownersContingency', 'softCostContingency']
const scaleKeys = (record, keys, factor) => {
  for (const k of keys) {
    const line = record.data.budget.lines[k]
    if (typeof line.amount === 'number') line.amount = Math.round(line.amount * factor)
  }
}

const scale = (lines, factor) => {
  for (const line of Object.values(lines)) if (typeof line.amount === 'number') line.amount = Math.round(line.amount * factor)
}
const set = (record, patch) => {
  for (const [k, v] of Object.entries(patch)) record.data.budget.lines[k].amount = v
}

// Equal sources and uses: one senior loan, one city loan, a grant, a deferred fee, and sponsor equity as the balance.
function sources(record, { senior, seniorRate, city, grant, deferredFee }) {
  const uses = Object.values(record.data.budget.lines).reduce((a, l) => a + (l.amount ?? 0), 0)
  record.data.sources.rows = [
    { lienPriority: 1, name: 'Example Bank construction-to-permanent loan', type: 'hard_debt', amount: senior, termMonths: 360, interestRate: seniorRate, paymentOverride: null },
    { lienPriority: 2, name: 'City housing loan', type: 'gov_debt', amount: city, termMonths: 480, interestRate: 0.03, paymentOverride: null },
    { lienPriority: 3, name: 'State housing grant', type: 'nonrecoverable_grant', amount: grant, termMonths: null, interestRate: null, paymentOverride: null },
    { lienPriority: 4, name: 'Deferred developer fee', type: 'other', amount: deferredFee, termMonths: null, interestRate: null, paymentOverride: null },
    { lienPriority: 5, name: 'Sponsor equity', type: 'developer_equity', amount: uses - senior - city - grant - deferredFee, termMonths: null, interestRate: null, paymentOverride: null },
  ]
  return uses
}

// ---- the healthy project -------------------------------------------------------------------------------------------
export function healthyDemoProject() {
  const p = fullExampleProject('development')
  const d = p.data
  Object.assign(d.identity, { name: 'Maple Court Apartments', address: '210 Maple Court' })
  d.timeline = { constructionStart: '2026-06', constructionCompletion: '2027-12', stabilization: '2028-12' }
  d.residentialIncome.rows.find((r) => r.unitType === '2 BR' && r.amiLevel === null).monthlyRent = 1850
  scale(d.operatingExpenses.lines, 0.8)
  scaleKeys(p, keysIn('Hard costs').filter((k) => !CONTINGENCY.includes(k)), 0.9)
  scaleKeys(p, keysIn('Soft costs').filter((k) => !CONTINGENCY.includes(k)), 0.75)
  set(p, { land: 1500000, constructionContingency: 1000000, ownersContingency: 100000, softCostContingency: 100000, rentUpReserve: 450000, operatingReserve: 400000, replacementReserve: 200000 })
  sources(p, { senior: 8900000, seniorRate: 0.0625, city: 1000000, grant: 500000, deferredFee: 500000 })
  return p
}

// ---- the unhealthy project -----------------------------------------------------------------------------------------
export function unhealthyDemoProject() {
  const p = fullExampleProject('development')
  const d = p.data
  Object.assign(d.identity, { name: 'Harbor Point Towers', address: '900 Harbor Point' })
  // behind schedule: it should have been finished months ago, and the date that it stabilizes has already gone by
  d.timeline = { constructionStart: '2024-09', constructionCompletion: '2025-06', stabilization: '2025-12' }
  // no general contractor or architect named
  d.team.lines.generalContractor = { firmName: null, principal: null, ownershipPct: null }
  d.team.lines.architect = { firmName: null, principal: null, ownershipPct: null }
  // rents well above the market, and almost no vacancy assumed
  for (const r of d.residentialIncome.rows) r.monthlyRent = Math.round(r.monthlyRent * 1.3)
  d.residentialIncome.stabilizedVacancy = 0.02
  // expenses understated
  scale(d.operatingExpenses.lines, 0.55)
  // costs up, contingency almost nothing, most of the developer fee paid in cash
  for (const k of ['concreteMasonry', 'carpentry', 'plumbingElectrical', 'hvac']) p.data.budget.lines[k].amount = Math.round(p.data.budget.lines[k].amount * 1.25)
  set(p, { constructionContingency: 90000, ownersContingency: 0, softCostContingency: 0, rentUpReserve: 0, operatingReserve: 0, replacementReserve: 0, developerFee: 1400000, architectureEngineering: 900000 })
  const uses = sources(p, { senior: 14500000, seniorRate: 0.095, city: 0, grant: 0, deferredFee: 0 })
  // a short bridge loan that comes due before the project stabilizes, and mezzanine debt ranked ahead of the senior loan
  p.data.sources.rows = [
    { lienPriority: 1, name: 'Harbor Mezzanine Fund', type: 'mezzanine_debt', amount: 2500000, termMonths: 240, interestRate: 0.13, paymentOverride: null },
    { lienPriority: 2, name: 'Example Bank construction-to-permanent loan', type: 'hard_debt', amount: 14500000, termMonths: 360, interestRate: 0.095, paymentOverride: null },
    { lienPriority: 3, name: 'Short bridge loan', type: 'hard_debt', amount: 600000, termMonths: 12, interestRate: 0.11, paymentOverride: null },
    { lienPriority: 4, name: 'Sponsor equity', type: 'developer_equity', amount: uses - 2500000 - 14500000 - 600000 - 900000, termMonths: null, interestRate: null, paymentOverride: null }, // 900,000 short of the uses
  ]
  return p
}

export function demoBuild() {
  return {
    firm: proven.firm(),
    projects: [
      { record: healthyDemoProject(), kind: 'development' },
      { record: unhealthyDemoProject(), kind: 'development', budget: { G102: 17000000 } }, // the Budget tab's total is typed over its formula
      ...pastProjects.map((x) => ({ record: x.record(), kind: 'completed' })),
    ],
  }
}

// Ranges for the demo's Benchmarks screen: the healthy project sits inside every one, and the unhealthy one misses most.
export const DEMO_BENCHMARKS_CHANGED_AT = '2026-01-15T12:00:00.000Z'
export const DEMO_BENCHMARKS = [
  { id: 'rent-studio', metric: 'rent', unitType: 'studio', ami: '', low: 1000, high: 1300, typical: 1150 },
  { id: 'rent-1br', metric: 'rent', unitType: '1br', ami: '', low: 1350, high: 1650, typical: 1500 },
  { id: 'rent-1br-60', metric: 'rent', unitType: '1br', ami: '60', low: 850, high: 1050, typical: 950 },
  { id: 'rent-2br', metric: 'rent', unitType: '2br', ami: '', low: 1600, high: 1900, typical: 1750 },
  { id: 'rent-2br-60', metric: 'rent', unitType: '2br', ami: '60', low: 1000, high: 1300, typical: 1150 },
  { id: 'rent-3br', metric: 'rent', unitType: '3br', ami: '', low: 2000, high: 2500, typical: 2250 },
  { id: 'expense', metric: 'expense', low: 5500, high: 7000, typical: null },
  { id: 'cost-hard', metric: 'costHard', low: 115, high: 150, typical: null },
  { id: 'cost-soft', metric: 'costSoft', low: 25, high: 45, typical: null },
  { id: 'cost-total', metric: 'costTotal', low: 160, high: 220, typical: null },
  { id: 'contingency', metric: 'contingency', low: 0.05, high: 0.12, typical: null },
  { id: 'interest', metric: 'interestRate', low: 0.055, high: 0.0675, typical: null },
  { id: 'coverage', metric: 'dscr', low: 1.25, high: 2.25, typical: null },
  { id: 'loan-to-cost', metric: 'debtToCost', low: 0.5, high: 0.65, typical: null },
  { id: 'equity', metric: 'equityShare', low: 0.25, high: 0.4, typical: null },
  { id: 'break-even', metric: 'breakEven', low: 0.55, high: 0.85, typical: null },
  { id: 'yield', metric: 'yieldOnCost', low: 0.07, high: 0.09, typical: null },
  { id: 'debt-yield', metric: 'debtYield', low: 0.09, high: 0.15, typical: null },
  { id: 'vacancy', metric: 'vacancy', low: 0.05, high: 0.08, typical: null },
]
