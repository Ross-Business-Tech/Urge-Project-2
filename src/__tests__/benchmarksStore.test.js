import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSaved, saveEntries, STORAGE_KEY } from '../benchmarksStore.js'

const memory = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, v), data }
}
const list = [{ id: 'a', metric: 'dscr', low: 1.2, high: 1.5, typical: null }]

test('what was saved on this device comes back, exactly', () => {
  const s = memory()
  assert.equal(saveEntries(s, list), true)
  assert.deepEqual(loadSaved(s), list)
})

test('nothing saved, damaged saved data, or a different file: an empty list, never a crash', () => {
  assert.deepEqual(loadSaved(memory()), [])
  for (const bad of ['not json', '{}', '{"kind":"other"}', JSON.stringify({ kind: 'deal-review-benchmarks', version: 99, benchmarks: [] })]) {
    const s = memory()
    s.setItem(STORAGE_KEY, bad)
    assert.deepEqual(loadSaved(s), [], bad)
  }
})

test('a browser that refuses storage is survived, and the app is told the list was not kept', () => {
  const refusing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadSaved(refusing), [])
  assert.equal(saveEntries(refusing, list), false)
  assert.deepEqual(loadSaved(null), [])
  assert.equal(saveEntries(null, list), false)
})

test('only the benchmarks are saved: no project data, no workbook figures', () => {
  const s = memory()
  saveEntries(s, list)
  assert.deepEqual(Object.keys(JSON.parse(s.data.get(STORAGE_KEY))).sort(), ['benchmarks', 'kind', 'note', 'version'])
})
