// Works out the "evidence" behind an AI answer, so the answer itself can read as plain prose and the findings and cells it relied on
// can sit together in one box at the end.
//
// Every statement in an answer points at findings (flag ids) or spreadsheet cells. Rather than printing those pointers in the
// middle of the sentences, each one is given a number in the order the reader first meets it, and a statement just says
// "evidence 1, 3". The numbers are the same in the prose and in the box.

// The pointers of one statement, in the order they should be numbered: findings first, then the "check first" finding, then
// anything else it cited.
const pointersOf = {
  connection: (c) => [...(c.flag_ids ?? []), c.check_first, ...(c.cites ?? [])],
  lookFirst: (l) => [l.flag_id],
  question: (q) => q.flag_ids ?? [],
  integrity: (i) => i.cites ?? [],
}

// Reading order on screen: connections, look first, questions, then the data screen.
function readingOrder(answer) {
  return [
    ...answer.connections.map(pointersOf.connection),
    ...answer.look_first.map(pointersOf.lookFirst),
    ...answer.questions.map(pointersOf.question),
    ...answer.integrity_screen.map(pointersOf.integrity),
  ]
}

// entries: every finding and cell the answer points at, numbered 1, 2, 3 in the order first met.
//   { n, kind: 'finding', flag } or { n, kind: 'cell', cell }
export function buildEvidence(answer, flags = []) {
  const byId = new Map(flags.map((f) => [f.id, f]))
  const entries = []
  const numberOf = new Map()

  for (const pointers of readingOrder(answer)) {
    for (const p of pointers) {
      if (typeof p !== 'string' || numberOf.has(p)) continue
      const n = entries.length + 1
      numberOf.set(p, n)
      entries.push(byId.has(p) ? { n, kind: 'finding', flag: byId.get(p) } : { n, kind: 'cell', cell: p })
    }
  }

  // The numbers for the pointers of one statement, ascending, without repeats.
  const numbersFor = (...groups) => {
    const out = []
    for (const p of groups.flat()) {
      const n = numberOf.get(p)
      if (n !== undefined && !out.includes(n)) out.push(n)
    }
    return out.sort((a, b) => a - b)
  }
  return { entries, findings: entries.filter((e) => e.kind === 'finding'), cells: entries.filter((e) => e.kind === 'cell'), numbersFor }
}
