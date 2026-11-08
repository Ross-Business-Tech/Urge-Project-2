import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { healthyProject, healthyFirm } from '../../shared/samples/baseline.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { applyStageAndDate, compareSeverity, validateFlag, BENCHMARK_SETS } from '../../shared/index.js'
import { run, checklist, MODULE_ID } from '../index.js'
import { period } from '../checks.js'

// A made-up project with a stage and date, built in code. `edit` breaks one thing on purpose.
function project(stage = 'development', edit = () => {}, asOfDate = '2026-01-15') {
  const p = healthyProject()
  edit(p.data)
  return applyStageAndDate(p, { stage, asOfDate })
}
const ids = (result) => result.flags.map((f) => f.id)
const flagOf = (result, id) => result.flags.find((f) => f.id === id)
const row = (p, id, context) => checklist(p, context).find((r) => r.id === id)
const firm = healthyFirm()
const fullTeam = (d) => {
  d.team.lines.generalContractor.firmName = 'Sample Builders'
  d.team.lines.architect.firmName = 'Example Design Studio'
  d.team.lines.devPartner1.firmName = 'Maple Ridge Partners'
  d.team.lines.other1.firmName = 'Sample Property Management'
  d.team.lines.other2.firmName = 'Pat Sample (guarantor)'
}
const assertValid = (result) => {
  for (const f of result.flags) {
    assert.deepEqual(validateFlag(f), [], f.id)
    assert.ok(f.id.startsWith('M3D-'), f.id)
    assert.equal(f.module, 'M3D')
  }
  assert.ok(!ids(result).includes('M3D-check-failed'), result.notes.join(' | '))
}

// ---- The answer key, loaded the way an underwriter would (import the workbook, choose stage and date) ----

async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  return { record: applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf }), context: { firm: out.firm } }
}

for (const s of scenarios) {
  test(`${s.id}: M3D matches the answer key and every flag is well formed`, async () => {
    const { record, context } = await load(s)
    const result = run(record, context)
    assertValid(result)
    for (const want of s.key.flags.filter((k) => k.module === MODULE_ID)) {
      const got = flagOf(result, want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}: ${got?.evidence}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${ids(result).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy control raises no high or medium M3D flag', async () => {
  const { record, context } = await load(scenarios[0])
  const result = run(record, context)
  assert.deepEqual(result.flags.filter((f) => f.severity !== 'low').map((f) => f.id), [])
})

test('thin contingency: the flag cites the budget cell and states the value against the range', async () => {
  const { record, context } = await load(scenarios.find((s) => s.id === 's03-thin-contingency'))
  const f = flagOf(run(record, context), 'M3D-contingency-low')
  assert.match(f.evidence, /1\.1% of hard cost vs\. a 5% to 10% benchmark/)
  assert.ok(f.cell_refs.some((c) => /Budget!G40$/.test(c)), f.cell_refs.join(', '))
  assert.equal(f.transition, 'T1')
  assert.equal(f.stage_used, 'development')
})

// ---- 1. Budget realism ----

test('budget: contingency below the range is flagged; above the range is not (more cushion is fine)', () => {
  const thin = run(project('development', (d) => (d.budget.lines.constructionContingency.amount = 140000)))
  assert.equal(flagOf(thin, 'M3D-contingency-low').severity, 'medium') // 4% vs 5%: below, but not below half
  const generous = project('development', (d) => (d.budget.lines.constructionContingency.amount = 900000)) // 25.7%
  assert.ok(!ids(run(generous)).includes('M3D-contingency-low'))
  const item = row(generous, 'budget').items.find((i) => i.label === 'Contingency size')
  assert.equal(item.status, 'pass')
  assert.match(item.text, /above the range/)
})

test('budget: a custom benchmark set changes the contingency range', () => {
  const sets = structuredClone(BENCHMARK_SETS)
  sets.development.contingencyShare = { low: 0.12, median: 0.14, high: 0.16 }
  assert.ok(ids(run(project(), { benchmarks: sets })).includes('M3D-contingency-low'))
})

test('budget: the hard-to-soft cost split is flagged when soft costs are far outside the implied range', () => {
  const heavy = run(project('development', (d) => (d.budget.lines.legalAccounting.amount = 2000000)))
  assert.ok(ids(heavy).includes('M3D-hard-soft-ratio'))
  const light = run(
    project('development', (d) => {
      for (const k of ['architectureEngineering', 'softCostContingency', 'rentUpReserve', 'operatingReserve']) d.budget.lines[k].amount = null
    }),
  )
  assert.equal(flagOf(light, 'M3D-hard-soft-ratio').severity, 'medium')
  assert.ok(!ids(run(project())).includes('M3D-hard-soft-ratio'))
})

test('budget: cost per square foot above the benchmark is flagged high-cost; with no square feet it says what is missing', () => {
  const pricey = run(project('development', (d) => { d.residentialIncome.rows[0].sqft = 100; d.commercialIncome.rows[0].sqft = 1000 }))
  assert.ok(ids(pricey).includes('M3D-cost-per-sqft-high'))
  const noSqft = run(project('development', (d) => { d.residentialIncome.rows[0].sqft = null; d.commercialIncome.rows = [] }))
  assert.equal(flagOf(noSqft, 'M3D-cost-per-sqft-missing').severity, 'low')
})

test('budget: sponsor fees above 15% of cost, and a mostly deferred fee, are flagged', () => {
  const big = run(project('development', (d) => (d.budget.lines.developerFee.amount = 1200000)))
  assert.match(flagOf(big, 'M3D-sponsor-fees-high').evidence, /Developer and related-party fees \$1,200,000/)
  const deferred = run(project('development', (d) => (d.budget.lines.developerFee.amount = 600000))) // 550,000 of 600,000 deferred
  assert.ok(ids(deferred).includes('M3D-fee-mostly-deferred'))
  assert.ok(!ids(deferred).includes('M3D-sponsor-fees-high'))
  // The baseline defers 550,000 of fee while the budget shows none.
  assert.ok(ids(run(project())).includes('M3D-deferred-fee-unmatched'))
  const fine = project('development', (d) => { d.budget.lines.developerFee.amount = 600000; d.sources.rows[2].amount = 200000 })
  assert.equal(row(fine, 'budget').items.find((i) => i.label === 'Sponsor and related-party fees').status, 'pass')
})

test('budget: no budget at all gives low missing-data flags, not a crash', () => {
  const p = project('development', (d) => {
    for (const line of Object.values(d.budget.lines)) line.amount = null
  })
  const result = run(p)
  assertValid(result)
  const f = flagOf(result, 'M3D-contingency-missing')
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /No development budget entered/)
  assert.equal(row(p, 'budget').status, 'not_checked')
})

// ---- 2. Schedule ----

test('schedule: the healthy timeline passes', () => {
  const r = row(project(), 'schedule')
  assert.equal(r.status, 'pass')
  assert.deepEqual(r.flags, [])
})

test('schedule: dates out of order are a high flag', () => {
  const result = run(project('development', (d) => (d.timeline.constructionCompletion = '2025-12')))
  const f = flagOf(result, 'M3D-schedule-out-of-order')
  assert.equal(f.severity, 'high')
  assert.equal(f.transition, 'T1')
  assert.match(f.evidence, /completion \(2025-12\) is not after the start \(2026-03\)/)
})

test('schedule: a construction period that is too short, and a lease-up that is too fast, are flagged', () => {
  const short = run(project('development', (d) => { d.timeline.constructionCompletion = '2026-06'; d.timeline.stabilization = '2027-03' }))
  assert.ok(ids(short).includes('M3D-construction-short'))
  const fast = run(project('development', (d) => (d.residentialIncome.rows[0].units = 400)))
  const f = flagOf(fast, 'M3D-lease-up-fast')
  assert.equal(f.transition, 'T2')
  assert.match(f.evidence, /9 months .* for 400 units/)
})

test('schedule: years only are read as ranges and only clearly wrong dates are flagged', () => {
  assert.deepEqual(period(2027), { lo: 2027 * 12, hi: 2027 * 12 + 11, text: '2027' })
  assert.deepEqual(period('2027-06'), { lo: 2027 * 12 + 5, hi: 2027 * 12 + 5, text: '2027-06' })
  assert.equal(period('soon'), null)
  const years = project('development', (d) => Object.assign(d.timeline, { constructionStart: 2026, constructionCompletion: 2027, stabilization: 2028 }))
  assert.equal(row(years, 'schedule').status, 'pass')
})

test('schedule: missing or unreadable dates give a low missing-data flag naming them', () => {
  const p = project('development', (d) => Object.assign(d.timeline, { stabilization: null, constructionStart: 'next spring' }))
  const f = flagOf(run(p), 'M3D-schedule-missing')
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /stabilization/)
  assert.match(f.evidence, /construction start \(could not be read/)
})

test('schedule: a completion date already past the "as of" date is flagged for a development project', () => {
  const f = flagOf(run(project('development', () => {}, '2027-09-01')), 'M3D-completion-passed')
  assert.equal(f.severity, 'medium')
  assert.equal(f.transition, 'T1')
})

// ---- 3. Capital stack and takeout ----

test('capital: the healthy stack passes all three parts', () => {
  const r = row(project(), 'capital')
  assert.equal(r.status, 'pass', r.detail)
  assert.deepEqual(r.items.map((i) => i.status), ['pass', 'pass', 'pass'])
})

test('capital: shared lien positions, or equity ranked ahead of a loan, are flagged', () => {
  const shared = run(project('development', (d) => (d.sources.rows[1].lienPriority = 1)))
  const f = flagOf(shared, 'M3D-lien-priority-unclear')
  assert.equal(f.severity, 'medium')
  assert.match(f.evidence, /share lien position 1/)
  const equityFirst = run(project('development', (d) => { d.sources.rows[0].lienPriority = 3; d.sources.rows[2].lienPriority = 1 }))
  assert.match(flagOf(equityFirst, 'M3D-lien-priority-unclear').evidence, /ranked ahead of a loan/)
  const unranked = run(project('development', (d) => (d.sources.rows[0].lienPriority = null)))
  assert.equal(flagOf(unranked, 'M3D-lien-priority-missing').severity, 'low')
})

test('capital: reserves that cannot carry the loan through lease-up are flagged as a delivery (T1) risk', () => {
  const short = run(project('development', (d) => (d.budget.lines.rentUpReserve.amount = 50000)))
  const f = flagOf(short, 'M3D-interest-reserve-short')
  assert.equal(f.transition, 'T1')
  assert.match(f.evidence, /Reserves \$150,000 .* vs\. about \$215,838/)
  const none = run(project('development', (d) => { d.budget.lines.rentUpReserve.amount = null; d.budget.lines.operatingReserve.amount = null }))
  assert.equal(flagOf(none, 'M3D-interest-reserve-none').severity, 'high')
  const withInterest = run(project('development', (d) => { d.budget.lines.rentUpReserve.amount = 50000; d.budget.lines.constructionInterest.amount = 150000 }))
  assert.ok(!ids(withInterest).some((id) => id.startsWith('M3D-interest-reserve')))
})

test('capital: DSCR under the minimum, a low debt yield and a loan maturing before stabilization are takeout risks (T2)', () => {
  const tight = run(project(), { settings: { minDscr: 3 } })
  assert.equal(flagOf(tight, 'M3D-dscr-under-minimum').transition, 'T2')
  assert.match(flagOf(tight, 'M3D-dscr-under-minimum').evidence, /2\.71× vs\. a 3\.00× minimum/)
  const early = run(project('development', (d) => (d.sources.rows[0].termMonths = 24)))
  assert.equal(flagOf(early, 'M3D-loan-matures-early').severity, 'high')
  const leveraged = run(project('development', (d) => { d.sources.rows[0].amount = 9000000; d.sources.rows[0].interestRate = 0.01 }))
  assert.ok(ids(leveraged).includes('M3D-debt-yield-low'))
})

test('capital: a refused interest rate gives low missing-data flags instead of a guessed DSCR', () => {
  const result = run(project('development', (d) => (d.sources.rows[0].interestRate = 6.5)))
  assertValid(result)
  assert.equal(flagOf(result, 'M3D-takeout-missing').severity, 'low')
  assert.match(flagOf(result, 'M3D-takeout-missing').evidence, /650%/)
  assert.ok(!ids(result).includes('M3D-dscr-under-minimum'))
})

// ---- 4. Team completeness ----

test('team: a full team passes; the developer can come from the firm record', () => {
  assert.equal(row(project('development', fullTeam), 'team').status, 'pass')
  const noDev = project('development', (d) => { fullTeam(d); d.team.lines.devPartner1.firmName = null })
  assert.equal(row(noDev, 'team', { firm }).status, 'pass')
  assert.equal(flagOf(run(noDev), 'M3D-team-incomplete').severity, 'medium')
})

test('team: a missing general contractor is a medium flag; a blank team is a low missing-data flag', () => {
  const noGc = run(project('development', (d) => { fullTeam(d); d.team.lines.generalContractor.firmName = null }))
  const f = flagOf(noGc, 'M3D-team-incomplete')
  assert.match(f.evidence, /Not named: general contractor/)
  assert.match(f.follow_up, /what similar projects/)
  const blank = run(project(), { firm })
  assert.equal(flagOf(blank, 'M3D-team-missing').severity, 'low')
})

test('team: property manager and guarantor have no line on the form, so they are asked about, not failed', () => {
  const p = project('development', (d) => { fullTeam(d); d.team.lines.other1.firmName = null; d.team.lines.other2.firmName = null })
  const r = row(p, 'team')
  assert.equal(r.status, 'not_checked')
  assert.equal(r.flags[0].id, 'M3D-team-roles-missing')
  assert.equal(r.flags[0].severity, 'low')
})

// ---- Stages ----

test('lease-up runs only the still-projected parts, and says so', () => {
  const p = project('lease_up', (d) => (d.budget.lines.constructionContingency.amount = 10000), '2027-09-01')
  const rows = checklist(p)
  assert.deepEqual(rows.map((r) => r.status === 'not_applicable'), [true, false, false, true])
  const result = run(p)
  assertValid(result)
  assert.ok(!ids(result).includes('M3D-contingency-low'), 'the budget is not re-checked once built')
  assert.ok(!ids(result).some((id) => id.startsWith('M3D-team')))
  assert.match(result.notes[0], /lease_up.*still projected/)
  for (const f of result.flags) assert.equal(f.stage_used, 'development')
  // The start date no longer matters, and the reserve check uses the months left until stabilization.
  const later = project('lease_up', (d) => (d.timeline.constructionStart = null), '2027-09-01')
  assert.ok(!ids(run(later)).includes('M3D-schedule-missing'))
  assert.match(row(later, 'capital').items.find((i) => i.label === 'Interest reserve').text, /6 months left until stabilization/)
  const late = run(project('lease_up', () => {}, '2028-08-01'))
  assert.equal(flagOf(late, 'M3D-stabilization-passed').transition, 'T2')
  const thin = run(project('lease_up', (d) => { d.budget.lines.rentUpReserve.amount = 0; d.budget.lines.operatingReserve.amount = 0 }, '2027-09-01'))
  assert.equal(flagOf(thin, 'M3D-interest-reserve-none').transition, 'T2')
})

test('completed projects are not checked, and a project with no stage gets a missing-data flag', () => {
  const done = run(project('completed'))
  assert.deepEqual(done.flags, [])
  assert.match(done.notes[0], /completed/)
  assert.ok(checklist(project('completed')).every((r) => r.status === 'not_applicable'))
  const bare = run(healthyProject())
  assert.deepEqual(ids(bare), ['M3D-stage-missing'])
  assert.ok(checklist(healthyProject()).every((r) => r.status === 'not_checked'))
})

// ---- Bad input never crashes ----

test('bad input becomes flags, never a crash', () => {
  for (const bad of [null, undefined, 42, 'project', {}, { data: null }, { data: { stage: { stage: 'development' } } }]) {
    const result = run(bad, {})
    assert.ok(Array.isArray(result.flags))
    for (const f of result.flags) assert.deepEqual(validateFlag(f), [])
  }
  // A record with a broken group: that one check fails visibly, the others still run.
  const broken = project()
  broken.data.timeline = null
  broken.data.sources = { rows: [null, { amount: 'lots' }] }
  const result = run(broken, { settings: 'nonsense', benchmarks: 7, firm: [] })
  for (const f of result.flags) assert.deepEqual(validateFlag(f), [], f.id)
  assert.ok(!ids(result).includes('M3D-check-failed'), result.notes.join(' | '))
  assert.equal(checklist(broken).length, 4)
})
