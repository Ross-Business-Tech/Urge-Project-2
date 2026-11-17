import test from 'node:test'
import assert from 'node:assert/strict'
import { healthyProject } from '../modules/shared/samples/baseline.js'
import { applyStageAndDate } from '../modules/shared/index.js'
import { benchmarkEffects } from '../benchmarkEffects.js'

const project = (stage = 'development', edit = () => {}) => {
  const p = applyStageAndDate(healthyProject(), { stage, asOfDate: '2026-01-15' })
  p.data.budget.lines.constructionInterest.amount = 150000
  edit(p.data)
  return p
}
const twoTypes = (d) => {
  d.residentialIncome.rows.push({ amiLevel: null, unitType: '2 BR', units: 20, baths: 2, sqft: 950, monthlyRent: 1900 })
}
const rent = (unitType, low, high, ami = '', id = `r-${unitType}-${ami}`) => ({ id, metric: 'rent', unitType, ami, low, high, typical: null })
const ratio = (metric, low, high) => ({ id: metric, metric, low, high, typical: null })
const itemOf = (res, id) => res.items.find((i) => i.id === id)

test('nothing entered, or no stage chosen: nothing to report', () => {
  assert.deepEqual(benchmarkEffects(project(), []).items, [])
  assert.deepEqual(benchmarkEffects(project(), [ratio('dscr', 2, 1)]).items, [], 'an unusable range is not reported')
  assert.deepEqual(benchmarkEffects(healthyProject(), [ratio('vacancy', 0.01, 0.02)]).items, [])
})

test('a 1-bedroom range is compared with the 1-bedroom units only, and the 2-bedroom units are listed as not compared', () => {
  const p = project('development', twoTypes)
  const res = benchmarkEffects(p, [rent('1 BR', 1000, 1200)])
  const item = itemOf(res, 'r-1 BR-')
  assert.equal(item.label, 'Monthly rent per unit: 1br (market rate)')
  assert.equal(item.status, 'above', 'the 1-bdr unit rents at $1,500, above $1,000 to $1,200')
  assert.match(item.text, /1 unit row of this type: 1 above your range/)
  assert.deepEqual(res.notCompared, ['Rent for 2br (market rate): no range entered, so 1 unit row not compared.'])
})

test('a 2-bedroom range is compared with the 2-bedroom units, whatever way the type was written', () => {
  const p = project('development', twoTypes)
  for (const typed of ['2br', '2 BR', '2-bdr', 'two bedroom', '2 Bed']) {
    const res = benchmarkEffects(p, [rent(typed, 1700, 2100), rent('1br', 1400, 1600)])
    assert.equal(res.items[0].status, 'within', typed)
    assert.equal(res.items[1].status, 'within', typed)
    assert.deepEqual(res.notCompared, [], typed)
  }
})

test('an income level is its own benchmark: a market range does not cover units at 60%, and a 60% range does not cover market units', () => {
  const p = project('development', (d) => {
    twoTypes(d)
    d.residentialIncome.rows.push({ amiLevel: 0.6, unitType: '1 BR', units: 10, baths: 1, sqft: 700, monthlyRent: 900 })
  })
  const onlyMarket = benchmarkEffects(p, [rent('1br', 1400, 1600)])
  assert.ok(onlyMarket.notCompared.some((t) => /1br at the 60% income level/.test(t)))
  const sixty = benchmarkEffects(p, [rent('1br', 850, 950, '60')])
  assert.equal(sixty.items[0].status, 'within')
  assert.match(sixty.items[0].label, /1br at the 60% income level/)
  assert.ok(sixty.notCompared.some((t) => /1br \(market rate\)/.test(t)), 'the market 1br unit is not compared with the 60% range')
})

test('a rent range for a type the project does not have says it was not used', () => {
  const res = benchmarkEffects(project(), [rent('3br', 2000, 2500)])
  assert.equal(res.items[0].status, 'unused')
  assert.match(res.items[0].text, /No unit in this project matches/)
})

test('loan and return ranges: where the project stands, with the finding’s severity', () => {
  const res = benchmarkEffects(project(), [ratio('interestRate', 0.03, 0.04), ratio('vacancy', 0.05, 0.08), ratio('dscr', 1.2, 1.5)])
  const rate = itemOf(res, 'interestRate')
  assert.equal(rate.status, 'above')
  assert.equal(rate.severity, 'high')
  assert.equal(rate.wanted, '3.00% to 4.00%')
  assert.equal(itemOf(res, 'vacancy').status, 'within')
  assert.equal(itemOf(res, 'vacancy').severity, null)
  assert.equal(itemOf(res, 'dscr').status, 'better', 'coverage above the range is good news')
  assert.equal(itemOf(res, 'dscr').severity, null, 'and raises no flag')
  assert.equal(itemOf(res, 'dscr').screen, 'keynumbers')
})

test('a figure that cannot be worked out is "not available", never a finding', () => {
  const p = project('development', (d) => {
    d.sources.rows = []
  })
  const item = benchmarkEffects(p, [ratio('interestRate', 0.05, 0.07)]).items[0]
  assert.equal(item.status, 'not_available')
  assert.equal(item.severity, null)
  assert.match(item.text, /No loans with an amount/)
})

test('expense and cost ranges are compared, and cost ranges are not used for a completed project', () => {
  const dev = benchmarkEffects(project(), [{ id: 'e', metric: 'expense', low: 100, high: 200, typical: null }, { id: 'c', metric: 'costTotal', low: 1, high: 2, typical: null }])
  assert.equal(itemOf(dev, 'e').status, 'above')
  assert.equal(itemOf(dev, 'c').status, 'above')
  const done = benchmarkEffects(project('completed'), [{ id: 'c', metric: 'costTotal', low: 1, high: 2, typical: null }])
  assert.equal(done.items[0].status, 'unused')
  assert.match(done.items[0].text, /already spent/)
})

test('contingency: read from the development risk check, and not used for a completed project', () => {
  const thin = project('development', (d) => (d.budget.lines.constructionContingency.amount = 40000))
  const c = { id: 'k', metric: 'contingency', low: 0.05, high: 0.1, typical: null }
  const low = benchmarkEffects(thin, [c]).items[0]
  assert.equal(low.status, 'below')
  assert.equal(low.severity, 'high')
  assert.equal(low.screen, 'devrisk')
  assert.equal(benchmarkEffects(project('development', (d) => (d.budget.lines.constructionContingency.amount = 175000)), [c]).items[0].status, 'within')
  assert.equal(benchmarkEffects(project('completed'), [c]).items[0].status, 'unused')
})

test('the summary lists only what was entered, in the order entered', () => {
  const res = benchmarkEffects(project(), [ratio('vacancy', 0.05, 0.08), ratio('interestRate', 0.03, 0.04)])
  assert.deepEqual(res.items.map((i) => i.id), ['vacancy', 'interestRate'])
})

test('a project is never changed', () => {
  const p = project('development', twoTypes)
  const before = JSON.stringify(p)
  benchmarkEffects(p, [rent('1br', 1000, 1200), ratio('interestRate', 0.03, 0.04)])
  assert.equal(JSON.stringify(p), before)
})
