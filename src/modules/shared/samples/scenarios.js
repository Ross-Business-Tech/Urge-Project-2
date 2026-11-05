// The sample scenarios. Each one is the healthy baseline with something broken on purpose, so a module can be tested
// against a case where the right answer is known. Everything is made up.
//
// A scenario has:
//   id, title, stage (what the underwriter would choose), asOf (the "as of" date)
//   what    one sentence: what is planted
//   build() the firm, the projects and any cell edits, ready for recordsToWorkbook
//   t12     optional: monthly rows for the separate T-12 template, with the project they belong to
//   key     the answer key: what the calculators must say, and what each module should raise or not raise
//
// Key flags use { module, id, severity, about }. `id` is the stable id the module should use, and `severity` is the
// least it should be. `must: false` means the module should stay quiet about it.

import { healthyFirm, healthyProject } from './baseline.js'

const MONTHS = (start, n) => Array.from({ length: n }, (_, i) => {
  const t = start * 12 - 1 + i // start is a year; month index counted from January of that year
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
})

// One T-12 month. Rent and expenses are scaled from the healthy project: 40 units at 1,500 a month, retail, parking.
export function t12Rows({ year = 2025, months = 12, occupancy = 0.95, rentFactor = 1, expenseFactor = 1, skip = [] } = {}) {
  return MONTHS(year, months)
    .filter((_, i) => !skip.includes(i))
    .map((month) => {
      const resPotential = 40 * 1500 * rentFactor
      return {
        month,
        residentialRevenue: Math.round(resPotential),
        commercialRevenue: 8333,
        otherRevenue: 1000,
        vacancyLoss: Math.round(resPotential * (1 - occupancy)),
        concessions: 0,
        occupancy,
        propertyManagement: Math.round(4167 * expenseFactor),
        propertyTaxes: Math.round(10000 * expenseFactor),
        replacementReserves: Math.round(1667 * expenseFactor),
        otherExpenses: 833,
      }
    })
}

const asCompleted = (p) => {
  p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' }
  return p
}

export const scenarios = [
  {
    id: 's01-healthy-development',
    title: 'Healthy development project',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'Nothing is wrong. Sources equal uses, contingency is adequate, debt service is covered.',
    build: () => ({ firm: healthyFirm(), projects: [{ record: healthyProject() }] }),
    key: {
      ratios: { dscr: 2.71, debtToCost: 0.54, equityShare: 0.36 },
      flags: [
        { module: 'M1', id: 'M1-sources-uses', must: false, about: 'Sources 5,550,000 equal uses 5,550,000. No flag.' },
        { module: 'M3D', id: 'M3D-contingency-low', must: false, about: 'Construction contingency 400,000 on 3,500,000 hard cost (11.4%). No flag.' },
      ],
      summary: 'A clean pass. No high or medium flags from any module. This is the control case: a module that flags this project is too noisy.',
    },
  },
  {
    id: 's02-sources-not-equal-uses',
    title: 'Sources do not equal uses',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The sponsor equity is 350,000 short, so sources are 5,200,000 against uses of 5,550,000.',
    build: () => {
      const p = healthyProject()
      p.data.sources.rows[1].amount = 1650000
      return { firm: healthyFirm(), projects: [{ record: p }] }
    },
    key: {
      ratios: { dscr: 2.71 },
      flags: [{ module: 'M1', id: 'M1-sources-uses', severity: 'high', about: 'Sources 5,200,000 vs uses 5,550,000: a 350,000 gap (6.3%).' }],
      summary: 'M1 raises one high flag. Other modules may still run; the gap is a funding hole, not a reason to stop.',
    },
  },
  {
    id: 's03-thin-contingency',
    title: 'Thin contingency',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'Construction contingency is 40,000 on 3,500,000 of hard cost (1.1%). Uses and sources are kept equal by raising sponsor equity.',
    build: () => {
      const p = healthyProject()
      p.data.budget.lines.constructionContingency.amount = 40000
      p.data.sources.rows[1].amount = 1640000
      return { firm: healthyFirm(), projects: [{ record: p }] }
    },
    key: {
      ratios: { dscr: 2.71 },
      flags: [
        { module: 'M3D', id: 'M3D-contingency-low', severity: 'high', about: 'Contingency 1.1% of hard cost vs a 5% to 10% benchmark.' },
        { module: 'M1', id: 'M1-sources-uses', must: false, about: 'Sources and uses still tie out.' },
      ],
      summary: 'Only M3D should object. M1 stays quiet because the numbers are internally consistent.',
    },
  },
  {
    id: 's04-error-cells',
    title: 'Excel error cells',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The property tax cell on the Details tab shows #REF! and the debt interest rate shows #DIV/0!.',
    build: () => {
      const p = healthyProject()
      return { firm: healthyFirm(), projects: [{ record: p, details: { E139: { error: '#REF!' }, H28: { error: '#DIV/0!' } } }] }
    },
    key: {
      ratios: { dscr: 'not available', noiCushion: 'not available' },
      flags: [
        { module: 'M1', id: 'M1-error-cells', severity: 'high', about: 'Two error cells: Details E139 (#REF!) and H28 (#DIV/0!).' },
      ],
      summary: 'NOI and DSCR cannot be computed (property taxes and the rate are missing), so the calculators say "not available" and the modules raise low "missing data" flags instead of guessing.',
    },
  },
  {
    id: 's05-template-residue',
    title: 'Template placeholder text left in',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The project name, address and firm name still hold the workbook\'s placeholder wording.',
    build: () => {
      const f = healthyFirm({ name: 'Enter firm name here' })
      const p = healthyProject({ name: 'Project Name' })
      p.data.identity.address = 'Enter address'
      return { firm: f, projects: [{ record: p }] }
    },
    key: {
      ratios: { dscr: 2.71 },
      flags: [{ module: 'M1', id: 'M1-template-residue', severity: 'medium', about: 'Placeholder text in the firm name, project name and address.' }],
      summary: 'A medium M1 flag. The numbers are fine; the applicant did not finish the form.',
    },
  },
  {
    id: 's06-hidden-tab-with-data',
    title: 'Hidden project tab with data',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The Cover says 1 development project, but a second, very hidden project tab holds a full project.',
    build: () => ({
      firm: healthyFirm(),
      firmCells: { 'Cover!C9': 1 },
      projects: [{ record: healthyProject() }, { record: healthyProject({ name: 'Quiet Corner Flats' }), state: 'veryHidden' }],
    }),
    key: {
      ratios: {},
      flags: [
        { module: 'M1', id: 'M1-project-count', severity: 'high', about: 'Cover says 1 development project; 2 tabs have data, and "Development Project 2 Details" is very hidden.' },
      ],
      summary: 'The importer already notes the hidden tab. M1 turns that into a high flag. M5 should include the hidden project in the sponsor total.',
    },
  },
  {
    id: 's07-stage-contradicts-data',
    title: 'Stage contradicts the data',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The underwriter chose development, but the stabilization date was mid-2024 and the project has a full T-12 of rent.',
    build: () => {
      const p = healthyProject()
      p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' }
      return { firm: healthyFirm(), projects: [{ record: p }] }
    },
    t12: { rows: t12Rows() },
    key: {
      ratios: {},
      flags: [
        { module: 'M1', id: 'M1-stage-contradicted', severity: 'medium', about: 'Stage is development, but stabilization (2024-06) is past and a 12-month T-12 with rent is loaded.' },
      ],
      summary: 'M1 flags the contradiction and never changes the stage. The underwriter decides.',
    },
  },
  {
    id: 's08-dscr-under-minimum',
    title: 'DSCR under the lender minimum',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The whole 5,550,000 cost is borrowed at 9% over 360 months against the same income. DSCR is below 1.20.',
    build: () => {
      const p = healthyProject()
      p.data.sources.rows = [{ lienPriority: 1, name: 'Example Bank', type: 'hard_debt', amount: 5550000, termMonths: 360, interestRate: 0.09, paymentOverride: null }]
      return { firm: healthyFirm(), projects: [{ record: p }] }
    },
    key: {
      ratios: { dscr: 1.09 },
      flags: [
        { module: 'M3D', id: 'M3D-dscr-under-minimum', severity: 'high', about: 'DSCR 1.09 vs a 1.20 minimum.' },
        { module: 'M1', id: 'M1-sources-uses', must: false, about: 'One loan of 5,550,000 equals uses of 5,550,000, so sources still tie.' },
      ],
      summary: 'A clear fail on the first screener. Sources are consistent (all debt, no equity).',
    },
  },
  {
    id: 's09-passes-dscr-low-occupancy-high-rent',
    title: 'Passes DSCR but low occupancy and high rent',
    stage: 'lease_up',
    asOf: '2026-01-15',
    what: 'The last 3 months of NOI beat underwriting and DSCR passes, but occupancy is 82% while rents run 30% above the market sample.',
    build: () => ({ firm: healthyFirm(), projects: [{ record: healthyProject() }] }),
    t12: { rows: t12Rows({ year: 2025, months: 6, occupancy: 0.82, rentFactor: 1.3 }) },
    key: {
      ratios: { dscr: 2.71, trailing: 'see T-12' },
      flags: [
        { module: 'M3T', id: 'M3T-high-rent-low-occupancy', severity: 'high', about: 'Occupancy 82% (below the 90% floor) with rents 30% above comps (above the 10% premium limit), while DSCR passes.' },
        { module: 'M2', id: 'M2-rent-above-comps', severity: 'medium', about: 'Achieved rents above the comparable range.' },
      ],
      summary: 'The case the first screener alone would wave through. DSCR and NOI pass; the occupancy screener catches it.',
    },
  },
  {
    id: 's10-healthy-project-failing-firm',
    title: 'Healthy project under a failing firm',
    stage: 'completed',
    asOf: '2026-01-15',
    what: 'The project is sound. The sponsor firm has almost no cash, large debt and shrinking fees.',
    build: () => {
      const f = healthyFirm()
      const bs = f.data.balanceSheet.lines
      bs.cash = { current: 20000, prior: 400000 }
      bs.notesPayable = { current: 2500000, prior: 900000 }
      bs.accountsPayable = { current: 600000, prior: 150000 }
      f.data.earnings.rows = [
        { fiscalYear: 2023, developerFee: 400000, salariesWages: 450000 },
        { fiscalYear: 2024, developerFee: 150000, salariesWages: 450000 },
        { fiscalYear: 2025, developerFee: 0, salariesWages: 450000 },
      ]
      return { firm: f, projects: [{ record: asCompleted(healthyProject()), kind: 'completed' }] }
    },
    t12: { rows: t12Rows() },
    key: {
      ratios: { dscr: 2.71 },
      flags: [
        { module: 'M5', id: 'M5-firm-liquidity', severity: 'high', about: 'Firm cash 20,000 against 600,000 of payables; fee income fell to zero.' },
        { module: 'M3C', id: 'M3C-actuals-vs-underwriting', must: false, about: 'The project itself performs; no project-level high flags.' },
      ],
      summary: 'M5 raises the firm risk. M6 should show the project as sound but exposed to the sponsor. The project is not dead on its own numbers.',
    },
  },
  {
    id: 's11-missing-t12',
    title: 'Completed project with no T-12',
    stage: 'completed',
    asOf: '2026-01-15',
    what: 'The project is completed, but no T-12 is loaded.',
    build: () => ({ firm: healthyFirm(), projects: [{ record: asCompleted(healthyProject()), kind: 'completed' }] }),
    key: {
      ratios: { trailing: 'not available' },
      flags: [
        { module: 'M1', id: 'M1-t12-missing', severity: 'medium', about: 'A completed project has no T-12.' },
        { module: 'M3C', id: 'M3C-missing-data', severity: 'low', about: 'Actuals checks could not run without a T-12.' },
      ],
      summary: 'No crash and no silent skip: both modules say what is missing.',
    },
  },
  {
    id: 's12-partial-t12',
    title: 'Partial T-12 (5 months)',
    stage: 'completed',
    asOf: '2026-01-15',
    what: 'Only 5 months of T-12 are loaded.',
    build: () => ({ firm: healthyFirm(), projects: [{ record: asCompleted(healthyProject()), kind: 'completed' }] }),
    t12: { rows: t12Rows({ months: 5 }) },
    key: {
      ratios: { trailing: 'streak of 5 months' },
      flags: [
        { module: 'M1', id: 'M1-t12-partial', severity: 'low', about: 'Only 5 of 12 months provided.' },
      ],
      summary: 'The 3-month stability test can run (5 months is enough). A full year-based check cannot.',
    },
  },
  {
    id: 's13-typed-payment-too-low',
    title: 'Typed yearly payment is too low',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The applicant typed a yearly payment of 100,000 on a 3,000,000 loan. The loan\'s own terms produce about 215,838.',
    build: () => {
      const p = healthyProject()
      p.data.sources.rows[0].paymentOverride = 100000
      return { firm: healthyFirm(), projects: [{ record: p }] }
    },
    key: {
      ratios: { dscr: 5.86 },
      flags: [{ module: 'M1', id: 'M1-payment-override-low', severity: 'high', about: 'Typed payment 100,000 a year vs 215,838 from the amount, rate and term.' }],
      summary: 'The typed number flatters DSCR (5.86 against 2.71). M1 catches it.',
    },
  },
  {
    id: 's14-rate-typed-as-whole-number',
    title: 'Interest rate typed as 6.5 instead of 6.5%',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The rate cell holds 6.5 (meaning 650%).',
    build: () => {
      const p = healthyProject()
      p.data.sources.rows[0].interestRate = 6.5
      return { firm: healthyFirm(), projects: [{ record: p, details: { H28: 6.5 } }] }
    },
    key: {
      ratios: { dscr: 'not available' },
      flags: [{ module: 'M1', id: 'M1-implausible-input', severity: 'high', about: 'Interest rate 650% is outside the believable range.' }],
      summary: 'The calculators refuse the number and say "not available". They never produce a confident wrong DSCR.',
    },
  },
  {
    id: 's15-equity-with-rate-and-term',
    title: 'Equity source with a rate and a term',
    stage: 'development',
    asOf: '2026-01-15',
    what: 'The sponsor equity line carries an 8% rate and a 120-month term, so it is counted as debt service.',
    build: () => {
      const p = healthyProject()
      Object.assign(p.data.sources.rows[1], { termMonths: 120, interestRate: 0.08 })
      return { firm: healthyFirm(), projects: [{ record: p }] }
    },
    key: {
      ratios: { dscr: 1.16 },
      flags: [{ module: 'M1', id: 'M1-equity-with-payment-terms', severity: 'medium', about: 'Developer equity has a rate and term; confirm it is not a loan typed under the wrong label.' }],
      summary: 'The calculators count it (announced in their notes), so DSCR drops from 2.71 to about 1.16, under the 1.20 minimum. M1 asks the underwriter to confirm.',
    },
  },
]
