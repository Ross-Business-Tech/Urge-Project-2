// A fully filled-in made-up project, for trying every part of the app. Riverside Commons: 100 apartments in five room types
// (one of them income-restricted), some shops, a complete budget, three loans, every expense line, and a T-12.
// Everything is invented. It is built twice: still to be built (for the budget, cost and contingency checks) and already open
// (for the rent, expense and T-12 checks). It is not one of the answer-key scenarios, so nothing is planted in it on purpose.

import { healthyFirm } from './baseline.js'
import { blankProject } from '../records.js'

export const FULL_EXAMPLE = {
  development: { file: 'full-example-development', title: 'Riverside Commons (to be built)', stage: 'development', asOf: '2026-11-16' },
  completed: { file: 'full-example-completed', title: 'Riverside Commons (already open)', stage: 'completed', asOf: '2026-11-16' },
}

// 100 apartments. amiLevel is the share of area median income the rent is restricted to (null = market rate).
export const UNIT_MIX = [
  { amiLevel: null, unitType: 'Studio', units: 10, baths: 1, sqft: 480, monthlyRent: 1150 },
  { amiLevel: null, unitType: '1 BR', units: 30, baths: 1, sqft: 700, monthlyRent: 1500 },
  { amiLevel: 0.6, unitType: '1 BR', units: 10, baths: 1, sqft: 700, monthlyRent: 950 },
  { amiLevel: null, unitType: '2 BR', units: 30, baths: 2, sqft: 950, monthlyRent: 1950 },
  { amiLevel: 0.6, unitType: '2 BR', units: 5, baths: 2, sqft: 950, monthlyRent: 1150 },
  { amiLevel: null, unitType: '3 BR', units: 15, baths: 2, sqft: 1200, monthlyRent: 2350 },
]

const BUDGET = {
  // Land and acquisition
  land: 1800000, acquisitionOther: 60000, environmentalMitigation: 40000,
  // Site work
  earthWork: 420000, roadsWalks: 260000, siteUtilities: 380000, siteImprovementsDemolition: 90000, landscaping: 150000, irrigation: 35000,
  // Structures
  concreteMasonry: 1650000, carpentry: 1850000, roofingSiding: 720000, doorsWindows: 640000, drywall: 560000, flooring: 410000,
  cabinetsAppliances: 520000, paintingFurnishings: 260000, plumbingElectrical: 1450000, hvac: 780000, accessoryBuildings: 120000, elevatorsEquipment: 310000, tenantUpgrades: 90000,
  // General requirements and contingency
  generalRequirements: 520000, buildersOverhead: 260000, buildersProfit: 390000, siteSecurity: 45000, permitsBonds: 190000,
  constructionContingency: 640000, ownersContingency: 120000,
  // Professional fees
  architectureEngineering: 560000, survey: 28000, legalAccounting: 150000, environmentalStudies: 32000, marketStudy: 18000, appraisal: 14000, costCertification: 22000,
  // Interim costs
  constructionLoanFee: 160000, constructionInterest: 820000, constructionTaxes: 95000, constructionInsurance: 140000,
  // Permanent financing and fees
  permanentLoanFees: 85000, applicationFees: 25000, titleWork: 60000,
  developerFee: 900000, projectManagementFees: 120000, constructionManagementFees: 150000, consultingFees: 40000,
  // Reserves
  rentUpReserve: 350000, replacementReserve: 150000, operatingReserve: 300000, softCostContingency: 180000,
}

const EXPENSES = {
  propertyManagement: 92000, leasingExpense: 24000, auditTax: 14000, miscAdmin: 38000, electricHeatCommon: 46000, waterSewer: 72000,
  garbage: 21000, replacementReserves: 40000, contractRepairs: 62000, elevatorContract: 18000, groundsMaintenance: 34000,
  propertyLiabilityInsurance: 96000, propertyTaxes: 232000,
}

export function fullExampleProject(kind = 'development') {
  const p = blankProject()
  const d = p.data
  Object.assign(d.identity, { name: 'Riverside Commons', address: '100 Example Avenue', constructionType: 'New construction', propertyType: 'Multifamily', confidential: false })
  const team = d.team.lines
  team.generalContractor = { firmName: 'Northgate Builders', principal: 'Casey Example', ownershipPct: null }
  team.architect = { firmName: 'Lakeline Architects', principal: 'Riley Example', ownershipPct: null }
  team.devPartner1 = { firmName: 'Riverbend Development Group', principal: 'Jordan Example', ownershipPct: 0.6 }
  team.devPartner2 = { firmName: 'Eastside Community Partners', principal: 'Morgan Example', ownershipPct: 0.4 }
  team.other1 = { firmName: 'Brightside Management Co', principal: 'Property manager', ownershipPct: null }
  team.other2 = { firmName: 'Jordan Example', principal: 'Personal guarantor', ownershipPct: null }
  d.timeline = kind === 'completed' ? { constructionStart: '2023-03', constructionCompletion: '2024-09', stabilization: '2025-09' } : { constructionStart: '2027-01', constructionCompletion: '2028-07', stabilization: '2029-07' }
  for (const [k, amount] of Object.entries(BUDGET)) d.budget.lines[k].amount = amount
  d.residentialIncome.rows = UNIT_MIX.map((r) => ({ ...r }))
  d.residentialIncome.stabilizedVacancy = 0.05
  d.residentialIncome.rentIncreaseYear2 = 0.03
  d.residentialIncome.rentIncreaseYear3 = 0.03
  d.residentialIncome.rentIncreaseFuture = 0.02
  d.commercialIncome.rows = [
    { leaseType: 'nnn', description: 'Corner café', sqft: 1800, rentPerSqft: 24 },
    { leaseType: 'nnn', description: 'Dental office', sqft: 2200, rentPerSqft: 21 },
  ]
  d.commercialIncome.stabilizedVacancy = 0.1
  d.otherIncome.rows = [
    { description: 'Parking', monthlyIncome: 3000 },
    { description: 'Laundry and storage', monthlyIncome: 1200 },
  ]
  for (const [k, amount] of Object.entries(EXPENSES)) d.operatingExpenses.lines[k].amount = amount
  d.otherExpenses.rows = []

  // Sources: three loans, a grant, and equity that makes the sources exactly equal the uses.
  const uses = Object.values(BUDGET).reduce((a, b) => a + b, 0)
  const loan = 9000000
  const gov = 1200000
  const mezz = 600000
  const grant = 500000
  const deferredFee = 300000 // a third of the developer fee is paid later, out of income
  d.sources.rows = [
    { lienPriority: 1, name: 'Example Bank construction-to-permanent loan', type: 'hard_debt', amount: loan, termMonths: 360, interestRate: 0.0625, paymentOverride: null },
    { lienPriority: 2, name: 'City housing loan', type: 'gov_debt', amount: gov, termMonths: 480, interestRate: 0.03, paymentOverride: null },
    { lienPriority: 3, name: 'Community mezzanine loan', type: 'mezzanine_debt', amount: mezz, termMonths: 240, interestRate: 0.09, paymentOverride: null },
    { lienPriority: 4, name: 'State housing grant', type: 'nonrecoverable_grant', amount: grant, termMonths: null, interestRate: null, paymentOverride: null },
    { lienPriority: 5, name: 'Deferred developer fee', type: 'other', amount: deferredFee, termMonths: null, interestRate: null, paymentOverride: null },
    { lienPriority: 6, name: 'Sponsor equity', type: 'developer_equity', amount: uses - loan - gov - mezz - grant - deferredFee, termMonths: null, interestRate: null, paymentOverride: null },
  ]
  return p
}

export function fullExampleFirm() {
  return healthyFirm({ name: 'Riverbend Development Group', principal: 'Jordan Example' })
}

export function fullExampleBuild(kind = 'development') {
  return { firm: fullExampleFirm(), projects: [{ record: fullExampleProject(kind) }] }
}

// Twelve months of results for the open building, 2025-11 to 2026-10: about 95% occupied, expenses in line with the budget.
export function fullExampleT12() {
  const monthly = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v / 12)]))
  const e = monthly(EXPENSES)
  const resPotential = UNIT_MIX.reduce((a, r) => a + r.units * r.monthlyRent, 0)
  const months = []
  for (let i = 0; i < 12; i += 1) {
    const t = 2025 * 12 + 10 + i
    const month = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
    const occupancy = [0.94, 0.94, 0.95, 0.95, 0.95, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96][i]
    months.push({
      month,
      residentialRevenue: Math.round(resPotential),
      commercialRevenue: Math.round((1800 * 24 + 2200 * 21) / 12),
      otherRevenue: 4200,
      vacancyLoss: Math.round(resPotential * (1 - occupancy)),
      concessions: i === 0 ? 1500 : 0,
      occupancy,
      propertyManagement: e.propertyManagement,
      leasingExpense: e.leasingExpense,
      auditTax: e.auditTax,
      miscAdmin: e.miscAdmin,
      elevatorContract: e.elevatorContract,
      propertyTaxes: e.propertyTaxes,
      propertyLiabilityInsurance: e.propertyLiabilityInsurance,
      replacementReserves: e.replacementReserves,
      electricHeatCommon: e.electricHeatCommon,
      waterSewer: e.waterSewer,
      garbage: e.garbage,
      contractRepairs: e.contractRepairs,
      groundsMaintenance: e.groundsMaintenance,
    })
  }
  return months
}

// Ranges to try in the Benchmarks screen ("Open a saved file"), chosen so the example shows both outcomes: most of the project's
// figures fall inside them, a few deliberately do not, and the 3-bedroom rent is left out so it shows as "not compared".
// These are invented for trying the app. They are not market data.
export const EXAMPLE_BENCHMARKS_CHANGED_AT = '2026-11-16T12:00:00.000Z'
export const EXAMPLE_BENCHMARKS = [
  { id: 'rent-studio', metric: 'rent', unitType: 'studio', ami: '', low: 1050, high: 1250, typical: 1150 },
  { id: 'rent-1br', metric: 'rent', unitType: '1br', ami: '', low: 1350, high: 1650, typical: 1500 },
  { id: 'rent-1br-60', metric: 'rent', unitType: '1br', ami: '60', low: 850, high: 1000, typical: 925 },
  { id: 'rent-2br', metric: 'rent', unitType: '2br', ami: '', low: 1500, high: 1800, typical: 1650 }, // the project is above this
  { id: 'rent-2br-60', metric: 'rent', unitType: '2br', ami: '60', low: 1000, high: 1300, typical: 1150 },
  { id: 'expense', metric: 'expense', low: 5500, high: 7000, typical: null }, // the project is above this
  { id: 'cost-hard', metric: 'costHard', low: 120, high: 150, typical: null },
  { id: 'cost-soft', metric: 'costSoft', low: 25, high: 40, typical: null }, // the project is above this
  { id: 'cost-total', metric: 'costTotal', low: 180, high: 230, typical: null },
  { id: 'contingency', metric: 'contingency', low: 0.05, high: 0.1, typical: null },
  { id: 'interest', metric: 'interestRate', low: 0.055, high: 0.0675, typical: null },
  { id: 'coverage', metric: 'dscr', low: 1.25, high: 1.5, typical: null }, // the project is above this (the safe side)
  { id: 'loan-to-cost', metric: 'debtToCost', low: 0.55, high: 0.65, typical: null },
  { id: 'equity', metric: 'equityShare', low: 0.25, high: 0.35, typical: null }, // the project is above this (the safe side)
  { id: 'break-even', metric: 'breakEven', low: 0.7, high: 0.8, typical: null },
  { id: 'yield', metric: 'yieldOnCost', low: 0.07, high: 0.085, typical: null }, // the project is below this (the risky side)
  { id: 'debt-yield', metric: 'debtYield', low: 0.09, high: 0.12, typical: null },
  { id: 'vacancy', metric: 'vacancy', low: 0.05, high: 0.08, typical: null },
]
