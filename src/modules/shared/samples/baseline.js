// Healthy made-up firm and projects. Every sample scenario starts from these and then breaks one thing on purpose.
// All names, addresses and numbers are invented.

import { blankFirm, blankProject } from '../records.js'

export function healthyFirm({ name = 'Maple Ridge Partners', principal = 'Pat Sample' } = {}) {
  const f = blankFirm()
  const d = f.data
  Object.assign(d.identity, { name, street: '1 Sample Way', cityStateZip: 'Exampleton, ST 00000', principalName: principal })
  d.owners.rows = [{ name: principal, ownershipPct: 1 }]
  Object.assign(d.balanceSheet, { currentPeriod: '2025', priorPeriod: '2024' })
  const bs = d.balanceSheet.lines
  bs.cash = { current: 900000, prior: 700000 }
  bs.accountsReceivable = { current: 150000, prior: 120000 }
  bs.accountsPayable = { current: 80000, prior: 70000 }
  bs.notesPayable = { current: 300000, prior: 350000 }
  bs.partnersEquity = { current: 1200000, prior: 1000000 }
  Object.assign(d.principalStatement, { name: principal, statementDate: '2025-12-31' })
  const pf = d.principalStatement.lines
  pf.cashChecking = { amount: 250000 }
  pf.realEstateOwned = { amount: 1500000 }
  pf.propertyMortgages = { amount: 800000 }
  d.earnings.rows = [
    { fiscalYear: 2023, developerFee: 400000, propertyManagementFee: 120000, salariesWages: 350000, legalProfessional: 40000, insurance: 30000 },
    { fiscalYear: 2024, developerFee: 450000, propertyManagementFee: 130000, salariesWages: 360000, legalProfessional: 40000, insurance: 30000 },
    { fiscalYear: 2025, developerFee: 500000, propertyManagementFee: 140000, salariesWages: 370000, legalProfessional: 45000, insurance: 32000 },
  ]
  d.capital.lines.securedDebt = { committed: 3000000, funded: 2500000 }
  d.capital.lines.ownerEquity = { committed: 2000000, funded: 2000000 }
  return f
}

// A development project whose sources equal its uses and whose numbers all hold up.
// Total cost 5,550,000. Debt 3,000,000 at 6% over 360 months. Stabilized NOI 586,000 a year.
export function healthyProject({ name = 'Harbor View Lofts' } = {}) {
  const p = blankProject()
  const d = p.data
  Object.assign(d.identity, { name, address: '1 Harbor Road', constructionType: 'New construction', propertyType: 'Multifamily', confidential: false })
  // A complete, made-up team. The property manager and the guarantor have no row of their own in the workbook, so (as the
  // team check expects) they are named under "Other".
  const team = d.team.lines
  team.generalContractor = { firmName: 'Keystone Builders', principal: 'Alex Example', ownershipPct: null }
  team.architect = { firmName: 'Lakeline Architects', principal: 'Riley Example', ownershipPct: null }
  team.devPartner1 = { firmName: 'Harbor Development Partners', principal: 'Sam Example', ownershipPct: 0.5 }
  team.other1 = { firmName: 'Brightside Management Co', principal: 'Property manager', ownershipPct: null }
  team.other2 = { firmName: 'Pat Sample', principal: 'Personal guarantor', ownershipPct: null }
  Object.assign(d.timeline, { constructionStart: '2026-03', constructionCompletion: '2027-06', stabilization: '2028-03' })
  d.sources.rows = [
    { lienPriority: 1, name: 'Example Bank', type: 'hard_debt', amount: 3000000, termMonths: 360, interestRate: 0.06, paymentOverride: null },
    { lienPriority: 2, name: 'Sponsor', type: 'developer_equity', amount: 2000000, termMonths: null, interestRate: null, paymentOverride: null },
    { lienPriority: 3, name: 'Deferred fee', type: 'other', amount: 550000, termMonths: null, interestRate: null, paymentOverride: null },
  ]
  const L = d.budget.lines
  L.land.amount = 1000000
  L.concreteMasonry.amount = 2000000
  L.carpentry.amount = 1500000
  L.constructionContingency.amount = 400000
  L.architectureEngineering.amount = 300000
  L.softCostContingency.amount = 50000
  L.rentUpReserve.amount = 200000
  L.operatingReserve.amount = 100000
  d.residentialIncome.rows = [{ amiLevel: null, unitType: '1-bdr', units: 40, baths: 1, sqft: 700, monthlyRent: 1500 }]
  d.residentialIncome.stabilizedVacancy = 0.05
  d.commercialIncome.rows = [{ leaseType: 'nnn', description: 'Retail', sqft: 5000, rentPerSqft: 20 }]
  d.commercialIncome.stabilizedVacancy = 0.1
  d.otherIncome.rows = [{ description: 'Parking', monthlyIncome: 1000 }]
  const E = d.operatingExpenses.lines
  E.propertyManagement.amount = 50000
  // Taxes and insurance together are still 120,000 a year, so income, NOI and every ratio are unchanged; the split only
  // means the expense list is complete (an insurance line was missing, which made two checks raise noise on every sample).
  E.propertyTaxes.amount = 84000
  E.propertyLiabilityInsurance.amount = 36000
  E.replacementReserves.amount = 20000
  // The remaining 10,000 a year is spread over the utility and maintenance lines (it used to be one "Security" line), so the
  // expense list is complete and the total is unchanged.
  E.electricHeatCommon.amount = 3000
  E.waterSewer.amount = 3000
  E.garbage.amount = 1000
  E.contractRepairs.amount = 2000
  E.groundsMaintenance.amount = 1000
  d.otherExpenses.rows = []
  return p
}
