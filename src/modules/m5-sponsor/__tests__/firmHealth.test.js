import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { blankFirm } from '../../shared/records.js'
import { healthyFirm } from '../../shared/samples/baseline.js'
import { firmHealth, liquidityCover, globalDscr, feeDependence, leverage, WEIGHTS, labelFor, interpolate } from '../index.js'

// Load a scenario the way an underwriter would: import the applicant workbook.
async function load(id) {
  const s = scenarios.find((x) => x.id === id)
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  return { firm: out.firm, projects: out.projects }
}

test('weights add up to 100%', () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(total - 1) < 1e-9)
  assert.equal(WEIGHTS.liquidity, 0.4) // liquidity counts most (chosen with the team)
})

test('score bands', () => {
  assert.equal(labelFor(98).label, 'Strong')
  assert.equal(labelFor(75).label, 'Strong')
  assert.equal(labelFor(60).label, 'Adequate')
  assert.equal(labelFor(40).label, 'Weak')
  assert.equal(labelFor(5).label, 'Failing')
})

test('interpolate is flat outside the points and linear between them', () => {
  const pts = [[0, 0], [1, 60], [2, 100]]
  assert.equal(interpolate(-5, pts), 0)
  assert.equal(interpolate(0.5, pts), 30)
  assert.equal(interpolate(1.5, pts), 80)
  assert.equal(interpolate(9, pts), 100)
})

test('the healthy control scores Strong on all four measures', async () => {
  const { firm, projects } = await load('s01-healthy-development')
  const r = firmHealth(firm, projects)
  assert.equal(r.ok, true)
  assert.equal(r.used, 4)
  assert.equal(r.label, 'Strong')
  assert.ok(r.score >= 90, `score ${r.score}`)
})

test('s10: a healthy project under a failing firm scores Failing, and liquidity is the loudest alarm', async () => {
  const { firm, projects } = await load('s10-healthy-project-failing-firm')
  const r = firmHealth(firm, projects)
  assert.equal(r.label, 'Failing')
  assert.ok(r.score < 20, `score ${r.score}`)
  const liq = r.parts.find((p) => p.id === 'liquidity')
  assert.ok(Math.abs(liq.value - 20000 / 600000) < 1e-9, 'firm cash 20,000 against 600,000 of payables')
  assert.ok(liq.score < 5)
  assert.ok(liq.detail.some((d) => d.includes('fell from $400,000')))
  const fee = r.parts.find((p) => p.id === 'feeDependence')
  assert.equal(fee.score, 0, 'fee income fell to zero')
})

test('the principal’s own cash is shown but does not lift the liquidity score', () => {
  const firm = healthyFirm()
  const base = liquidityCover(firm)
  firm.data.principalStatement.lines.cashChecking = { amount: 50_000_000 }
  const rich = liquidityCover(firm)
  assert.equal(rich.score, base.score)
  assert.ok(rich.detail.some((d) => d.includes('principal also holds')))
})

test('s06: the hidden project is counted in global coverage', async () => {
  const { firm, projects } = await load('s06-hidden-tab-with-data')
  assert.equal(projects.length, 2)
  const g = globalDscr(firm, projects)
  assert.equal(g.ok, true)
  assert.equal(g.counted, 2)
  assert.equal(g.total, 2)
})

test('global DSCR says when the firm’s share of a project is unknown', async () => {
  const { firm, projects } = await load('s01-healthy-development')
  const g = globalDscr(firm, projects)
  assert.ok(g.notes.some((n) => n.includes('ownership share is blank')))
  const id = projects[0].meta.projectId
  firm.data.projects.rows = [{ projectId: id, ownershipPct: 0.5 }]
  const half = globalDscr(firm, projects)
  assert.ok(!half.notes.some((n) => n.includes('ownership share is blank')))
  assert.notEqual(half.value, g.value)
})

test('global DSCR does not count distributions from projects as firm income', () => {
  const firm = healthyFirm()
  const without = globalDscr(firm, [])
  firm.data.earnings.rows[2].operatingCashDistributions = 400_000
  firm.data.earnings.rows[2].existingInterestExpense = 50_000
  const withDist = globalDscr(firm, [])
  assert.equal(withDist.firmCashFlow, 640_000 - 447_000)
  assert.ok(withDist.notes.some((n) => n.includes('left out of the firm')))
  assert.equal(without.ok, false, 'with no project and no firm debt payments there is nothing to cover')
})

test('years after the balance sheet period are treated as projections and left out', () => {
  const firm = healthyFirm() // balance sheet period 2025
  firm.data.earnings.rows[2].existingInterestExpense = 10_000 // so there is a payment to cover
  firm.data.earnings.rows.push({ fiscalYear: 2026, developerFee: 5_000_000, salariesWages: 100_000, existingInterestExpense: 1000 })
  const g = globalDscr(firm, [])
  assert.equal(g.firmCashFlow, 640_000 - 447_000, 'the 2026 projection is not used')
})

test('a blank firm gives "not available" for every measure, never a number and never a crash', () => {
  const firm = blankFirm()
  const r = firmHealth(firm, [])
  assert.equal(r.ok, false)
  assert.equal(r.used, 0)
  assert.equal(r.parts.length, 4)
  for (const p of r.parts) {
    assert.equal(p.ok, false)
    assert.ok(p.reason.length > 10)
    assert.ok(p.needs.length > 0, 'names the form to fill in')
  }
})

test('with no firm at all there is nothing to judge', () => {
  assert.equal(firmHealth(null, []).ok, false)
})

test('one missing measure is left out of the score and the result says so', () => {
  const firm = healthyFirm()
  firm.data.balanceSheet.lines.cash = { current: null, prior: null } // no cash entered
  const r = firmHealth(firm, [])
  assert.equal(r.parts.find((p) => p.id === 'liquidity').ok, false)
  assert.ok(r.used < 4)
  assert.ok(r.notes[0].includes(`${r.used} of 4`))
})

test('a number that cannot be believed is refused with a reason that names it', () => {
  const firm = healthyFirm()
  firm.data.balanceSheet.lines.cash = { current: 9e15, prior: null }
  const l = liquidityCover(firm)
  assert.equal(l.ok, false)
  assert.ok(l.reason.includes('Cash'))
  assert.ok(l.reason.includes('believable'))
})

test('no result is ever NaN or Infinity, even with zero obligations or zero equity', () => {
  const firm = healthyFirm()
  firm.data.balanceSheet.lines.accountsPayable = { current: 0, prior: 0 }
  const l = liquidityCover(firm)
  assert.equal(l.ok, true)
  assert.equal(l.value, null)
  assert.equal(l.score, 100)
  firm.data.balanceSheet.lines.partnersEquity = { current: 0, prior: 0 }
  const v = leverage(firm)
  assert.equal(v.ok, true)
  assert.equal(v.score, 0)
  const all = firmHealth(firm, [])
  assert.ok(Number.isFinite(all.score))
})

test('fee dependence: shrinking income lowers the score even when the share looks fine', () => {
  const firm = healthyFirm()
  firm.data.earnings.rows = [
    { fiscalYear: 2023, developerFee: 300_000, propertyManagementFee: 300_000 },
    { fiscalYear: 2024, developerFee: 200_000, propertyManagementFee: 200_000 },
    { fiscalYear: 2025, developerFee: 100_000, propertyManagementFee: 100_000 },
  ]
  const f = feeDependence(firm)
  assert.equal(f.ok, true)
  assert.equal(f.score, 0) // income fell 67% in two years
})

test('the sample answer key stays true: only s10 raises a firm alarm', async () => {
  for (const s of scenarios) {
    const { firm, projects } = await load(s.id)
    const r = firmHealth(firm, projects)
    const alarm = r.ok && ['Weak', 'Failing'].includes(r.label)
    assert.equal(alarm, s.id === 's10-healthy-project-failing-firm', `${s.id}: ${r.label} ${r.score}`)
  }
})
