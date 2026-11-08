import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, compareSeverity, validateFlag } from '../../shared/index.js'
import { run, checklist, MODULE_ID } from '../index.js'
import { readT12, timelineMonth } from '../checks.js'

// Load a scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return record
}

// A completed project built in code, with a healthy T-12 (40 units at 1,500, 95% occupied). `t12` overrides each month.
const MONTHS = ['2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11']
const goodMonth = (month) => ({
  month, residentialRevenue: 60000, commercialRevenue: 8333, otherRevenue: 1000, vacancyLoss: 3000, concessions: 0, occupancy: 0.95,
  propertyManagement: 4167, propertyLiabilityInsurance: 1000, propertyTaxes: 10000, replacementReserves: 1667, otherExpenses: 0,
})
function completed({ months = 12, t12 = (m) => m, stage = 'completed', asOf = '2026-01-15', edit = () => {} } = {}) {
  const p = healthyProject()
  p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' }
  p.data.operatingExpenses.lines.propertyLiabilityInsurance.amount = 12000
  p.data.otherExpenses.rows = []
  p.data.t12.rows = MONTHS.slice(0, months).map((m, i) => t12(goodMonth(m), i))
  p.data.stage.stage = stage
  p.data.stage.asOfDate = asOf
  edit(p)
  return p
}

const ids = (r) => r.flags.map((f) => f.id)
const rowOf = (p, id) => checklist(p).find((r) => r.id === id)
const valid = (r) => {
  assert.ok(!ids(r).includes('M3C-check-failed'), `a check crashed: ${r.notes.join(' | ')}`)
  for (const f of r.flags) {
    assert.deepEqual(validateFlag(f), [], f.id)
    assert.equal(f.module, 'M3C')
    assert.ok(f.id.startsWith('M3C-'))
  }
  return r
}

// ---- Answer key -------------------------------------------------------------------------------------------------

for (const s of scenarios) {
  test(`${s.id}: M3C matches the answer key`, async () => {
    const record = await load(s)
    const r = valid(run(record, {}))
    if (s.stage === 'development') assert.deepEqual(ids(r), [], 'M3C does not run for development projects')
    if (s.stage === 'completed' || s.stage === 'lease_up') assert.ok(r.notes.some((n) => n.includes(`Stage used: ${s.stage}`)))
    for (const want of s.key.flags.filter((k) => k.module === 'M3C')) {
      const got = r.flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}: ${got?.evidence}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${ids(r).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy completed project (s10) raises no high or medium M3C flag', async () => {
  const r = valid(run(await load(scenarios.find((s) => s.id === 's10-healthy-project-failing-firm')), {}))
  assert.deepEqual(r.flags.filter((f) => f.severity !== 'low').map((f) => f.evidence), [])
})

test('a fully healthy completed project passes all four checks with no flags', () => {
  const p = completed()
  assert.deepEqual(valid(run(p)).flags.map((f) => f.evidence), [])
  assert.deepEqual(checklist(p).map((r) => [r.id, r.status]), [['actuals', 'pass'], ['expenses', 'pass'], ['vacancy', 'pass'], ['debt', 'pass']])
})

// ---- 1. Actuals vs. underwriting ------------------------------------------------------------------------------------

test('actuals: NOI well below the underwriting is flagged high, with the numbers and the comparison', () => {
  const p = completed({ t12: (m) => ({ ...m, residentialRevenue: 48000, vacancyLoss: 2400 }) })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-actuals-vs-underwriting')
  assert.ok(f)
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /T-12 NOI \$\d/)
  assert.match(f.evidence, /underwritten/)
  assert.ok(f.cell_refs.length > 0)
  assert.equal(f.transition, '')
  assert.equal(rowOf(p, 'actuals').status, 'fail')
  // The rent roll comparison catches the same shortfall in billed rent (48,000 vs 60,000 = 80%).
  assert.equal(valid(run(p)).flags.find((x) => x.id === 'M3C-rent-roll-below-underwriting')?.severity, 'high')
})

test('actuals: NOI slightly below the underwriting is a lower-severity flag', () => {
  const p = completed({ t12: (m) => ({ ...m, propertyManagement: 6500 }) }) // about 2,300 a month less NOI
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-actuals-vs-underwriting')
  assert.ok(f)
  assert.ok(['low', 'medium'].includes(f.severity), f.severity)
})

test('actuals: actual DSCR under the lender minimum is high even if NOI looks close', () => {
  const p = completed({ t12: (m) => ({ ...m, debtService: 45000 }) })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-actuals-vs-underwriting')
  assert.ok(f)
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /Actual DSCR 1\.\d\d× vs\. the 1\.20× minimum/)
})

test('actuals: an unbelievable T-12 value gives a low missing-data flag, not a crash or a guess', () => {
  const p = completed({ t12: (m, i) => (i === 3 ? { ...m, occupancy: 9.5 } : m) })
  const r = valid(run(p))
  const f = r.flags.find((x) => x.id === 'M3C-actuals-missing')
  assert.ok(f, ids(r).join(', '))
  assert.equal(f.severity, 'low')
  assert.equal(rowOf(p, 'actuals').status, 'not_checked')
})

// ---- 2. Expense normalization ----------------------------------------------------------------------------------------

test('expenses: property taxes rising mid-year (a reassessment) are flagged', () => {
  const p = completed({ t12: (m, i) => ({ ...m, propertyTaxes: i < 6 ? 10000 : 13000 }) })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-property-tax-reassessment')
  assert.ok(f)
  assert.equal(f.severity, 'medium')
  assert.match(f.evidence, /rose from \$10,000/)
  assert.equal(rowOf(p, 'expenses').status, 'fail')
})

test('expenses: a recently completed building gets a low reassessment warning', () => {
  const p = completed({ edit: (x) => (x.data.timeline.constructionCompletion = '2025-03') })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-property-tax-reassessment')
  assert.equal(f?.severity, 'low')
  assert.match(f.evidence, /10 months before the as-of date/)
})

test('expenses: no property tax and no reserves are each flagged medium', () => {
  const p = completed({
    edit: (x) => {
      x.data.operatingExpenses.lines.propertyTaxes.amount = null
      x.data.operatingExpenses.lines.replacementReserves.amount = 0
    },
  })
  const r = valid(run(p))
  assert.equal(r.flags.find((f) => f.id === 'M3C-property-tax-missing')?.severity, 'medium')
  assert.equal(r.flags.find((f) => f.id === 'M3C-reserves-missing')?.severity, 'medium')
})

test('expenses: thin reserves per unit are flagged low', () => {
  const p = completed({ edit: (x) => (x.data.operatingExpenses.lines.replacementReserves.amount = 4000) }) // 100 a unit
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-reserves-low')
  assert.equal(f?.severity, 'low')
  assert.match(f.evidence, /\$100 a unit/)
})

test('expenses: a line paid in the T-12 but missing from the underwriting is flagged medium', () => {
  const p = completed({ t12: (m) => ({ ...m, waterSewer: 800 }) })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-expense-lines-missing')
  assert.equal(f?.severity, 'medium')
  assert.match(f.evidence, /water and sewer \(\$9,600 a year\)/)
})

test('expenses: missing insurance in both the underwriting and the T-12 is flagged low', () => {
  const p = completed({
    t12: (m) => ({ ...m, propertyLiabilityInsurance: null }),
    edit: (x) => (x.data.operatingExpenses.lines.propertyLiabilityInsurance.amount = null),
  })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-expense-lines-missing')
  assert.equal(f?.severity, 'low')
  assert.match(f.evidence, /property and liability insurance/)
})

test('expenses: T-12 expenses well above the underwriting are flagged', () => {
  const p = completed({ t12: (m) => ({ ...m, propertyManagement: 9000 }) })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-expenses-above-underwriting')
  assert.ok(f)
  assert.match(f.evidence, /of the \$202,000 underwritten/)
})

// ---- 3. Vacancy realism -----------------------------------------------------------------------------------------------

test('vacancy: the assumption is not supported when actual occupancy runs much lower', () => {
  const p = completed({ t12: (m) => ({ ...m, occupancy: 0.86, vacancyLoss: 8400 }) })
  const r = valid(run(p))
  const f = r.flags.find((x) => x.id === 'M3C-vacancy-unsupported')
  assert.equal(f?.severity, 'high')
  assert.match(f.evidence, /Vacancy assumed at 5\.0%; actual vacancy 14\.0%/)
  assert.equal(rowOf(p, 'vacancy').status, 'fail')
})

test('vacancy: a small gap passes', () => {
  const p = completed({ t12: (m) => ({ ...m, occupancy: 0.94 }) })
  assert.ok(!ids(valid(run(p))).includes('M3C-vacancy-unsupported'))
  assert.equal(rowOf(p, 'vacancy').status, 'pass')
})

test('vacancy: without an occupancy column, the vacancy loss is used instead', () => {
  const p = completed({ t12: (m) => ({ ...m, occupancy: null, vacancyLoss: 9000 }) })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-vacancy-unsupported')
  assert.ok(f)
  assert.match(f.evidence, /vacancy loss was used/)
})

test('vacancy: a blank assumption gives a low missing-data flag', () => {
  const p = completed({ edit: (x) => (x.data.residentialIncome.stabilizedVacancy = null) })
  const r = valid(run(p))
  assert.equal(r.flags.find((f) => f.id === 'M3C-vacancy-missing')?.severity, 'low')
  assert.equal(rowOf(p, 'vacancy').status, 'not_checked')
})

// ---- 4. Debt maturity or reset -----------------------------------------------------------------------------------------

test('debt: a loan maturing within a year is flagged high, with transition T3', () => {
  const p = completed({ edit: (x) => (x.data.sources.rows[0].termMonths = 24) }) // from 2024-06: matures 2026-06
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-debt-maturity')
  assert.ok(f)
  assert.equal(f.severity, 'high')
  assert.equal(f.transition, 'T3')
  assert.match(f.evidence, /matures 2026-06, 5 months after the as-of date/)
  assert.ok(f.cell_refs.some((c) => c.includes('termMonths')))
  assert.equal(rowOf(p, 'debt').status, 'fail')
})

test('debt: a loan maturing in two to three years is medium; one already past maturity is high', () => {
  // A smaller loan, so a 4-year term still leaves DSCR above the minimum (a weak DSCR alone would make it high).
  const mid = completed({ edit: (x) => Object.assign(x.data.sources.rows[0], { termMonths: 48, amount: 1000000 }) })
  assert.equal(valid(run(mid)).flags.find((f) => f.id === 'M3C-debt-maturity')?.severity, 'medium')
  const past = completed({ edit: (x) => (x.data.sources.rows[0].termMonths = 12) })
  const f = valid(run(past)).flags.find((x) => x.id === 'M3C-debt-maturity')
  assert.equal(f?.severity, 'high')
  assert.match(f.title, /already past/)
})

test('debt: a long loan passes and the reset limitation is stated', () => {
  const row = rowOf(completed(), 'debt')
  assert.equal(row.status, 'pass')
  assert.match(row.detail, /matures 2054-06/)
  assert.match(row.detail, /no reset date/)
})

test('debt: a year-only stabilization date counts from January, and says so', () => {
  const p = completed({ edit: (x) => { x.data.timeline.stabilization = 2024; x.data.sources.rows[0].termMonths = 30 } })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-debt-maturity')
  assert.match(f.evidence, /2024-01 \(year only, so January was used\): matures 2026-07/)
})

test('debt: a missing term or date gives a low missing-data flag', () => {
  const p = completed({ edit: (x) => { x.data.sources.rows[0].termMonths = null; x.data.timeline = { constructionStart: null, constructionCompletion: null, stabilization: null } } })
  const f = valid(run(p)).flags.find((x) => x.id === 'M3C-debt-maturity-missing')
  assert.equal(f?.severity, 'low')
  assert.match(f.evidence, /term in months of "Example Bank"/)
  assert.match(f.evidence, /stabilization or construction completion date/)
  assert.equal(rowOf(p, 'debt').status, 'not_checked')
})

// ---- Missing and partial T-12 --------------------------------------------------------------------------------------------

test('missing T-12 on a completed project: one low M3C-missing-data flag naming what could not run', () => {
  const p = completed({ months: 0 })
  const r = valid(run(p))
  const f = r.flags.find((x) => x.id === 'M3C-missing-data')
  assert.equal(f?.severity, 'low')
  assert.match(f.evidence, /No T-12 is loaded/)
  assert.match(f.evidence, /vacancy realism/)
  assert.equal(r.flags.filter((x) => x.id === 'M3C-missing-data').length, 1)
  const rows = checklist(p)
  assert.equal(rows.find((x) => x.id === 'actuals').status, 'not_checked')
  assert.equal(rows.find((x) => x.id === 'vacancy').status, 'not_checked')
  assert.equal(rows.find((x) => x.id === 'debt').status, 'pass', 'loan maturity does not need a T-12')
})

test('a T-12 whose rows have no real month counts as missing', () => {
  const p = completed({ t12: (m) => ({ ...m, month: 'sometime' }) })
  const r = valid(run(p))
  assert.match(r.flags.find((x) => x.id === 'M3C-missing-data')?.evidence ?? '', /none has a real month/)
  assert.ok(r.notes.some((n) => /12 T-12 rows have no real month/.test(n)))
})

test('partial T-12 (5 months): the checks still run, and say the figures are annualized from 5 months', () => {
  const p = completed({ months: 5 })
  const r = valid(run(p))
  assert.deepEqual(ids(r), [])
  assert.match(rowOf(p, 'actuals').detail, /Only 5 months of actuals/)
  assert.match(rowOf(p, 'vacancy').detail, /Only 5 months of history/)
  assert.ok(r.notes.some((n) => /5 months used \(fewer than 12/.test(n)))
})

test('T-12 months follow M0 rules: same month twice counts once (later wins), dates with days match', () => {
  const p = completed({ months: 3 })
  p.data.t12.rows.push({ ...goodMonth('2025-02-28'), occupancy: 0.5 })
  const t = readT12(p)
  assert.equal(t.months.length, 3)
  assert.equal(t.duplicates, 1)
  assert.equal(t.months[2].row.occupancy, 0.5)
  assert.ok(valid(run(p)).notes.some((n) => /appears more than once/.test(n)))
  assert.deepEqual(timelineMonth('2024-06'), { idx: 2024 * 12 + 5, yearOnly: false })
  assert.equal(timelineMonth('June'), null)
})

// ---- Lease-up and other stages ------------------------------------------------------------------------------------------

test('lease-up runs only what is actual (rent roll and expenses to date) and says so', () => {
  const p = completed({ stage: 'lease_up', months: 4, t12: (m) => ({ ...m, occupancy: 0.6, vacancyLoss: 24000, propertyTaxes: 14000 }) })
  const r = valid(run(p))
  assert.ok(r.notes.some((n) => /Lease-up: only the parts that are already actual/.test(n)))
  const rows = checklist(p)
  assert.equal(rows.find((x) => x.id === 'vacancy').status, 'not_applicable')
  assert.equal(rows.find((x) => x.id === 'debt').status, 'not_applicable')
  assert.match(rows.find((x) => x.id === 'actuals').detail, /waits until the property is stabilized/)
  // Low occupancy while filling is not a vacancy or NOI flag here (M3T follows it), but expenses to date still count.
  assert.ok(!ids(r).includes('M3C-vacancy-unsupported'))
  assert.ok(!ids(r).includes('M3C-actuals-vs-underwriting'))
  assert.ok(ids(r).includes('M3C-property-tax-reassessment'))
  for (const f of r.flags) assert.equal(f.stage_used, 'lease_up')
})

test('lease-up: billed rent below the rent roll is flagged', () => {
  const p = completed({ stage: 'lease_up', months: 3, t12: (m) => ({ ...m, residentialRevenue: 55000 }) })
  assert.equal(valid(run(p)).flags.find((f) => f.id === 'M3C-rent-roll-below-underwriting')?.severity, 'medium')
})

test('lease-up without a T-12 says what is missing', () => {
  const r = valid(run(completed({ stage: 'lease_up', months: 0 })))
  assert.match(r.flags.find((f) => f.id === 'M3C-missing-data')?.evidence ?? '', /rent roll and expenses to date/)
})

test('development: nothing runs, every row is not applicable', () => {
  const p = completed({ stage: 'development' })
  assert.deepEqual(valid(run(p)).flags, [])
  assert.ok(checklist(p).every((r) => r.status === 'not_applicable'))
})

// ---- Settings and bad input ----------------------------------------------------------------------------------------------

test('settings change the thresholds; bad settings fall back to the defaults', () => {
  const p = completed({ t12: (m) => ({ ...m, debtService: 30000 }) }) // actual DSCR about 1.7
  assert.ok(!ids(valid(run(p, { settings: { minDscr: 1.2 } }))).includes('M3C-actuals-vs-underwriting'))
  assert.ok(ids(valid(run(p, { settings: { minDscr: 2 } }))).includes('M3C-actuals-vs-underwriting'))
  assert.ok(!ids(valid(run(p, { settings: { minDscr: 'lots' } }))).includes('M3C-actuals-vs-underwriting'))
})

test('no crash on bad input: anything odd becomes notes or a guarded flag', () => {
  for (const bad of [null, undefined, 42, 'project', {}, { data: null }, { data: { stage: { stage: 'completed' } } }, { data: { stage: { stage: 'nonsense' } } }]) {
    const r = run(bad, {})
    assert.ok(Array.isArray(r.flags) && Array.isArray(r.notes))
    for (const f of r.flags) assert.deepEqual(validateFlag(f), [])
    assert.doesNotThrow(() => checklist(bad === null || typeof bad !== 'object' || !bad.data?.stage ? bad : { data: { stage: { stage: 'development' } } }))
  }
  // A completed project with broken groups is caught by the guard as one "check failed" flag.
  const broken = completed()
  broken.data.sources = null
  const r = run(broken, {})
  assert.deepEqual(ids(r), ['M3C-check-failed'])
  // Garbage inside the T-12 rows is skipped, never fatal.
  const messy = completed({ months: 3 })
  messy.data.t12.rows.push('x', { month: 7 })
  assert.ok(!ids(valid(run(messy))).includes('M3C-check-failed'))
  // A null T-12 row stops the shared calculators; the guard turns that into one visible flag instead of a crash.
  const nullRow = completed({ months: 3 })
  nullRow.data.t12.rows.push(null)
  assert.deepEqual(ids(run(nullRow, {})), ['M3C-check-failed'])
  assert.equal(MODULE_ID, 'M3C')
})
