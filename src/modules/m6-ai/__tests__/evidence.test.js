import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEvidence } from '../evidence.js'

const flags = ['F-a', 'F-b', 'F-c', 'F-d'].map((id) => ({ id, title: `Title ${id}`, severity: 'low', evidence: `Evidence of ${id}` }))
const answer = (over = {}) => ({
  connections: [],
  look_first: [],
  questions: [],
  integrity_screen: [],
  ...over,
})

test('findings are numbered in the order the reader first meets them, and each keeps one number however often it is used', () => {
  const a = answer({
    connections: [{ flag_ids: ['F-b', 'F-a'], check_first: 'F-b', cites: [] }, { flag_ids: ['F-a', 'F-c'], check_first: 'F-c', cites: [] }],
    look_first: [{ flag_id: 'F-c' }],
    questions: [{ flag_ids: ['F-d', 'F-a'] }],
  })
  const e = buildEvidence(a, flags)
  assert.deepEqual(e.entries.map((x) => [x.n, x.flag.id]), [[1, 'F-b'], [2, 'F-a'], [3, 'F-c'], [4, 'F-d']])
  assert.deepEqual(e.numbersFor(['F-a', 'F-c']), [2, 3])
  assert.deepEqual(e.numbersFor(['F-d', 'F-a']), [2, 4], 'ascending, whatever the order the statement listed them')
  assert.deepEqual(e.numbersFor('F-b'), [1], 'a single pointer works too')
  assert.deepEqual(e.numbersFor(['F-a'], 'F-a', ['F-a']), [2], 'no repeats')
})

test('the reading order is connections, then look first, then questions, then the data screen', () => {
  const a = answer({
    integrity_screen: [{ cites: ['F-d'] }],
    questions: [{ flag_ids: ['F-c'] }],
    look_first: [{ flag_id: 'F-b' }],
    connections: [{ flag_ids: ['F-a'], check_first: 'F-a', cites: [] }],
  })
  assert.deepEqual(buildEvidence(a, flags).entries.map((x) => x.flag.id), ['F-a', 'F-b', 'F-c', 'F-d'])
})

test('a spreadsheet cell is evidence too: it is numbered with the findings, and a statement can point at it', () => {
  const a = answer({
    connections: [{ flag_ids: ['F-a'], check_first: 'F-a', cites: ['Budget!G102', 'F-a'] }],
    integrity_screen: [{ cites: ['Details!H28', 'Budget!G102'] }],
  })
  const e = buildEvidence(a, flags)
  assert.deepEqual(e.entries.map((x) => [x.n, x.kind, x.kind === 'cell' ? x.cell : x.flag.id]), [[1, 'finding', 'F-a'], [2, 'cell', 'Budget!G102'], [3, 'cell', 'Details!H28']])
  assert.deepEqual(e.findings.map((x) => x.flag.id), ['F-a'])
  assert.deepEqual(e.cells.map((x) => x.cell), ['Budget!G102', 'Details!H28'])
  assert.deepEqual(e.numbersFor(['Details!H28', 'Budget!G102']), [2, 3])
})

test('a statement that points at nothing, and an answer with no pointers, give no evidence and no numbers', () => {
  const e = buildEvidence(answer({ connections: [{ flag_ids: [], check_first: undefined, cites: [] }], questions: [{ flag_ids: undefined }] }), flags)
  assert.deepEqual(e.entries, [])
  assert.deepEqual(e.numbersFor([]), [])
  assert.deepEqual(buildEvidence(answer(), []).entries, [])
})

test('things that are not text are ignored, and unknown ids are treated as cells (the answer was already checked before this)', () => {
  const e = buildEvidence(answer({ look_first: [{ flag_id: null }, { flag_id: 42 }, { flag_id: 'F-a' }] }), flags)
  assert.deepEqual(e.entries.map((x) => x.flag.id), ['F-a'])
})
