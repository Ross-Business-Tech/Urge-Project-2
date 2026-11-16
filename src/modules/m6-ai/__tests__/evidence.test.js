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

// ---------------------------------------------------------------- connecting evidence to ideas and figures
const money = [
  { id: 'F-cash', title: 'Firm cash is low.', severity: 'high', evidence: 'Firm cash and investments $20,000 against $600,000 owed within a year.' },
  { id: 'F-team', title: 'The team is not named.', severity: 'low', evidence: 'Not named: general contractor, architect.' },
]
const cells = [
  { cell: 'Balance Sheet!B9', label: 'Firm balance sheet: Cash (Current period)', value: '$900,000' },
  { cell: 'Balance Sheet!D9', label: 'Firm balance sheet: Cash (Prior period)', value: '$700,000' },
]
const full = (over = {}) => ({
  summary: 'Cash rose to $900,000 from $700,000, yet firm cash of $20,000 is small against $600,000 owed. No builder is named.',
  summary_pointers: ['F-cash', 'Balance Sheet!B9', 'Balance Sheet!D9'],
  connections: [{ headline: 'Thin cash', explanation: 'The firm owes $600,000.', flag_ids: ['F-cash'], check_first: 'F-cash', cites: [] }],
  look_first: [{ flag_id: 'F-team', reason: 'Nobody is named to build it.' }],
  questions: [{ question: 'Who will build the project and how is the firm funded?', reason: '', flag_ids: ['F-team', 'F-cash'] }],
  integrity_screen: [{ title: 'Cash differs', why: 'The cash cell holds $900,000.', cites: ['Balance Sheet!B9'], confidence: 'low' }],
  ...over,
})

test('the summary’s evidence is numbered first, because the summary is read first', () => {
  const e = buildEvidence(full(), money, cells)
  assert.deepEqual(e.entries.map((x) => x.n), [1, 2, 3, 4])
  assert.equal(e.entries[0].flag.id, 'F-cash')
  assert.equal(e.entries[1].cell, 'Balance Sheet!B9')
  assert.equal(e.entries[2].cell, 'Balance Sheet!D9')
  assert.equal(e.entries[3].flag.id, 'F-team')
})

test('each piece of evidence lists every idea it supports, once, in reading order', () => {
  const e = buildEvidence(full(), money, cells)
  assert.deepEqual(e.entries[0].supports, ['The summary', 'Thin cash', 'Question 1: Who will build the project and how is the firm funded?'], 'a finding used by the summary, a connection and a question')
  assert.deepEqual(e.entries[1].supports, ['The summary', 'Data screen: Cash differs'])
  assert.deepEqual(e.entries[2].supports, ['The summary'])
  assert.deepEqual(e.entries[3].supports, ['Look first: The team is not named', 'Question 1: Who will build the project and how is the firm funded?'], 'the title loses its full stop to sit after the label')
})

test('a long question is shortened in the label, and nothing is invented for ideas that have no label', () => {
  const long = 'Please explain in detail every single assumption behind the stabilized operating expenses and the reserve funding plan.'
  const e = buildEvidence(full({ questions: [{ question: long, reason: '', flag_ids: ['F-cash'] }] }), money, cells)
  const label = e.entries[0].supports.find((t) => t.startsWith('Question 1'))
  assert.ok(label.length <= 'Question 1: '.length + 70 && label.endsWith('…'), label)
  const sparse = buildEvidence({ connections: [], look_first: [], questions: [{ flag_ids: ['F-cash'] }], integrity_screen: [] }, money, [])
  assert.equal(sparse.entries[0].supports[0], 'Question 1: ', 'no crash on a statement with no text')
})

test('a cell says what it holds, taken from the table of values that was sent; an unknown cell has no invented label', () => {
  const e = buildEvidence(full({ summary_pointers: ['Balance Sheet!B9', 'Elsewhere!A1'] }), money, cells)
  assert.deepEqual([e.entries[0].label, e.entries[0].value], ['Firm balance sheet: Cash (Current period)', '$900,000'])
  const unknown = e.entries.find((x) => x.cell === 'Elsewhere!A1')
  assert.deepEqual([unknown.label, unknown.value], [null, null])
})

test('each piece of evidence explains exactly the figures in the answer that it contains, written as the answer wrote them', () => {
  const e = buildEvidence(full(), money, cells)
  assert.deepEqual(e.entries[0].figures, ['$20,000', '$600,000'], 'the finding holds both, listed in the order the answer first states them')
  assert.deepEqual(e.entries[1].figures, ['$900,000'], 'the current cash cell explains $900,000 and not $700,000')
  assert.deepEqual(e.entries[2].figures, ['$700,000'])
  assert.deepEqual(e.entries[3].figures, [], 'a finding with no figure in the answer explains none')
})

test('figures are matched however they are written, and bare small numbers are not treated as figures', () => {
  const flags2 = [{ id: 'F-x', title: 'Coverage is thin.', severity: 'high', evidence: 'DSCR 1.20× against a 1.2 minimum and 3 loans.' }]
  const e = buildEvidence({ summary: 'Coverage of 1.20 is thin across 3 loans.', summary_pointers: ['F-x'], connections: [], look_first: [], questions: [], integrity_screen: [] }, flags2, [])
  assert.deepEqual(e.entries[0].figures, ['1.20'], '1.20 matches 1.2; the count of 3 is not a figure')
})

test('a figure the answer states that no evidence contains is explained by nothing (the screen already warns about it)', () => {
  const e = buildEvidence(full({ summary: 'The loan is $9,999,999.' }), money, cells)
  assert.ok(e.entries.every((x) => !x.figures.includes('$9,999,999')))
})
