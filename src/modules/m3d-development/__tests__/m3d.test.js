import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { healthyProject } from '../../shared/samples/baseline.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { applyStageAndDate, compareSeverity, validateFlag, blankProject } from '../../shared/index.js'
import { run, checklist } from '../index.js'
import { readPeriod } from '../checks.js'

async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  return applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
}

// A project built in code, with the stage chosen and a complete team and construction interest so the healthy case is quiet.
const project = (stage = 'development', edit = () => {}) => {
  const p = applyStageAndDate(healthyProject(), { stage, asOfDate: '2026-01-15' })
  p.data.team.lines.generalContractor = { firmName: 'Sample Builders', principal: 'Gale Contractor', ownershipPct: null }
  p.data.team.lines.architect = { firmName: 'Example Architects', principal: 'Ann Architect', ownershipPct: null }
  p.data.team.lines.devPartner1 = { firmName: 'Maple Ridge Partners', principal: 'Pat Sample', ownershipPct: 1 }
  p.data.budget.lines.constructionInterest.amount = 150000
  edit(p.data)
  return p
}
const ids = (p, context = {}) => run(p, context).flags.map((f) => f.id)
const flagOf = (p, id, context = {}) => run(p, context).flags.find((f) => f.id === id)

for (const s of scenarios) {
  test(`${s.id}: M3D matches the answer key`, async () => {
    const record = await load(s)
    const { flags, notes } = run(record, {})
    assert.ok(!flags.some((f) => f.id === 'M3D-check-failed'), notes.join(' | '))
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const want of s.key.flags.filter((k) => k.module === 'M3D')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, want.id)
      else {
        assert.ok(got, `should raise ${want.id}; got ${flags.map((f) => f.id).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants ${want.severity}`)
      }
    }
    // A project the key calls healthy gets nothing above low.
    if (s.id === 's01-healthy-development') assert.deepEqual(flags.filter((f) => f.severity !== 'low'), [])
  })
}

test('a complete healthy project raises no flags at all', () => {
  assert.deepEqual(run(project(), {}).flags, [])
})

test('completed projects are left to M3C: no flags, and a note says why', () => {
  const out = run(project('completed'), {})
  assert.deepEqual(out.flags, [])
  assert.match(out.notes[0], /M3C/)
  assert.deepEqual(checklist(project('completed'), {}), [])
})

test('no stage chosen: one low flag, no crash', () => {
  const out = run(blankProject(), {})
  assert.equal(out.flags.length, 1)
  assert.equal(out.flags[0].severity, 'low')
})

test('an empty development project reports what is missing and never crashes', () => {
  const p = applyStageAndDate(blankProject(), { stage: 'development', asOfDate: '2026-01-15' })
  const out = run(p, {})
  assert.ok(!out.flags.some((f) => f.id === 'M3D-check-failed'))
  assert.ok(out.flags.length > 0 && out.flags.every((f) => f.severity === 'low'))
})

test('lease-up projects run the checks and say stage_used: development', () => {
  const p = project('lease_up', (d) => (d.budget.lines.constructionContingency.amount = 40000))
  const f = flagOf(p, 'M3D-contingency-low')
  assert.ok(f)
  assert.equal(f.stage_used, 'development')
})

test('contingency: medium just under the benchmark, high under half of it', () => {
  // hard cost before contingency is 3,500,000; the benchmark low is 5%
  const medium = flagOf(project('development', (d) => (d.budget.lines.constructionContingency.amount = 150000)), 'M3D-contingency-low')
  assert.equal(medium.severity, 'medium')
  const high = flagOf(project('development', (d) => (d.budget.lines.constructionContingency.amount = 40000)), 'M3D-contingency-low')
  assert.equal(high.severity, 'high')
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.constructionContingency.amount = 175000)), 'M3D-contingency-low'), undefined)
  assert.match(high.evidence, /1\.1%/)
})

test('contingency left blank is "could not be checked", never guessed as zero', () => {
  const p = project('development', (d) => (d.budget.lines.constructionContingency.amount = null))
  assert.ok(ids(p).includes('M3D-contingency-missing'))
  assert.ok(!ids(p).includes('M3D-contingency-low'))
})

test('soft costs: far outside the usual range is medium, a little outside is low', () => {
  const tiny = flagOf(project('development', (d) => { for (const k of ['architectureEngineering', 'softCostContingency', 'rentUpReserve', 'operatingReserve', 'constructionInterest']) d.budget.lines[k].amount = null; d.budget.lines.legalAccounting.amount = 10000 }), 'M3D-soft-cost-ratio')
  assert.equal(tiny.severity, 'medium')
  const slightly = flagOf(project('development', (d) => { d.budget.lines.rentUpReserve.amount = null; d.budget.lines.operatingReserve.amount = null; d.budget.lines.softCostContingency.amount = null; d.budget.lines.constructionInterest.amount = null; d.budget.lines.architectureEngineering.amount = 300000 }), 'M3D-soft-cost-ratio')
  assert.equal(slightly.severity, 'low')
})

test('schedule: dates out of order are high; year-only dates are compared by year', () => {
  const backwards = project('development', (d) => Object.assign(d.timeline, { constructionStart: '2027-06', constructionCompletion: '2026-03' }))
  assert.equal(flagOf(backwards, 'M3D-schedule-order').severity, 'high')
  const yearsOk = project('development', (d) => Object.assign(d.timeline, { constructionStart: '2026', constructionCompletion: '2027', stabilization: '2028' }))
  assert.ok(!ids(yearsOk).includes('M3D-schedule-order'))
  const yearsBad = project('development', (d) => Object.assign(d.timeline, { constructionStart: '2028', constructionCompletion: '2027', stabilization: '2029' }))
  assert.ok(ids(yearsBad).includes('M3D-schedule-order'))
})

test('schedule: unusual construction and lease-up lengths are medium', () => {
  const fast = project('development', (d) => Object.assign(d.timeline, { constructionStart: '2026-03', constructionCompletion: '2026-06', stabilization: '2027-03' }))
  assert.equal(flagOf(fast, 'M3D-construction-length').severity, 'medium')
  const slowFill = project('development', (d) => Object.assign(d.timeline, { stabilization: '2030-06' }))
  assert.equal(flagOf(slowFill, 'M3D-leaseup-length').severity, 'medium')
  const instant = project('development', (d) => Object.assign(d.timeline, { stabilization: '2027-07' }))
  assert.ok(ids(instant).includes('M3D-leaseup-length'))
})

test('schedule: a development project past its completion date is flagged, and it is a T1 flag', () => {
  const late = project('development', (d) => Object.assign(d.timeline, { constructionStart: '2025-01', constructionCompletion: '2025-12', stabilization: '2026-09' }))
  const f = flagOf(late, 'M3D-completion-slipped')
  assert.equal(f.severity, 'medium') // 1 month late (as of 2026-01-15)
  assert.equal(f.transition, 'T1')
  const veryLate = project('development', (d) => Object.assign(d.timeline, { constructionStart: '2024-01', constructionCompletion: '2024-12', stabilization: '2025-09' }))
  assert.equal(flagOf(veryLate, 'M3D-completion-slipped').severity, 'high')
})

test('schedule: missing dates give a low "could not be checked" flag', () => {
  const p = project('development', (d) => Object.assign(d.timeline, { stabilization: null }))
  const f = flagOf(p, 'M3D-schedule-order-missing')
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /stabilization/)
})

test('capital stack: DSCR under the minimum is high, and the minimum comes from the settings', () => {
  const p = project('development', (d) => Object.assign(d.sources.rows[0], { amount: 5550000, interestRate: 0.09 }))
  assert.equal(flagOf(p, 'M3D-dscr-under-minimum').severity, 'high')
  assert.equal(flagOf(project(), 'M3D-dscr-under-minimum', { settings: { minDscr: 3 } }).severity, 'high') // 2.71 vs 3.00
  assert.equal(flagOf(project(), 'M3D-dscr-under-minimum'), undefined)
})

test('capital stack: debt-to-cost and debt yield', () => {
  const heavy = project('development', (d) => Object.assign(d.sources.rows[0], { amount: 4500000 })) // 4.5M of 5.55M = 81%
  assert.equal(flagOf(heavy, 'M3D-debt-to-cost-high').severity, 'medium')
  const weak = project('development', (d) => (d.residentialIncome.rows[0].monthlyRent = 500)) // low income against 3M of debt
  assert.ok(ids(weak).includes('M3D-debt-yield-low'))
  assert.equal(flagOf(weak, 'M3D-debt-yield-low').transition, 'T3')
})

test('capital stack: lien priority problems', () => {
  const dup = project('development', (d) => (d.sources.rows[1].lienPriority = 1))
  assert.equal(flagOf(dup, 'M3D-lien-priority').severity, 'low')
  const blank = project('development', (d) => (d.sources.rows[2].lienPriority = null))
  assert.ok(ids(blank).includes('M3D-lien-priority'))
  const mezz = project('development', (d) => {
    d.sources.rows.push({ lienPriority: 0, name: 'Mezz Fund', type: 'mezzanine_debt', amount: 100000, termMonths: 120, interestRate: 0.1, paymentOverride: null })
    d.budget.lines.landscaping.amount = 100000
  })
  assert.equal(flagOf(mezz, 'M3D-lien-priority').severity, 'medium')
})

test('capital stack: interest reserve short is medium, far short is high, a T1 flag', () => {
  // estimate: 3,000,000 x 6% x 55% x 15/12 = 123,750
  assert.equal(ids(project('development', (d) => (d.budget.lines.constructionInterest.amount = 123750))).includes('M3D-interest-reserve-short'), false)
  const medium = flagOf(project('development', (d) => (d.budget.lines.constructionInterest.amount = 80000)), 'M3D-interest-reserve-short')
  assert.equal(medium.severity, 'medium')
  assert.equal(medium.transition, 'T1')
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.constructionInterest.amount = 40000)), 'M3D-interest-reserve-short').severity, 'high')
})

test('team: names the missing roles, low severity', () => {
  const p = project('development', (d) => (d.team.lines.architect = { firmName: null, principal: null, ownershipPct: null }))
  const f = flagOf(p, 'M3D-team-incomplete')
  assert.equal(f.severity, 'low')
  assert.match(f.evidence, /architect/)
  assert.doesNotMatch(f.evidence, /general contractor/)
})

test('every flag cites cells, asks a question, and stays inside the flag rules', () => {
  const p = project('development', (d) => {
    d.budget.lines.constructionContingency.amount = 10000
    Object.assign(d.sources.rows[0], { amount: 5550000, interestRate: 0.09 })
    Object.assign(d.timeline, { constructionStart: '2024-01', constructionCompletion: '2024-12', stabilization: '2025-09' })
  })
  const { flags } = run(p, {})
  assert.ok(flags.length >= 4)
  for (const f of flags) {
    assert.deepEqual(validateFlag(f), [])
    assert.equal(f.module, 'M3D')
    assert.equal(f.layer, 3)
    assert.ok(f.follow_up.length > 0)
    assert.ok(f.cell_refs.length > 0, `${f.id} has no cell references`)
  }
})

test('the checklist shows every check, and a project is never changed', () => {
  const p = project()
  const before = JSON.stringify(p)
  const rows = checklist(p, {})
  assert.ok(rows.length >= 11)
  assert.ok(rows.every((r) => ['pass', 'fail', 'not_checked', 'not_applicable'].includes(r.status)))
  assert.equal(JSON.stringify(p), before)
})

test('readPeriod reads a year, a year and month, and a date; rejects the rest', () => {
  assert.deepEqual(readPeriod('2026-03'), { year: 2026, month: 2026 * 12 + 2, precise: true })
  assert.equal(readPeriod('2026').precise, false)
  assert.equal(readPeriod('2026-03-15').precise, true)
  for (const bad of [null, '', 'soon', '2026-13', 20260301]) assert.equal(readPeriod(bad), null)
})

test('the cutoffs list on screen is built from the same numbers the checks use', async () => {
  const { THRESHOLDS, cutoffRows } = await import('../thresholds.js')
  const rows = cutoffRows(THRESHOLDS, { minDscr: 1.2, contingencyLow: 0.05, contingencyHigh: 0.1 })
  const text = JSON.stringify(rows)
  assert.match(text, /under 2\.5%/) // contingency high: half of 5%
  assert.match(text, /over 85%/) // debt to cost high
  assert.match(text, /under 7%/) // debt yield high
  assert.match(text, /1\.20×/)
  const changed = cutoffRows({ ...THRESHOLDS, debtToCost: { medium: 0.6, high: 0.7 } }, {})
  assert.match(JSON.stringify(changed), /over 70%/)
})

test('contingency above the program cap is medium; between the benchmark and the cap is not flagged', () => {
  // hard cost before contingency is 3,500,000: 15% is 525,000
  const over = flagOf(project('development', (d) => (d.budget.lines.constructionContingency.amount = 600000)), 'M3D-contingency-high')
  assert.equal(over.severity, 'medium')
  assert.match(over.evidence, /17\.1%/)
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.constructionContingency.amount = 450000)), 'M3D-contingency-high'), undefined) // 12.9%
  assert.ok(!ids(project('development', (d) => (d.budget.lines.constructionContingency.amount = 600000))).includes('M3D-contingency-low'))
})

test('permits line: low above 2% of hard cost, medium above 4%', () => {
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.permitsBonds.amount = 83209)), 'M3D-permits-high').severity, 'low') // 2.4%
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.permitsBonds.amount = 200000)), 'M3D-permits-high').severity, 'medium')
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.permitsBonds.amount = 50000)), 'M3D-permits-high'), undefined)
  assert.equal(flagOf(project(), 'M3D-permits-high'), undefined) // no permits line entered: nothing to say
})

test('developer fees: low above 10% of total cost, medium above 15%', () => {
  // total cost in the sample is about 5.55M (about 5.69M with the test interest line)
  const low = flagOf(project('development', (d) => (d.budget.lines.developerFee.amount = 700000)), 'M3D-developer-fees-high')
  assert.equal(low.severity, 'low')
  assert.equal(flagOf(project('development', (d) => { d.budget.lines.developerFee.amount = 600000; d.budget.lines.consultingFees.amount = 600000 }), 'M3D-developer-fees-high').severity, 'medium')
  assert.equal(flagOf(project('development', (d) => (d.budget.lines.developerFee.amount = 180000)), 'M3D-developer-fees-high'), undefined)
})

test('a DSCR that only just clears the minimum is a medium "thin cushion" flag', () => {
  // 1.20 minimum with a 0.10 margin: 1.20 up to 1.29 is thin. Raise the minimum so the 2.71 sample lands in that band.
  const thin = flagOf(project(), 'M3D-dscr-thin', { settings: { minDscr: 2.65 } })
  assert.equal(thin.severity, 'medium')
  assert.equal(thin.transition, 'T3')
  assert.equal(flagOf(project(), 'M3D-dscr-thin'), undefined) // 2.71 vs 1.20: comfortable
  assert.equal(flagOf(project(), 'M3D-dscr-thin', { settings: { minDscr: 3 } }), undefined) // below the minimum is the other flag
  assert.ok(ids(project(), { settings: { minDscr: 3 } }).includes('M3D-dscr-under-minimum'))
})
