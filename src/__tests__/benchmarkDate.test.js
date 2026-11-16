import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDate, lastChangedText } from '../benchmarkDate.js'

test('a date is shown in plain words', () => {
  assert.equal(formatDate('2026-11-16T12:00:00.000Z', 'UTC'), 'November 16, 2026')
  assert.equal(formatDate('2026-01-02T12:00:00.000Z', 'UTC'), 'January 2, 2026')
})

test('the same moment can fall on different days in different time zones, so the date follows the viewer', () => {
  assert.equal(formatDate('2026-11-16T23:30:00.000Z', 'UTC'), 'November 16, 2026')
  assert.equal(formatDate('2026-11-16T23:30:00.000Z', 'Pacific/Auckland'), 'November 17, 2026')
})

test('no date, or an unreadable one, is not made up', () => {
  assert.equal(formatDate('nope'), null)
  assert.equal(formatDate(undefined), null)
  assert.equal(lastChangedText(null), 'last changed date not recorded yet')
  assert.equal(lastChangedText(''), 'last changed date not recorded yet')
  assert.equal(lastChangedText('garbage'), 'last changed date not recorded yet')
  assert.match(lastChangedText('2026-11-16T12:00:00.000Z'), /^last changed (November 1[56]|November 17), 2026$/)
})
