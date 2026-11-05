import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../index.js'
import { blankProject } from '../records.js'
import { roundNumberProject, t12Month, rng } from './helpers.js'

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`)
const byId = (list) => Object.fromEntries(list.map((r) => [r.id, r]))
const clone = (p) => structuredClone(p)
const edit = (stage, fn) => {
  const p = roundNumberProject(stage)
  fn(p)
  return p
}
const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v))
  return Object.freeze(o)
}

const ADS = 12 * 30 * 599.5505 // 30 x the textbook figure for a $100,000 loan at 6% over 30 years, x 12 months
const NOI = 684000 + 90000 + 12000 - 200000 // 586,000

// ---------------------------------------------------------------- the loan formula
test('loan payment: the textbook figure, zero rate, and refusal of nonsense', () => {
  close(M.monthlyPayment(100000, 0.06, 360), 599.55, 0.01, '$100,000 at 6% over 30 years')
  assert.equal(M.monthlyPayment(120000, 0, 120), 1000)
  for (const args of [[1e5, 0.06, 0], [1e5, -0.01, 360], [1e5, 6.5, 360], [1e5, 0.06, 0.5], [NaN, 0.06, 360], [1e5, 0.06, Infinity], [-5, 0.06, 360], [1e5, 0.06, 5000]]) {
    assert.equal(M.monthlyPayment(...args), null, `refuses ${args}`)
  }
})

test('loan payment: a tiny rate stays finite instead of dividing by zero', () => {
  const p = M.monthlyPayment(1000000, 1e-17, 360)
  assert.ok(Number.isFinite(p))
  close(p, 1000000 / 360, 1, 'tiny rate is close to the zero-rate answer')
})

// ---------------------------------------------------------------- base calculators and development ratios
test('base calculators match hand arithmetic', () => {
  const p = roundNumberProject()
  assert.equal(M.totalSources(p).value, 5550000)
  assert.equal(M.totalUses(p).value, 5550000)
  assert.equal(M.totalDebt(p).value, 3000000)
  close(M.annualDebtService(p).value, ADS, 5, 'annual debt service')
  assert.equal(M.noi(p).value, NOI)
  close(M.dscr(p).value, NOI / ADS, 0.001, 'DSCR')
})

test('development ratios match hand arithmetic', () => {
  const list = M.keyRatios(roundNumberProject())
  const r = byId(list)
  assert.equal(list.length, 8)
  close(r.noiCushion.value, (NOI - 1.2 * ADS) / NOI, 1e-4, 'cushion')
  close(r.breakEven.value, (200000 + ADS) / 832000, 1e-4, 'break-even')
  close(r.debtYield.value, NOI / 3000000, 1e-9, 'debt yield')
  close(r.debtToCost.value, 3000000 / 5550000, 1e-9, 'debt-to-cost')
  close(r.equityShare.value, 2000000 / 5550000, 1e-9, 'equity share')
  close(r.yieldOnCost.value, NOI / 5550000, 1e-9, 'yield on cost')
  close(r.contingency.value, 400000 / 3500000, 1e-9, 'contingency on hard costs before contingency')
  assert.equal(r.dscr.status, 'ok')
})

test('the stage decides how many ratios show', () => {
  assert.deepEqual(M.keyRatios(blankProject()), [])
  assert.equal(M.keyRatios(roundNumberProject('development')).length, 8)
  assert.equal(M.keyRatios(roundNumberProject('lease_up')).length, 7)
  assert.equal(M.keyRatios(roundNumberProject('completed')).length, 6)
})

test('calculators never change the record they read', () => {
  const p = deepFreeze(roundNumberProject('lease_up'))
  assert.doesNotThrow(() => M.keyRatios(p))
})

// ---------------------------------------------------------------- typed payments are yearly, as in the applicant workbook
test('a typed payment is a YEARLY amount and replaces the calculated payment', () => {
  const p = edit('development', (x) => (x.data.sources.rows[0].paymentOverride = 20000))
  assert.equal(M.annualDebtService(p).value, 20000)
  assert.match(M.annualDebtService(p).notes.join(' '), /typed yearly payment for "Bank"/)
})

test('a typed payment works for a loan with no rate or term', () => {
  const p = edit('development', (x) => Object.assign(x.data.sources.rows[0], { paymentOverride: 20000, interestRate: null, termMonths: null }))
  assert.equal(M.annualDebtService(p).value, 20000)
})

test('payments on a source that is not typed as debt are counted and announced', () => {
  const p = edit('development', (x) => Object.assign(x.data.sources.rows[1], { termMonths: 120, interestRate: 0.05 }))
  const d = M.annualDebtService(p)
  assert.equal(d.payments, 2)
  assert.match(d.notes.join(' '), /"Sponsor".*not typed as debt/)
  assert.match(M.keyRatios(p)[0].detail.join(' '), /not typed as debt/)
  assert.deepEqual(M.annualDebtService(roundNumberProject()).notes, [])
})

test('a grant typed with a term of 0 months and a rate of 0 has no payment, and is not an error', () => {
  const p = edit('development', (x) => x.data.sources.rows.push({ name: 'Grant', type: 'nonrecoverable_grant', amount: 240000, termMonths: 0, interestRate: 0, paymentOverride: null }))
  close(M.annualDebtService(p).value, ADS, 5, 'the grant adds nothing to debt service')
  assert.equal(M.totalSources(p).value, 5550000 + 240000)
  assert.equal(M.annualDebtService(edit('development', (x) => (x.data.sources.rows[0].termMonths = 0))).ok, false, 'but a LOAN with a term of 0 is still missing its term')
})

// ---------------------------------------------------------------- missing data: a reason and what to fill in, never a guess
test('a blank project explains every missing ratio', () => {
  const blank = blankProject()
  blank.data.stage.stage = 'development'
  for (const r of M.keyRatios(blank)) {
    assert.equal(r.ok, false, r.id)
    assert.ok(r.reason.length > 5, r.id)
  }
})

for (const [name, mutate, calc, pattern, group] of [
  ['residential vacancy missing', (p) => (p.data.residentialIncome.stabilizedVacancy = null), 'noi', /Residential vacancy is not entered/, 'residentialIncome'],
  ['commercial vacancy missing', (p) => (p.data.commercialIncome.stabilizedVacancy = null), 'noi', /Commercial vacancy is not entered/, 'commercialIncome'],
  ['no expenses', (p) => { Object.values(p.data.operatingExpenses.lines).forEach((l) => (l.amount = null)); p.data.otherExpenses.rows = [] }, 'noi', /No operating expenses/, 'operatingExpenses'],
  ['no income', (p) => { p.data.residentialIncome.rows = []; p.data.commercialIncome.rows = []; p.data.otherIncome.rows = [] }, 'noi', /No income entered/, null],
  ['loan without a rate', (p) => (p.data.sources.rows[0].interestRate = null), 'annualDebtService', /"Bank" has no interest rate/, 'sources'],
  ['loan without a term', (p) => (p.data.sources.rows[0].termMonths = null), 'annualDebtService', /"Bank" has no term/, 'sources'],
  ['no loan at all', (p) => (p.data.sources.rows = [p.data.sources.rows[1]]), 'dscr', /no loan payments to cover/, 'sources'],
  ['no debt typed', (p) => (p.data.sources.rows = p.data.sources.rows.slice(1)), 'totalDebt', /No debt entered/, 'sources'],
  ['no budget', (p) => Object.values(p.data.budget.lines).forEach((l) => (l.amount = null)), 'totalUses', /No development budget/, 'budget'],
]) {
  test(`missing data: ${name}`, () => {
    const res = M[calc](edit('development', mutate))
    assert.equal(res.ok, false)
    assert.match(res.reason, pattern)
    if (group) assert.ok(res.needs.some((n) => n.group === group), `needs ${group}`)
  })
}

test('income rows missing units or rent are skipped and said so', () => {
  const p = edit('development', (x) => x.data.residentialIncome.rows.push({ unitType: '2-bdr', units: 5, monthlyRent: null }))
  const n = M.noi(p)
  assert.equal(n.value, NOI)
  assert.match(n.notes[0], /1 residential row is missing/)
})

// ---------------------------------------------------------------- implausible inputs: "not available" with a reason, never a confident wrong number
const IMPLAUSIBLE = [
  ['a vacancy typed as 8 (meaning 8%)', (p) => (p.data.residentialIncome.stabilizedVacancy = 8), 'noi', /vacancy.*\b8\b/i],
  ['a vacancy typed as -5%', (p) => (p.data.residentialIncome.stabilizedVacancy = -0.05), 'noi', /vacancy/i],
  ['an interest rate typed as 6.5 (meaning 6.5%)', (p) => (p.data.sources.rows[0].interestRate = 6.5), 'annualDebtService', /interest rate.*6\.5/i],
  ['a negative interest rate', (p) => (p.data.sources.rows[0].interestRate = -0.01), 'annualDebtService', /interest rate/i],
  ['a negative loan amount', (p) => (p.data.sources.rows[0].amount = -3000000), 'annualDebtService', /amount/i],
  ['a negative loan amount (total sources)', (p) => (p.data.sources.rows[0].amount = -3000000), 'totalSources', /amount/i],
  ['a negative loan amount (total debt)', (p) => (p.data.sources.rows[0].amount = -3000000), 'totalDebt', /amount/i],
  ['a half-month term', (p) => (p.data.sources.rows[0].termMonths = 0.5), 'annualDebtService', /term/i],
  ['a 5,000-month term', (p) => (p.data.sources.rows[0].termMonths = 5000), 'annualDebtService', /term/i],
  ['negative units', (p) => (p.data.residentialIncome.rows[0].units = -40), 'noi', /units/i],
  ['a negative rent', (p) => (p.data.residentialIncome.rows[0].monthlyRent = -1500), 'noi', /rent/i],
  ['a negative expense', (p) => (p.data.operatingExpenses.lines.propertyTaxes.amount = -120000), 'noi', /expense|tax/i],
  ['a rent of $1e15', (p) => (p.data.residentialIncome.rows[0].monthlyRent = 1e15), 'noi', /rent/i],
  ['a negative budget line', (p) => (p.data.budget.lines.land.amount = -1000000), 'totalUses', /land|budget/i],
  ['a typed payment that is negative', (p) => (p.data.sources.rows[0].paymentOverride = -5), 'annualDebtService', /payment/i],
]
for (const [name, mutate, calc, pattern] of IMPLAUSIBLE) {
  test(`implausible input is refused, not computed: ${name}`, () => {
    const res = M[calc](edit('development', mutate))
    assert.equal(res.ok, false, `got ${JSON.stringify(res).slice(0, 120)}`)
    assert.match(res.reason, pattern)
    assert.match(res.reason, /believable|between|looks like|cannot be/i, 'says why')
  })
}

test('one implausible input makes every ratio built on it unavailable', () => {
  const p = edit('development', (x) => (x.data.residentialIncome.stabilizedVacancy = 8))
  const r = byId(M.keyRatios(p))
  for (const id of ['dscr', 'noiCushion', 'breakEven', 'debtYield', 'yieldOnCost']) assert.equal(r[id].ok, false, id)
  assert.equal(r.debtToCost.ok, true, 'ratios that do not use the bad input still work')
})

test('boundary values that ARE believable are accepted', () => {
  const p = edit('development', (x) => {
    x.data.residentialIncome.stabilizedVacancy = 1 // 100% vacant
    x.data.commercialIncome.stabilizedVacancy = 0
    x.data.sources.rows[0].interestRate = 0
  })
  assert.equal(M.noi(p).ok, true)
  assert.equal(M.annualDebtService(p).ok, true)
})

// ---------------------------------------------------------------- zero denominators never print Infinity or NaN
test('zero denominators give "not available"', () => {
  const noRent = byId(M.keyRatios(edit('development', (p) => (p.data.residentialIncome.rows[0].monthlyRent = 0))))
  assert.equal(noRent.dscr.ok, true, 'DSCR itself is still a number')
  assert.equal(noRent.breakEven.ok, true) // commercial and other income remain, so income at full occupancy is not zero
  const none = edit('development', (p) => { p.data.residentialIncome.rows[0].monthlyRent = 0; p.data.commercialIncome.rows = []; p.data.otherIncome.rows = [] })
  assert.equal(byId(M.keyRatios(none)).breakEven.ok, false)
  const zeroBudget = edit('development', (p) => { Object.values(p.data.budget.lines).forEach((l) => (l.amount = null)); p.data.budget.lines.land.amount = 0 })
  const z = byId(M.keyRatios(zeroBudget))
  for (const id of ['debtToCost', 'equityShare', 'yieldOnCost']) assert.equal(z[id].ok, false, id)
  assert.equal(M.totalUses(zeroBudget).ok, false)
})

test('NOI of exactly zero or less: ratios that need a positive NOI say so', () => {
  const zero = edit('completed', (p) => (p.data.operatingExpenses.lines.propertyTaxes.amount = 706000)) // 786,000 income less 80,000 of other expenses
  assert.equal(M.noi(zero).value, 0)
  const r = byId(M.keyRatios(zero))
  assert.equal(r.dscr.value, 0)
  assert.equal(r.noiCushion.ok, false)
  zero.data.t12.rows = [t12Month('2026-06-30')]
  assert.equal(byId(M.keyRatios(zero)).trailing.ok, false, 'cannot compare to an underwritten NOI of zero')
})

// ---------------------------------------------------------------- T-12 and the stability streak
const completed = (months, over = {}) => edit('completed', (p) => (p.data.t12.rows = months.map((m) => t12Month(m, over))))
const streakOf = (p, settings) => byId(M.keyRatios(p, settings)).trailing.streak

test('six strong months in a row', () => {
  const p = completed(['2026-06-30', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']) // typed out of order
  const t = byId(M.keyRatios(p))
  assert.equal(t.trailing.streak, 6)
  assert.equal(t.trailing.status, 'ok')
  close(t.collectedRent.value, 65333 / 69333, 1e-9, 'collected vs potential')
  close(t.trailing.value, (50500 * 12) / NOI, 1e-9, 'T-12 vs underwritten')
  assert.match(t.dscr.detail.join(' '), /T-12 actual/)
})

test('a weak month breaks the streak; the settings change the verdict', () => {
  const p = completed(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
  p.data.t12.rows[3] = t12Month('2026-04-30', { concessions: 30000 })
  assert.equal(streakOf(p), 2)
  assert.equal(byId(M.keyRatios(p)).trailing.status, 'watch')
  assert.equal(byId(M.keyRatios(p, { ...M.DEFAULT_SETTINGS, consecutiveMonths: 2 })).trailing.status, 'ok')
  assert.equal(streakOf(p, { ...M.DEFAULT_SETTINGS, minDscr: 3 }), 0)
})

test('MISSING months break the streak (every other month is a streak of 1, not 3)', () => {
  assert.equal(streakOf(completed(['2026-02-28', '2026-04-30', '2026-06-30'])), 1)
  assert.equal(streakOf(completed(['2026-01-31', '2026-02-28', '2026-11-30', '2026-12-31'])), 2)
  assert.match(byId(M.keyRatios(completed(['2026-02-28', '2026-04-30', '2026-06-30']))).trailing.detail.join(' '), /no data for 2026-05/i)
})

test('a month entered twice counts once, and is reported', () => {
  const p = completed(['2026-06-30', '2026-06-30', '2026-06-30'])
  assert.equal(streakOf(p), 1)
  assert.match(byId(M.keyRatios(p)).trailing.detail.join(' '), /appear more than once/)
})

test('the same month written two ways counts once', () => {
  assert.equal(streakOf(completed(['2026-06', '2026-06-30'])), 1)
})

test('a row whose month is not a month is left out and reported', () => {
  const p = completed(['2026-05-31', 'next tuesday', '2026-06-30'])
  assert.equal(streakOf(p), 2)
  assert.match(byId(M.keyRatios(p)).trailing.detail.join(' '), /no month/)
})

test('low latest occupancy turns a passing streak into "watch"', () => {
  const p = completed(['2026-01-31', '2026-02-28', '2026-03-31'], { occupancy: 0.85 })
  const t = byId(M.keyRatios(p)).trailing
  assert.equal(t.streak, 3)
  assert.equal(t.status, 'watch')
  assert.match(t.detail.join(' '), /below the floor/)
})

test('fewer months than needed is said plainly', () => {
  assert.match(byId(M.keyRatios(completed(['2026-05-31', '2026-06-30']))).trailing.detail.join(' '), /Only 2 months of data/)
})

test('vacancy and concessions entered as negatives give the same answer', () => {
  const p = completed(['2026-06-30'], { vacancyLoss: -3000, concessions: -1000 })
  close(byId(M.keyRatios(p)).collectedRent.value, 65333 / 69333, 1e-9, 'sign-proof')
})

test('T-12 problems: none entered, no months, implausible occupancy', () => {
  assert.match(byId(M.keyRatios(roundNumberProject('completed'))).trailing.reason, /No T-12 months entered/)
  assert.match(byId(M.keyRatios(completed([null]))).collectedRent.reason, /no month entered/)
  const bad = byId(M.keyRatios(completed(['2026-06-30'], { occupancy: 95 })))
  assert.equal(bad.trailing.ok, false)
  assert.match(bad.trailing.reason, /occupancy/i)
})

test('reported NOI is used when the lines are missing', () => {
  const p = edit('completed', (x) => (x.data.t12.rows = [{ month: '2026-06-30', noiReported: 50000, debtService: 17000 }]))
  assert.equal(byId(M.keyRatios(p)).trailing.ok, true)
})

test('lease-up runway: months of reserves at the recent shortfall', () => {
  const months = ['2026-04-30', '2026-05-31', '2026-06-30']
  const p = edit('lease_up', (x) => (x.data.t12.rows = months.map((m) => t12Month(m, { residentialRevenue: 22000, commercialRevenue: 0, otherRevenue: 0, vacancyLoss: 1000, concessions: 1000 }))))
  const shortfall = 14833 + ADS / 12 - 20000
  const rw = byId(M.keyRatios(p)).runway
  close(rw.value, 300000 / shortfall, 0.01, 'runway')
  assert.equal(M.keyRatios(p).length, 7)
})

test('lease-up runway: not burning cash, no reserves, gaps in the months', () => {
  const flush = edit('lease_up', (x) => (x.data.t12.rows = [t12Month('2026-06-30')]))
  assert.equal(byId(M.keyRatios(flush)).runway.value, 'Not burning cash')
  const noReserve = edit('lease_up', (x) => { x.data.budget.lines.rentUpReserve.amount = null; x.data.budget.lines.operatingReserve.amount = null; x.data.t12.rows = [t12Month('2026-06-30')] })
  assert.match(byId(M.keyRatios(noReserve)).runway.reason, /No rent-up or operating reserve/)
  // A gap: only the months after the gap count as "recent".
  const gap = edit('lease_up', (x) => (x.data.t12.rows = ['2026-01-31', '2026-02-28', '2026-05-31', '2026-06-30'].map((m) => t12Month(m, { residentialRevenue: 22000, commercialRevenue: 0, otherRevenue: 0, vacancyLoss: 1000, concessions: 1000 }))))
  assert.match(byId(M.keyRatios(gap)).runway.detail.join(' '), /last 2/)
})

// ---------------------------------------------------------------- random testing
const NASTY = [null, null, 0, 0, -1, -1500, 1, 0.5, 0.065, 6.5, 8, 100, 1e-17, 1e9, 1e15, 1e300, NaN, Infinity, '12', 'abc', '', true, {}, []]
function randomProject(r) {
  const money = () => (r.next() < 0.55 ? Math.round(r.next() * 5e6) : r.pick(NASTY))
  const pct = () => (r.next() < 0.55 ? Math.round(r.next() * 1000) / 10000 : r.pick(NASTY))
  const when = () => r.pick(['2026-01-31', '2026-02-28', '2026-03-31', '2026-06-30', '2026-06', '2025-12-31', null, 'junk', 5])
  const p = blankProject()
  p.data.stage.stage = r.pick(['development', 'lease_up', 'completed'])
  p.data.sources.rows = Array.from({ length: Math.floor(r.next() * 5) }, () => ({
    name: r.next() < 0.5 ? 'L' : null, type: r.pick(['hard_debt', 'gov_debt', 'mezzanine_debt', 'developer_equity', 'other', null, 'banana', 7]),
    amount: money(), termMonths: r.next() < 0.5 ? 360 : r.pick([...NASTY, 12, 120, 1.5]), interestRate: pct(), paymentOverride: r.next() < 0.2 ? money() : null,
  }))
  for (const k of Object.keys(p.data.budget.lines)) if (r.next() < 0.15) p.data.budget.lines[k].amount = money()
  p.data.residentialIncome.rows = Array.from({ length: Math.floor(r.next() * 4) }, () => ({ units: money(), monthlyRent: money() }))
  p.data.residentialIncome.stabilizedVacancy = pct()
  p.data.commercialIncome.rows = Array.from({ length: Math.floor(r.next() * 3) }, () => ({ sqft: money(), rentPerSqft: money() }))
  p.data.commercialIncome.stabilizedVacancy = pct()
  p.data.otherIncome.rows = Array.from({ length: Math.floor(r.next() * 3) }, () => ({ monthlyIncome: money() }))
  for (const k of Object.keys(p.data.operatingExpenses.lines)) if (r.next() < 0.3) p.data.operatingExpenses.lines[k].amount = money()
  p.data.t12.rows = Array.from({ length: Math.floor(r.next() * 8) }, () => ({
    month: when(), residentialRevenue: money(), commercialRevenue: money(), otherRevenue: money(), vacancyLoss: money(), concessions: money(),
    occupancy: pct(), propertyTaxes: money(), otherExpenses: money(), noiReported: money(), debtService: money(),
  }))
  return p
}

test('random garbage: never crashes, never a non-finite number, every refusal has a reason', () => {
  const r = rng(12345)
  const problems = new Map()
  const note = (key) => problems.set(key, (problems.get(key) ?? 0) + 1)
  for (let i = 0; i < 20000; i++) {
    const p = randomProject(r)
    let list
    try {
      list = M.keyRatios(p)
    } catch (e) {
      note(`THROWS ${e.message.slice(0, 60)}`)
      continue
    }
    for (const x of list) {
      if (x.ok && typeof x.value === 'number' && !Number.isFinite(x.value)) note(`${x.id}: non-finite value`)
      if (!x.ok && (typeof x.reason !== 'string' || !x.reason || !Array.isArray(x.needs))) note(`${x.id}: refusal without a reason`)
      for (const line of x.detail ?? []) if (/NaN|Infinity|undefined|null/.test(line)) note(`${x.id}: detail text shows a bad value`)
    }
    for (const f of [M.totalSources, M.totalUses, M.annualDebtService, M.totalDebt, M.noi, M.dscr]) {
      const res = f(p)
      if (res.ok && !Number.isFinite(res.value)) note(`${f.name}: non-finite value`)
    }
  }
  assert.deepEqual([...problems], [])
})

function wellFormed(r) {
  const p = blankProject()
  p.data.stage.stage = 'completed'
  const loan = (name, type, lo, hi, t0, t1, r0, r1) => ({ name, type, amount: Math.round(r.between(lo, hi)), termMonths: Math.round(r.between(t0, t1)), interestRate: r.between(r0, r1), paymentOverride: null })
  p.data.sources.rows = [loan('A', 'hard_debt', 1e5, 9e6, 60, 480, 0.01, 0.12), loan('B', 'mezzanine_debt', 1e5, 2e6, 24, 240, 0.05, 0.15), { name: 'E', type: 'developer_equity', amount: Math.round(r.between(1e5, 3e6)), termMonths: null, interestRate: null, paymentOverride: null }]
  const L = p.data.budget.lines
  L.land.amount = Math.round(r.between(1e5, 2e6)); L.concreteMasonry.amount = Math.round(r.between(1e6, 8e6)); L.constructionContingency.amount = Math.round(r.between(1e4, 5e5))
  L.architectureEngineering.amount = Math.round(r.between(1e5, 8e5)); L.softCostContingency.amount = Math.round(r.between(1e3, 5e4))
  p.data.residentialIncome.rows = [{ units: Math.round(r.between(10, 200)), monthlyRent: Math.round(r.between(700, 2500)) }, { units: Math.round(r.between(5, 50)), monthlyRent: Math.round(r.between(700, 2500)) }]
  p.data.residentialIncome.stabilizedVacancy = r.between(0.02, 0.15)
  p.data.commercialIncome.rows = [{ sqft: Math.round(r.between(1000, 20000)), rentPerSqft: r.between(8, 40) }]
  p.data.commercialIncome.stabilizedVacancy = r.between(0, 0.2)
  p.data.otherIncome.rows = [{ monthlyIncome: Math.round(r.between(0, 5000)) }]
  p.data.operatingExpenses.lines.propertyTaxes.amount = Math.round(r.between(2e4, 3e5))
  p.data.operatingExpenses.lines.propertyManagement.amount = Math.round(r.between(1e4, 1e5))
  p.data.t12.rows = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((m) => ({ month: m, residentialRevenue: Math.round(r.between(5e4, 3e5)), commercialRevenue: Math.round(r.between(0, 4e4)), vacancyLoss: Math.round(r.between(0, 2e4)), concessions: Math.round(r.between(0, 1e4)), propertyTaxes: Math.round(r.between(5e3, 3e4)), occupancy: r.between(0.7, 1), debtService: null }))
  return p
}
const scaled = (p, k) => {
  const q = clone(p)
  q.data.sources.rows.forEach((x) => { x.amount *= k })
  Object.values(q.data.budget.lines).forEach((l) => { if (l.amount !== null) l.amount *= k })
  q.data.residentialIncome.rows.forEach((x) => { x.monthlyRent *= k })
  q.data.commercialIncome.rows.forEach((x) => { x.rentPerSqft *= k })
  q.data.otherIncome.rows.forEach((x) => { x.monthlyIncome *= k })
  Object.values(q.data.operatingExpenses.lines).forEach((l) => { if (l.amount !== null) l.amount *= k })
  q.data.t12.rows.forEach((x) => { for (const key of ['residentialRevenue', 'commercialRevenue', 'vacancyLoss', 'concessions', 'propertyTaxes']) x[key] *= k })
  return q
}
const values = (p) => Object.fromEntries(M.keyRatios(p).map((x) => [x.id, x.ok ? x.value : null]))

test('maths laws hold for 500 random well-formed projects', () => {
  const r = rng(555)
  for (let i = 0; i < 500; i++) {
    const p = wellFormed(r)
    const base = values(p)
    // 1. a loan paid down month by month with our payment reaches zero
    for (const s of p.data.sources.rows.filter((x) => x.termMonths)) {
      let balance = s.amount
      const pay = M.monthlyPayment(s.amount, s.interestRate, s.termMonths)
      for (let m = 0; m < s.termMonths; m++) balance = balance * (1 + s.interestRate / 12) - pay
      assert.ok(Math.abs(balance) < s.amount * 1e-9, `paid off: ${balance} left on ${s.amount}`)
    }
    // 2. scaling every dollar leaves every ratio unchanged
    const k = r.between(0.3, 9)
    const sv = values(scaled(p, k))
    for (const id of ['dscr', 'noiCushion', 'breakEven', 'debtYield', 'collectedRent', 'trailing']) close(sv[id], base[id], 1e-9 * Math.max(1, Math.abs(base[id])), `scale-invariant ${id}`)
    close(M.noi(scaled(p, k)).value, M.noi(p).value * k, 1e-6 * Math.abs(M.noi(p).value * k), 'NOI scales')
    // 3. the order of rows does not matter
    const shuffled = clone(p)
    for (const rows of [shuffled.data.sources.rows, shuffled.data.t12.rows, shuffled.data.residentialIncome.rows]) rows.sort(() => r.next() - 0.5)
    const sh = values(shuffled)
    for (const id of Object.keys(base)) close(sh[id], base[id], 1e-9 * Math.max(1, Math.abs(base[id])), `order-invariant ${id}`)
    // 4. blank and zero rows change nothing
    const padded = clone(p)
    padded.data.sources.rows.push({ name: 'Z', type: 'hard_debt', amount: 0, termMonths: 360, interestRate: 0.05 }, {})
    padded.data.residentialIncome.rows.push({})
    const pv = values(padded)
    for (const id of ['dscr', 'noiCushion', 'breakEven', 'debtYield']) close(pv[id], base[id], 1e-9 * Math.max(1, Math.abs(base[id])), `blank rows ignored ${id}`)
    // 5. a typed YEARLY payment equal to the calculated one gives the same debt service
    const typed = clone(p)
    const a = typed.data.sources.rows[0]
    a.paymentOverride = M.monthlyPayment(a.amount, a.interestRate, a.termMonths) * 12
    close(M.annualDebtService(typed).value, M.annualDebtService(p).value, 1e-6, 'typed yearly payment')
    // 6. more rent means more NOI, a higher rate means more debt service, more vacancy means less NOI, a longer term means a lower payment
    const richer = clone(p); richer.data.residentialIncome.rows[0].monthlyRent += 100
    assert.ok(M.noi(richer).value > M.noi(p).value)
    const dearer = clone(p); dearer.data.sources.rows[0].interestRate += 0.01
    assert.ok(M.annualDebtService(dearer).value > M.annualDebtService(p).value)
    const emptier = clone(p); emptier.data.residentialIncome.stabilizedVacancy += 0.05
    assert.ok(M.noi(emptier).value < M.noi(p).value)
    const longer = clone(p); longer.data.sources.rows[0].termMonths += 60
    assert.ok(M.annualDebtService(longer).value < M.annualDebtService(p).value)
    // 7. the ratios agree with each other
    const noi = M.noi(p), ds = M.annualDebtService(p).value
    close(base.dscr, noi.value / ds, 1e-12, 'DSCR = NOI / debt service')
    close(base.noiCushion, 1 - 1.2 / base.dscr, 1e-9, 'cushion = 1 - minimum / DSCR')
    close(base.breakEven * noi.grossPotential, noi.expenses + ds, 1e-6, 'break-even identity')
  }
})
