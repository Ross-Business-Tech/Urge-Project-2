import test from 'node:test'
import assert from 'node:assert/strict'
import { deidentify, restore, leaks, replaceInText } from '../deidentify.js'

const map = [
  { original: 'Maple Ridge Partners LLC', label: '[Sponsor firm]' },
  { original: 'Maple Ridge', label: '[Short name]' },
  { original: 'Pat Sample', label: '[Principal A]' },
]

test('longer names are replaced before the shorter names inside them', () => {
  assert.equal(replaceInText('Maple Ridge Partners LLC and Maple Ridge', map), '[Sponsor firm] and [Short name]')
})

test('replacement ignores capital letters but respects word edges', () => {
  assert.equal(replaceInText('PAT SAMPLE said so', map), '[Principal A] said so')
  assert.equal(replaceInText('Pat Sampler is someone else', map), 'Pat Sampler is someone else')
  assert.equal(replaceInText('xPat Sample', map), 'xPat Sample')
})

test('cell references and ids are never touched, even if they contain a name', () => {
  const out = deidentify({ id: 'M5-Pat Sample', cell_refs: ['Pat Sample!B2'], title: 'Pat Sample owns it', flag_ids: ['Pat Sample'] }, map)
  assert.deepEqual(out, { id: 'M5-Pat Sample', cell_refs: ['Pat Sample!B2'], title: '[Principal A] owns it', flag_ids: ['Pat Sample'] })
})

test('it walks nested lists and objects, and leaves numbers and other values alone', () => {
  const out = deidentify({ a: [{ b: 'Pat Sample', n: 5, t: true, z: null }] }, map)
  assert.deepEqual(out, { a: [{ b: '[Principal A]', n: 5, t: true, z: null }] })
})

test('labels are turned back into real names for display, and unknown text is left alone', () => {
  assert.equal(restore('Ask [Principal A] about [Sponsor firm].', map), 'Ask Pat Sample about Maple Ridge Partners LLC.')
  assert.equal(restore('Nothing to restore', map), 'Nothing to restore')
  assert.equal(restore(42, map), 42)
})

test('a name containing regular-expression characters cannot break or hijack the replacement', () => {
  const tricky = [{ original: 'A.B (Holdings) +', label: '[X]' }, { original: '.*.*.*.*', label: '[Y]' }]
  assert.equal(replaceInText('see A.B (Holdings) + now, and axb (holdings) +', tricky), 'see [X] now, and axb (holdings) +')
  assert.equal(replaceInText('anything at all', tricky), 'anything at all')
})

test('leaks lists any real name still present', () => {
  assert.deepEqual(leaks({ x: 'ok [Principal A]' }, map), [])
  assert.deepEqual(leaks({ x: 'Pat Sample was here' }, map), ['Pat Sample'])
})
