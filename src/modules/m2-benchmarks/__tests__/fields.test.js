import test from 'node:test'
import assert from 'node:assert/strict'
import { fromText, toText } from '../fields.js'

test('what people type becomes a number: percent as a share, dollars without $ or commas, coverage without the x', () => {
  assert.equal(fromText('percent', '6.5'), 0.065)
  assert.equal(fromText('percent', '6.5%'), 0.065)
  assert.equal(fromText('percent', ' 7 % '.trim()), 0.07)
  assert.equal(fromText('dollars', '$1,450'), 1450)
  assert.equal(fromText('dollars', '1450.50'), 1450.5)
  assert.equal(fromText('times', '1.25x'), 1.25)
  assert.equal(fromText('times', '1.25'), 1.25)
  assert.equal(fromText('percent', '.5'), 0.005)
  assert.equal(fromText('percent', '7'), 0.07, 'no float noise')
})

test('anything that is not a plain positive figure is "nothing entered", never a guess', () => {
  for (const bad of ['', '   ', 'abc', '-5', '1e3', '5,5.5.5', '--', '$', '%', null, undefined, '6.5 percent']) assert.equal(fromText('percent', bad), null, String(bad))
})

test('a number is shown the way it was typed, with no float noise', () => {
  assert.equal(toText('percent', 0.065), '6.5')
  assert.equal(toText('percent', 0.07), '7')
  assert.equal(toText('dollars', 1450), '1450')
  assert.equal(toText('times', 1.25), '1.25')
  assert.equal(toText('percent', 0.07500000000000001), '7.5')
  assert.equal(toText('dollars', null), '')
  assert.equal(toText('dollars', NaN), '')
  assert.equal(toText('dollars', undefined), '')
})

test('typing then showing then typing again gives the same number', () => {
  for (const [unit, text] of [['percent', '6.25'], ['dollars', '1875'], ['times', '1.35'], ['percent', '0.5']]) {
    const n = fromText(unit, text)
    assert.equal(fromText(unit, toText(unit, n)), n, `${unit} ${text}`)
  }
})
