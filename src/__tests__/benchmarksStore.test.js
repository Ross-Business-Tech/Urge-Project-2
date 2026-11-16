import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSaved, saveEntries, commitChange, STORAGE_KEY } from '../benchmarksStore.js'

const memory = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, v), data }
}
const list = [{ id: 'a', metric: 'dscr', low: 1.2, high: 1.5, typical: null }]

test('what was saved on this device comes back, exactly', () => {
  const s = memory()
  assert.equal(saveEntries(s, list), true)
  assert.deepEqual(loadSaved(s), { entries: list, changedAt: null })
})

test('the date the benchmarks were last changed is kept with them, and old saved data without a date still opens', () => {
  const s = memory()
  saveEntries(s, list, '2026-11-16T15:30:00.000Z')
  assert.deepEqual(loadSaved(s), { entries: list, changedAt: '2026-11-16T15:30:00.000Z' })
  const old = memory()
  old.setItem(STORAGE_KEY, JSON.stringify({ kind: 'deal-review-benchmarks', version: 1, note: '', benchmarks: list }))
  assert.deepEqual(loadSaved(old), { entries: list, changedAt: null })
})

test('nothing saved, damaged saved data, or a different file: an empty list, never a crash', () => {
  assert.deepEqual(loadSaved(memory()), { entries: [], changedAt: null })
  for (const bad of ['not json', '{}', '{"kind":"other"}', JSON.stringify({ kind: 'deal-review-benchmarks', version: 99, benchmarks: [] })]) {
    const s = memory()
    s.setItem(STORAGE_KEY, bad)
    assert.deepEqual(loadSaved(s), { entries: [], changedAt: null }, bad)
  }
})

test('a browser that refuses storage is survived, and the app is told the list was not kept', () => {
  const refusing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadSaved(refusing), { entries: [], changedAt: null })
  assert.equal(saveEntries(refusing, list), false)
  assert.deepEqual(loadSaved(null), { entries: [], changedAt: null })
  assert.equal(saveEntries(null, list), false)
})

test('only the benchmarks are saved: no project data, no workbook figures', () => {
  const s = memory()
  saveEntries(s, list, '2026-11-16T15:30:00.000Z')
  assert.deepEqual(Object.keys(JSON.parse(s.data.get(STORAGE_KEY))).sort(), ['benchmarks', 'changedAt', 'kind', 'note', 'version'])
})

const NOW = () => '2026-11-16T15:30:00.000Z'

test('a change is dated now and kept with its date', () => {
  const s = memory()
  assert.deepEqual(commitChange(s, list, undefined, NOW), { changedAt: '2026-11-16T15:30:00.000Z', kept: true })
  assert.deepEqual(loadSaved(s), { entries: list, changedAt: '2026-11-16T15:30:00.000Z' })
})

test('a list opened from a file keeps the file’s own date, and a file with no date stays "not recorded"', () => {
  const s = memory()
  assert.deepEqual(commitChange(s, list, '2026-03-05T12:00:00.000Z', NOW), { changedAt: '2026-03-05T12:00:00.000Z', kept: true })
  assert.equal(loadSaved(s).changedAt, '2026-03-05T12:00:00.000Z')
  assert.deepEqual(commitChange(s, list, null, NOW), { changedAt: null, kept: true })
  assert.equal(loadSaved(s).changedAt, null, 'not stamped with today')
})

test('a change that cannot be kept still has its date, and says it was not kept', () => {
  const refusing = { getItem: () => null, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(commitChange(refusing, list, undefined, NOW), { changedAt: '2026-11-16T15:30:00.000Z', kept: false })
})
