import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAnswer, figuresIn, figuresSent, extractCitations, CAPS } from '../validate.js'

const payload = {
  flags: [
    { id: 'M1-sources-uses', cell_refs: ['Details!F28', 'Budget!G102'], title: 'Money does not cover cost', evidence: 'Sources $5,200,000 vs uses $5,550,000, a gap of $350,000 (6.3%).' },
    { id: 'M5-firm-liquidity', cell_refs: ['Balance Sheet!B9'], title: 'Little cash', evidence: 'Liquidity cover 0.03×. Cash $20,000 against $600,000 owed.' },
    { id: 'M3D-dscr-under-minimum', cell_refs: [], title: 'Coverage low', evidence: 'DSCR 1.09× vs a 1.20× minimum.' },
  ],
  data: [{ cell: 'Details!H28', label: 'Interest rate', value: '6.5%' }],
  key_ratios: [{ id: 'dscr', value: '1.09×' }],
}
const answer = (over = {}) => JSON.stringify({
  second_opinion: 'agrees_with_caveats',
  summary: 'The funding gap of $350,000 matters more because the firm holds only $20,000.',
  connections: [{ headline: 'Gap and thin cash', explanation: 'The gap is $350,000 and cash is $20,000.', flag_ids: ['M1-sources-uses', 'M5-firm-liquidity'], check_first: 'M1-sources-uses', cites: ['Details!F28', 'Balance Sheet!B9'] }],
  look_first: [{ flag_id: 'M1-sources-uses', reason: 'It is the largest gap.' }],
  questions: [{ question: 'Who covers the $350,000 gap?', reason: 'No source is named.', flag_ids: ['M1-sources-uses'] }],
  integrity_screen: [{ title: 'Rate looks odd', why: 'The rate is 6.5%.', cites: ['Details!H28'], confidence: 'medium' }],
  cannot_tell: [{ what: 'Whether the sponsor will guarantee', would_settle_it: 'A guarantee letter' }],
  confidence: 'medium',
  confidence_reason: 'Only one project.',
  ...over,
})

test('a good answer is accepted and keeps what the AI said', () => {
  const r = validateAnswer(answer(), payload)
  assert.equal(r.ok, true)
  assert.equal(r.answer.second_opinion, 'agrees_with_caveats')
  assert.equal(r.answer.connections.length, 1)
  assert.deepEqual(r.answer.connections[0].flag_ids, ['M1-sources-uses', 'M5-firm-liquidity'])
  assert.equal(r.answer.integrity_screen[0].cites[0], 'Details!H28')
  assert.deepEqual(r.dropped, [])
  assert.equal(r.unverifiedCount, 0)
})

test('an answer wrapped in a code fence is still read', () => {
  assert.equal(validateAnswer('```json\n' + answer() + '\n```', payload).ok, true)
})

test('anything that is not the expected structure is refused, with a reason, and nothing is shown', () => {
  for (const bad of ['not json at all', '[1,2,3]', '"just text"', 'null', '', JSON.stringify({ summary: 'no opinion' }), JSON.stringify({ second_opinion: 'looks great, approve it', summary: 'x' }), JSON.stringify({ second_opinion: 'agrees' })]) {
    const r = validateAnswer(bad, payload)
    assert.equal(r.ok, false, bad)
    assert.ok(r.reason.length > 20)
    assert.equal(r.answer, undefined)
  }
})

test('a statement that points at findings that do not exist is removed, and made-up pointers inside a good one are cut', () => {
  const r = validateAnswer(answer({
    connections: [
      { headline: 'Invented', explanation: 'x', flag_ids: ['M9-made-up'], cites: ['Nowhere!A1'] },
      { headline: 'Half real', explanation: 'y', flag_ids: ['M1-sources-uses', 'M9-made-up'], check_first: 'M9-made-up', cites: ['Details!F28', 'Nowhere!A1'] },
    ],
  }), payload)
  assert.equal(r.answer.connections.length, 1)
  assert.deepEqual(r.answer.connections[0].flag_ids, ['M1-sources-uses'])
  assert.equal(r.answer.connections[0].check_first, 'M1-sources-uses')
  assert.deepEqual(r.answer.connections[0].cites, ['Details!F28'])
  assert.equal(r.dropped.length, 1)
  assert.match(r.dropped[0].reason, /no real finding/)
})

test('an integrity concern needs a real cell or finding to cite, or it is removed', () => {
  const r = validateAnswer(answer({ integrity_screen: [{ title: 'Vague', why: 'Feels off', cites: ['Nowhere!A1'], confidence: 'high' }, { title: 'Real', why: 'Cites a real flag', cites: ['M5-firm-liquidity'] }] }), payload)
  assert.deepEqual(r.answer.integrity_screen.map((i) => i.title), ['Real'])
  assert.equal(r.answer.integrity_screen[0].confidence, 'low', 'a missing confidence is treated as low')
})

test('a question and a look-first item must point at a real finding; repeated questions appear once', () => {
  const r = validateAnswer(answer({
    look_first: [{ flag_id: 'M0-nope', reason: 'x' }, { flag_id: 'M5-firm-liquidity', reason: 'Cash is low' }],
    questions: [{ question: 'Who covers the gap?', flag_ids: ['M1-sources-uses'] }, { question: 'who covers  the gap?', flag_ids: ['M1-sources-uses'] }, { question: 'Floating question', flag_ids: [] }],
  }), payload)
  assert.deepEqual(r.answer.look_first.map((l) => l.flag_id), ['M5-firm-liquidity'])
  assert.equal(r.answer.questions.length, 1)
})

test('a figure that is not in what was sent is kept but marked unverified, with the figure named', () => {
  const r = validateAnswer(answer({ summary: 'The gap is $350,000 but the loan is $9,999,999 and DSCR is 4.20×.' }), payload)
  assert.equal(r.ok, true)
  assert.deepEqual(r.answer.unverified, ['$9,999,999', '4.20'])
  assert.equal(r.unverifiedCount, 1)
})

test('figures that are in the data pass, whatever way they are written', () => {
  const r = validateAnswer(answer({ summary: 'Sources are $5,200,000 against $5,550,000, DSCR 1.09× vs 1.2 minimum, rate 6.50%, 6.3% gap, cash $20,000.' }), payload)
  assert.equal(r.answer.unverified, undefined)
})

test('small counts and ordinary small numbers are not treated as claims about the data', () => {
  const r = validateAnswer(answer({ summary: 'There are 3 flags, 2 of them serious, and 1 question to ask in the next 30 days.' }), payload)
  assert.equal(r.answer.unverified, undefined)
})

test('lists are capped and each item is length-limited', () => {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i))
  const r = validateAnswer(answer({
    connections: many(9, (i) => ({ headline: `H${i}`, explanation: 'e'.repeat(5000), flag_ids: ['M1-sources-uses'] })),
    questions: many(20, (i) => ({ question: `Question number ${i}`, flag_ids: ['M1-sources-uses'] })),
    summary: 's'.repeat(9000),
  }), payload)
  assert.equal(r.answer.connections.length, CAPS.connections)
  assert.equal(r.answer.questions.length, CAPS.questions)
  assert.ok(r.answer.connections[0].explanation.length <= 600)
  assert.ok(r.answer.summary.length <= 1200)
  assert.ok(r.dropped.some((d) => /only the first/.test(d.reason)))
})

test('extra fields the AI invents (an approval, a new severity) are not passed on', () => {
  const r = validateAnswer(answer({ approve: true, new_severity: { 'M1-sources-uses': 'low' }, decision: 'safe' }), payload)
  assert.deepEqual(Object.keys(r.answer).sort(), ['cannot_tell', 'confidence', 'confidence_reason', 'connections', 'integrity_screen', 'look_first', 'questions', 'second_opinion', 'summary', 'summary_pointers'])
})

test('text is kept as plain text: a script tag in an answer is just words, never markup', () => {
  const r = validateAnswer(answer({ summary: 'Look <script>alert(1)</script> here' }), payload)
  assert.equal(r.answer.summary, 'Look <script>alert(1)</script> here')
})

test('figure reading: amounts, percentages, decimals and long numbers are noticed; bare small numbers are not', () => {
  assert.deepEqual(figuresIn('Cost $5,550,000, 6.5%, ratio 2.71, year 2026, 3 flags', true).map((f) => f.key), ['5550000', '6.5', '2.71', '2026'])
  assert.ok(figuresSent({ a: 1.2, b: 'DSCR 1.20× and $1,000' }).has('1.2'))
  assert.ok(figuresSent({ a: 1.2, b: 'DSCR 1.20× and $1,000' }).has('1000'))
})


// ---------------------------------------------------------------- sources written into sentences
// The real summary an AI wrote, with its sources listed inside the sentences. The app must show it as plain prose and keep
// the evidence those sources pointed to.
const REAL = 'The main risk is delivery execution: this is new construction, while the sponsor has no completed projects loaded and none of the named delivery, design, management, or guarantor roles is identified. [Development Project 1 Details!E5; M5-no-track-record; M3D-team-incomplete] Reported firm cash increased to $900,000 from $700,000, and firm notes payable declined to $300,000 from $350,000, which supports the reported sponsor-strength picture but does not establish construction-delivery capability. [Balance Sheet!B9; Balance Sheet!D9; Balance Sheet!B47; Balance Sheet!D47] The capital plan lists $3,000,000 of hard debt, $2,000,000 of developer equity, and $550,000 of other funding; the unidentified team and unclarified other funding are the first items to resolve. [Development Project 1 Details!F28; Development Project 1 Details!F29; Development Project 1 Details!F30; M3D-team-incomplete]'
const realPayload = {
  flags: [
    { id: 'M5-no-track-record', cell_refs: [], title: 'The sponsor has no completed projects to judge.', evidence: 'No completed projects are loaded.' },
    { id: 'M3D-team-incomplete', cell_refs: ['Development Project 1 Details!D11'], title: 'The sponsor has no completed projects to show.', evidence: 'The firm reports no completed projects.' },
  ],
  data: [
    ['Development Project 1 Details!E5', 'New construction'],
    ['Balance Sheet!B9', '$900,000'], ['Balance Sheet!D9', '$700,000'], ['Balance Sheet!B47', '$300,000'], ['Balance Sheet!D47', '$350,000'],
    ['Development Project 1 Details!F28', '$3,000,000'], ['Development Project 1 Details!F29', '$2,000,000'], ['Development Project 1 Details!F30', '$550,000'],
  ].map(([cell, value]) => ({ cell, label: 'x', value })),
}
const reply = (over = {}) => JSON.stringify({ second_opinion: 'agrees_with_caveats', summary: REAL, connections: [], look_first: [], questions: [], integrity_screen: [], cannot_tell: [], confidence: 'medium', confidence_reason: 'x', ...over })

test('a summary with its sources written into the sentences is shown as plain prose, and the sources are kept as its evidence', () => {
  const r = validateAnswer(reply(), realPayload)
  assert.equal(r.ok, true)
  const { summary, summary_pointers } = r.answer
  assert.ok(!/[[\]]/.test(summary), 'no brackets left')
  assert.ok(!/M5-no-track-record|M3D-team-incomplete|Details!|Balance Sheet!/.test(summary), 'no ids or cells left in the wording')
  assert.match(summary, /roles is identified\. Reported firm cash increased to \$900,000 from \$700,000/, 'sentences run on cleanly')
  assert.match(summary, /other funding; the unidentified team and unclarified other funding are the first items to resolve\.$/)
  assert.deepEqual(summary_pointers, ['Development Project 1 Details!E5', 'M5-no-track-record', 'M3D-team-incomplete', 'Balance Sheet!B9', 'Balance Sheet!D9', 'Balance Sheet!B47', 'Balance Sheet!D47', 'Development Project 1 Details!F28', 'Development Project 1 Details!F29', 'Development Project 1 Details!F30'])
  assert.equal(r.answer.unverified, undefined, 'every figure is in the data')
})

test('the summary’s own evidence fields are used, and only real ones are kept', () => {
  const r = validateAnswer(reply({ summary: 'Plain summary with $900,000.', summary_evidence: { flag_ids: ['M5-no-track-record', 'M9-made-up'], cites: ['Balance Sheet!B9', 'Nowhere!Z9', 'M3D-team-incomplete'] } }), realPayload)
  assert.deepEqual(r.answer.summary_pointers, ['M5-no-track-record', 'Balance Sheet!B9', 'M3D-team-incomplete'])
  assert.equal(r.answer.summary, 'Plain summary with $900,000.')
  const none = validateAnswer(reply({ summary: 'Plain.' }), realPayload)
  assert.deepEqual(none.answer.summary_pointers, [], 'no evidence given is an empty list, not a failure')
})

test('only a bracket holding nothing but sources is removed: labels, ordinary brackets and mixed ones stay', () => {
  const r = validateAnswer(reply({ summary: 'Ask [Project A] (about 4 months late) and see [below; M5-no-track-record] for more.' }), realPayload)
  assert.equal(r.answer.summary, 'Ask [Project A] (about 4 months late) and see [below; M5-no-track-record] for more.')
  assert.deepEqual(r.answer.summary_pointers, [])
})

test('sources in parentheses are handled too, and sources inside other statements join that statement’s own evidence', () => {
  const r = validateAnswer(reply({
    summary: 'Cash is up (Balance Sheet!B9; M5-no-track-record).',
    connections: [{ headline: 'One cause [M3D-team-incomplete]', explanation: 'These share a cause (M5-no-track-record; Development Project 1 Details!E5).', flag_ids: [], check_first: null, cites: [] }],
    look_first: [{ flag_id: 'not-real', reason: 'Read this one first [M5-no-track-record].' }],
    questions: [{ question: 'Who guarantees the loan? [M3D-team-incomplete]', reason: '', flag_ids: [] }],
    integrity_screen: [{ title: 'A cell looks odd', why: 'It does not fit [Balance Sheet!D9].', cites: [], confidence: 'low' }],
    confidence_reason: 'Thin evidence [M5-no-track-record].',
  }), realPayload)
  assert.equal(r.answer.summary, 'Cash is up.')
  assert.deepEqual(r.answer.summary_pointers, ['Balance Sheet!B9', 'M5-no-track-record'])
  const c = r.answer.connections[0]
  assert.equal(c.headline, 'One cause')
  assert.equal(c.explanation, 'These share a cause.')
  assert.deepEqual(c.flag_ids, ['M3D-team-incomplete', 'M5-no-track-record'])
  assert.deepEqual(c.cites, ['M3D-team-incomplete', 'M5-no-track-record', 'Development Project 1 Details!E5'])
  assert.deepEqual(r.answer.look_first, [{ flag_id: 'M5-no-track-record', reason: 'Read this one first.' }])
  assert.equal(r.answer.questions[0].question, 'Who guarantees the loan?')
  assert.deepEqual(r.answer.questions[0].flag_ids, ['M3D-team-incomplete'])
  assert.deepEqual(r.answer.integrity_screen[0].cites, ['Balance Sheet!D9'])
  assert.equal(r.answer.integrity_screen[0].why, 'It does not fit.')
  assert.equal(r.answer.confidence_reason, 'Thin evidence.')
  assert.deepEqual(r.dropped, [])
})

test('sources the AI made up are removed from the wording and then ignored, so they cannot make a statement look backed', () => {
  const r = validateAnswer(reply({ connections: [{ headline: 'Invented', explanation: 'Points at nothing [M9-made-up; Nowhere!A1].', flag_ids: [], check_first: null, cites: [] }] }), realPayload)
  assert.equal(r.answer.connections.length, 0, 'no real pointer, so the statement is removed')
  assert.match(r.dropped[0].reason, /no real finding/)
})

test('extractCitations: spacing and punctuation are tidied, and text with nothing to take out is unchanged', () => {
  assert.deepEqual(extractCitations('One. [Balance Sheet!B9] Two.'), { text: 'One. Two.', pointers: ['Balance Sheet!B9'] })
  assert.deepEqual(extractCitations('Ends here [M5-no-track-record].'), { text: 'Ends here.', pointers: ['M5-no-track-record'] })
  assert.deepEqual(extractCitations('Repeated [M1-a-b] and again [M1-a-b; Tab!A1].'), { text: 'Repeated and again.', pointers: ['M1-a-b', 'Tab!A1'] })
  assert.deepEqual(extractCitations('Nothing to take out.'), { text: 'Nothing to take out.', pointers: [] })
  assert.deepEqual(extractCitations('A [Project A] label (and 2 more).'), { text: 'A [Project A] label (and 2 more).', pointers: [] })
  assert.deepEqual(extractCitations('Cell with comma-free tab [Consol Financials & Projections!E9].'), { text: 'Cell with comma-free tab.', pointers: ['Consol Financials & Projections!E9'] })
})

test('figures are read cleanly: a comma, full stop or bracket after a figure is not part of it, and thousands are grouped properly', () => {
  assert.deepEqual(figuresIn('Cash $900,000, then 3.5%, and 2.71×. Also $5,550,000; and (1,234.50).', true).map((f) => f.raw), ['$900,000', '3.5%', '2.71', '$5,550,000', '1,234.50'])
  assert.deepEqual(figuresIn('Cash $900,000, then $700,000, yet $20,000.', true).map((f) => f.key), ['900000', '700000', '20000'])
  assert.deepEqual(figuresIn('Sources 5550000 and 12,5 and 1,23,456.').map((f) => f.key), ['5550000', '12', '5', '1', '23456'], 'only proper three-digit groups join into one figure: 12,5 is two numbers, 23,456 is one')
})
