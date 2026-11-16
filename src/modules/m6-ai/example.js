// A layout example for the AI screen, so the screen can be looked at (on a phone, in a browser check) without calling the AI.
// It says what it is in every sentence. It uses real flag ids from the review so the flag chips draw properly, but it makes no
// statement about the project and is always labelled "EXAMPLE LAYOUT" on screen.

export function exampleAnswer(flags = []) {
  const ids = flags.slice(0, 3).map((f) => f.id)
  const first = ids[0]
  const answer = {
    second_opinion: 'cannot_tell',
    summary: 'Example only. In a real answer, three to five plain sentences here would say what the biggest findings mean when read together.',
    summary_pointers: ids.slice(0, 2),
    connections: [],
    look_first: [],
    questions: [],
    integrity_screen: [],
    cannot_tell: [{ what: 'Example only: this is where the AI would say what it cannot tell from the data.', would_settle_it: 'Example only.' }],
    confidence: 'low',
    confidence_reason: 'This is not an AI answer.',
  }
  if (first) {
    answer.connections = [{ headline: 'Example connection', explanation: 'Example only: a short explanation of how two or more findings relate would appear here.', flag_ids: ids.slice(0, 2), check_first: first, cites: [] }]
    answer.look_first = [{ flag_id: first, reason: 'Example only: why this finding is worth reading first.' }]
    answer.questions = [{ question: 'Example only: a merged question for the sponsor would appear here.', reason: '', flag_ids: [first] }]
  }
  return answer
}
