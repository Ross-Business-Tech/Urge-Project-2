import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios, t12Rows } from '../../shared/samples/scenarios.js'
import { healthyFirm, healthyProject } from '../../shared/samples/baseline.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, compareSeverity, validateFlag, noi, annualDebtService } from '../../shared/index.js'
import { run, sponsorSummary, MODULE_ID } from '../index.js'

const AS_OF = '2026-01-15'
const staged = (record, stage, asOfDate = AS_OF) => applyStageAndDate(record, { stage, asOfDate })
const completed = (record) => {
  record.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization: '2024-06' }
  return record
}
const withMeta = (record, projectId) => Object.assign(record, { meta: { projectId } })
const ids = (flags) => flags.map((f) => f.id)
const assertValid = (result) => {
  assert.ok(!result.flags.some((f) => f.id === 'M5-check-failed'), `a check crashed: ${result.notes.join(' | ')}`)
  for (const f of result.flags) {
    assert.deepEqual(validateFlag(f), [], f.id)
    assert.equal(f.module, 'M5')
    assert.equal(f.layer, 5)
  }
}

// Load a scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  const projects = out.projects.map((p) => staged(p, s.stage, s.asOf))
  if (s.t12) projects[0] = replaceT12Rows(projects[0], parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return { record: projects[0], context: { firm: out.firm, projects } }
}

test('MODULE_ID is M5', () => assert.equal(MODULE_ID, 'M5'))

for (const s of scenarios) {
  test(`${s.id}: M5 matches the answer key`, async () => {
    const { record, context } = await load(s)
    const result = run(record, context)
    assertValid(result)
    for (const want of s.key.flags.filter((k) => k.module === 'M5')) {
      const got = result.flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${ids(result.flags).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy control gets no high or medium sponsor flag', async () => {
  const { record, context } = await load(scenarios.find((s) => s.id === 's01-healthy-development'))
  const result = run(record, context)
  assert.deepEqual(result.flags.filter((f) => f.severity !== 'low').map((f) => f.evidence), [])
  const s = sponsorSummary(context.firm, context.projects, { project: record })
  assert.ok(s.liquidity.ok)
  assert.equal(s.liquidity.value, 900000 / 80000)
  assert.ok(s.feeDependence.ok)
  assert.equal(s.feeDependence.year, 2025)
  assert.equal(s.feeDependence.fees, 640000)
})

test('a healthy project under a failing firm is flagged high, cites the balance sheet, and says the project itself holds up', async () => {
  const { record, context } = await load(scenarios.find((s) => s.id === 's10-healthy-project-failing-firm'))
  const result = run(record, context)
  const f = result.flags.find((x) => x.id === 'M5-firm-liquidity')
  assert.equal(f.severity, 'high')
  assert.match(f.title, /own numbers hold up/)
  assert.match(f.evidence, /\$20,000 against \$600,000/)
  assert.ok(f.cell_refs.includes('Balance Sheet!B9'), f.cell_refs.join(', '))
  assert.ok(f.cell_refs.includes('Balance Sheet!B38'), f.cell_refs.join(', '))
  const fee = result.flags.find((x) => x.id === 'M5-fee-income-weak')
  assert.equal(fee.severity, 'high')
  assert.ok(fee.cell_refs.some((c) => c.startsWith('Consol Financials')))
  // The project-level coverage is still sound: the risk is the sponsor, not the project.
  assert.ok(!result.flags.some((x) => x.id === 'M5-global-dscr-low'))
})

test('the same failing firm behind a development project is flagged high too, and says the stage makes it matter most', () => {
  const firm = healthyFirm()
  Object.assign(firm.data.balanceSheet.lines, { cash: { current: 20000, prior: 400000 }, accountsPayable: { current: 600000, prior: 150000 } })
  const project = staged(healthyProject(), 'development')
  const f = run(project, { firm, projects: [project] }).flags.find((x) => x.id === 'M5-firm-liquidity')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /matters most now/)
})

test('a thin (not negative) cash cushion is medium at development and low once completed', () => {
  const firm = healthyFirm()
  firm.data.balanceSheet.lines.accountsPayable = { current: 700000, prior: 70000 } // 900,000 / 700,000 = 1.29x
  const dev = staged(healthyProject(), 'development')
  assert.equal(run(dev, { firm, projects: [dev] }).flags.find((x) => x.id === 'M5-firm-liquidity').severity, 'medium')
  const done = staged(completed(healthyProject()), 'completed')
  assert.equal(run(done, { firm, projects: [done] }).flags.find((x) => x.id === 'M5-firm-liquidity').severity, 'low')
})

test('liquidity: the principal\'s personal cash softens a shortfall, and missing inputs are "not available", never zero', () => {
  const firm = healthyFirm()
  Object.assign(firm.data.balanceSheet.lines, { cash: { current: 50000, prior: null }, accountsPayable: { current: 100000, prior: null } })
  firm.data.principalStatement.lines.securities = { amount: 200000 } // with checking 250,000: (50k + 450k) / 100k = 5x
  const s = sponsorSummary(firm, [], {})
  assert.equal(s.liquidity.value, 0.5)
  assert.equal(s.liquidity.withPrincipal, 5)
  const project = staged(healthyProject(), 'development')
  assert.equal(run(project, { firm, projects: [project] }).flags.find((x) => x.id === 'M5-firm-liquidity').severity, 'medium')

  const noCash = healthyFirm()
  noCash.data.balanceSheet.lines.cash = { current: null, prior: null }
  const a = sponsorSummary(noCash, [], {}).liquidity
  assert.equal(a.ok, false)
  assert.match(a.reason, /no cash/)
  assert.equal(a.value, undefined)
  assert.ok(run(project, { firm: noCash, projects: [project] }).flags.some((f) => f.id === 'M5-liquidity-missing' && f.severity === 'low'))

  const noPayables = healthyFirm()
  noPayables.data.balanceSheet.lines.accountsPayable = { current: null, prior: null }
  assert.match(sponsorSummary(noPayables, [], {}).liquidity.reason, /short-term obligations/)

  const owesNothing = healthyFirm()
  owesNothing.data.balanceSheet.lines.accountsPayable = { current: 0, prior: 0 }
  const z = sponsorSummary(owesNothing, [], {}).liquidity
  assert.equal(z.ok, false)
  assert.ok(z.nothingOwed)
  assert.ok(!run(project, { firm: owesNothing, projects: [project] }).flags.some((f) => f.id.startsWith('M5-liquidity') || f.id === 'M5-firm-liquidity'))

  const silly = healthyFirm()
  silly.data.balanceSheet.lines.cash = { current: -5, prior: null }
  assert.match(sponsorSummary(silly, [], {}).liquidity.reason, /not a believable amount/)
})

test('global DSCR adds NOI and debt service across usable projects and names the ones left out', () => {
  const a = withMeta(staged(healthyProject({ name: 'Alpha' }), 'development'), 'a')
  const b = withMeta(staged(completed(healthyProject({ name: 'Beta' })), 'completed'), 'b')
  b.data.sources.rows[0].amount = 4000000 // more debt on Beta
  const badRate = withMeta(staged(healthyProject({ name: 'Gamma' }), 'development'), 'c')
  badRate.data.sources.rows[0].interestRate = 6.5 // 650%: refused
  const noIncome = withMeta(staged(healthyProject({ name: 'Delta' }), 'lease_up'), 'd')
  noIncome.data.residentialIncome.rows = []
  noIncome.data.commercialIncome.rows = []
  noIncome.data.otherIncome.rows = []

  const s = sponsorSummary(healthyFirm(), [a, b, badRate, noIncome], { project: a })
  const expected = (noi(a).value + noi(b).value) / (annualDebtService(a).value + annualDebtService(b).value)
  assert.ok(s.globalDscr.ok)
  assert.ok(Math.abs(s.globalDscr.value - expected) < 1e-9)
  assert.equal(s.globalDscr.count, 2)
  assert.deepEqual(s.globalDscr.included, ['Alpha', 'Beta'])
  assert.deepEqual(s.globalDscr.excluded.map((x) => x.name), ['Gamma', 'Delta'])
  assert.match(s.globalDscr.excluded[0].reason, /650%/)
  assert.match(s.globalDscr.excluded[1].reason, /No income/)
  assert.ok(s.globalDscr.operating.ok)
  assert.ok(Math.abs(s.globalDscr.operating.value - noi(b).value / annualDebtService(b).value) < 1e-9)

  const flags = run(a, { firm: healthyFirm(), projects: [a, b, badRate, noIncome] }).flags
  const missing = flags.find((f) => f.id === 'M5-global-dscr-missing')
  assert.equal(missing.severity, 'low')
  assert.match(missing.evidence, /Gamma/)
  assert.match(missing.evidence, /Delta/)
})

test('global DSCR under the minimum across several projects is flagged; nothing usable is "not available"', () => {
  const weak = (name) => {
    const p = withMeta(staged(healthyProject({ name }), 'completed'), name)
    p.data.sources.rows = [{ lienPriority: 1, name: 'Bank', type: 'hard_debt', amount: 7000000, termMonths: 360, interestRate: 0.09, paymentOverride: null }]
    return p
  }
  const projects = [staged(healthyProject(), 'development'), weak('W1'), weak('W2')]
  const flags = run(projects[0], { firm: healthyFirm(), projects }).flags
  const f = flags.find((x) => x.id === 'M5-global-dscr-low')
  assert.ok(f)
  assert.ok(['medium', 'high'].includes(f.severity))
  assert.match(f.evidence, /global DSCR/)

  const broken = staged(healthyProject(), 'development')
  broken.data.sources.rows[0].interestRate = 6.5
  const s = sponsorSummary(healthyFirm(), [broken], {})
  assert.equal(s.globalDscr.ok, false)
  assert.equal(s.globalDscr.value, undefined)
  assert.ok(run(broken, { firm: healthyFirm(), projects: [broken] }).flags.some((x) => x.id === 'M5-global-dscr-missing'))
})

test('the hidden second project is part of the sponsor total (s06)', async () => {
  const { record, context } = await load(scenarios.find((s) => s.id === 's06-hidden-tab-with-data'))
  const s = sponsorSummary(context.firm, context.projects, { project: record })
  assert.equal(s.counts.total, 2)
  assert.equal(s.globalDscr.count, 2)
})

test('a development project is scored on the sponsor\'s completed projects: a poor delivery record is flagged high', () => {
  const dev = withMeta(staged(healthyProject({ name: 'New Build' }), 'development'), 'dev')
  const done = withMeta(staged(completed(healthyProject({ name: 'Old Build' })), 'completed'), 'done')
  done.data.t12.rows = t12Rows({ rentFactor: 0.8, occupancy: 0.85 }) // rents 20% below plan, NOI well below
  const trackRecord = { done: { finalCost: 6800000, plannedCompletion: '2022-09' } } // 23% over budget, 9 months late
  const context = { firm: healthyFirm(), projects: [dev, done], trackRecord }

  const s = sponsorSummary(context.firm, context.projects, { ...context, project: dev })
  assert.ok(s.credibility.ok)
  const row = s.credibility.rows[0]
  assert.equal(row.name, 'Old Build')
  assert.equal(row.measures.budget.status, 'missed')
  assert.equal(row.measures.schedule.status, 'missed')
  assert.equal(row.measures.rents.status, 'missed')
  assert.equal(row.measures.stabilization.status, 'missed')
  assert.equal(s.credibility.value, 0)
  assert.equal(s.credibility.band, 'weak')
  assert.equal(s.credibility.counted, 4)

  const f = run(dev, context).flags.find((x) => x.id === 'M5-credibility-low')
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /Old Build: rents/)
  assert.match(f.title, /fell short/)
})

test('a strong delivery record scores well and raises nothing; budget and schedule are "not available" without the original plan', () => {
  const dev = staged(healthyProject(), 'development')
  const done = withMeta(staged(completed(healthyProject({ name: 'Old Build' })), 'completed'), 'done')
  done.data.t12.rows = t12Rows()
  const s = sponsorSummary(healthyFirm(), [dev, done], { project: dev })
  assert.equal(s.credibility.value, 100)
  assert.equal(s.credibility.band, 'strong')
  assert.equal(s.credibility.counted, 2)
  const m = s.credibility.rows[0].measures
  assert.equal(m.budget.ok, false)
  assert.match(m.budget.reason, /budget|final cost/)
  assert.equal(m.schedule.ok, false)
  assert.match(m.schedule.reason, /planned completion/)
  assert.equal(m.rents.status, 'delivered')
  assert.equal(m.stabilization.status, 'delivered')
  assert.ok(!run(dev, { firm: healthyFirm(), projects: [dev, done] }).flags.some((x) => x.id.startsWith('M5-credibility')))
})

test('mixed delivery is medium for a development project; no completed projects is a low "missing" flag', () => {
  const dev = staged(healthyProject(), 'development')
  const done = withMeta(staged(completed(healthyProject({ name: 'Old Build' })), 'completed'), 'done')
  done.data.t12.rows = t12Rows({ rentFactor: 0.95 }) // rents a little short, NOI a little short
  const s = sponsorSummary(healthyFirm(), [dev, done], { project: dev })
  assert.equal(s.credibility.band, 'mixed')
  assert.equal(run(dev, { firm: healthyFirm(), projects: [dev, done] }).flags.find((x) => x.id === 'M5-credibility-low').severity, 'medium')

  const alone = run(dev, { firm: healthyFirm(), projects: [dev] }).flags.find((x) => x.id === 'M5-track-record-missing')
  assert.equal(alone.severity, 'low')

  const noT12 = withMeta(staged(completed(healthyProject({ name: 'No T12' })), 'completed'), 'n')
  const flags = run(dev, { firm: healthyFirm(), projects: [dev, noT12] }).flags
  assert.ok(flags.some((x) => x.id === 'M5-credibility-missing'), ids(flags).join(', '))
})

test('no firm record: a low missing-data flag, and the project-based checks still run', () => {
  const project = staged(healthyProject(), 'development')
  for (const firm of [undefined, null, {}, 'firm', 42]) {
    const result = run(project, { firm, projects: [project] })
    assertValid(result)
    const f = result.flags.find((x) => x.id === 'M5-firm-record-missing')
    assert.ok(f, `firm = ${String(firm)}`)
    assert.equal(f.severity, 'low')
    assert.ok(!result.flags.some((x) => x.id === 'M5-firm-liquidity'))
  }
  const s = sponsorSummary(null, [project], {})
  assert.equal(s.firm.ok, false)
  assert.equal(s.liquidity.ok, false)
  assert.equal(s.feeDependence.ok, false)
  assert.ok(s.globalDscr.ok)
})

test('projected fiscal years are left out of fee figures; no earnings is a low missing flag', () => {
  const firm = healthyFirm()
  firm.data.earnings.rows.push({ fiscalYear: 2028, developerFee: 5000000 })
  const s = sponsorSummary(firm, [], { asOfDate: AS_OF })
  assert.equal(s.feeDependence.year, 2025)
  assert.equal(s.feeDependence.projectionsLeftOut, 1)

  const empty = healthyFirm()
  empty.data.earnings.rows = []
  const project = staged(healthyProject(), 'development')
  assert.ok(run(project, { firm: empty, projects: [project] }).flags.some((f) => f.id === 'M5-fee-income-missing' && f.severity === 'low'))
})

test('no crash on bad input', () => {
  const good = staged(healthyProject(), 'development')
  const odd = healthyFirm()
  odd.data.balanceSheet.lines.cash = { current: 'lots', prior: Number.NaN }
  odd.data.earnings.rows = [null, 7, { fiscalYear: 'x' }, { fiscalYear: 2025, developerFee: -1 }]
  odd.data.projects = { rows: 'nope' }
  const cases = [
    [null, undefined],
    [undefined, {}],
    [{}, { firm: healthyFirm() }],
    [good, null],
    [good, 'context'],
    [good, { firm: odd, projects: [null, 5, {}, { record: null }, good] }],
    [good, { firm: { data: { balanceSheet: null, earnings: null } }, projects: 'all of them' }],
    [good, { firm: healthyFirm(), projects: [{ data: { stage: { stage: 'completed' } } }] }],
    [good, { firm: healthyFirm(), settings: { minDscr: 'high' }, trackRecord: 'x' }],
  ]
  for (const [project, context] of cases) {
    const result = run(project, context)
    assertValid(result)
    assert.ok(result.flags.length > 0)
  }
  // The summary never throws either, and every figure says why it is missing.
  for (const [firm, projects] of [[undefined, undefined], [odd, [null, good, {}]], ['x', 'y']]) {
    const s = sponsorSummary(firm, projects, null)
    for (const key of ['globalDscr', 'liquidity', 'feeDependence', 'credibility']) {
      assert.ok(s[key].ok || (typeof s[key].reason === 'string' && s[key].reason.length > 0), key)
    }
  }
  const s = sponsorSummary(odd, [good], {})
  assert.equal(s.liquidity.ok, false)
  assert.match(s.feeDependence.reason ?? '', /believable|no fee/)
})

test('no stage chosen: a low missing-data flag instead of a crash', () => {
  const result = run(healthyProject(), { firm: healthyFirm() })
  assertValid(result)
  assert.deepEqual(ids(result.flags), ['M5-stage-missing'])
})
