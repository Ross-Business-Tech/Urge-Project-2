// Works out the "evidence" behind an AI answer, so the answer itself can read as plain prose and everything it relied on can sit
// together in one box after it, each piece connected to what it supports.
//
// The wording carries no sources at all. Every statement points (in separate fields) at findings and spreadsheet cells; here
// each one is given a number in the order the reader meets it, and for each piece of evidence we work out
//   - which ideas it supports: the summary, a connection, a "look first" item, a question, a data-screen concern;
//   - which of the figures in the answer it explains: "$900,000" is linked to the cell or finding that contains $900,000;
//   - for a spreadsheet cell, what the cell actually holds (its label and value).
// The figure links are worked out by comparing text, never by asking the AI, so they can be trusted as much as the data.

import { figuresIn } from './validate.js'

const titleOf = (flag) => String(flag?.title ?? '').replace(/[.\s]+$/, '')
const clip = (value, n = 70) => {
  const text = String(value ?? '')
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text
}

// Every statement of the answer, in the order it is read on screen, with what it points at and what it says.
function statements(answer, byId) {
  return [
    { label: 'The summary', pointers: answer.summary_pointers ?? [], texts: [answer.summary] },
    ...answer.connections.map((c) => ({ label: c.headline, pointers: [...(c.flag_ids ?? []), c.check_first, ...(c.cites ?? [])], texts: [c.headline, c.explanation] })),
    ...answer.look_first.map((l) => ({ label: `Look first: ${titleOf(byId.get(l.flag_id)) || l.flag_id}`, pointers: [l.flag_id], texts: [l.reason] })),
    ...answer.questions.map((q, i) => ({ label: `Question ${i + 1}: ${clip(q.question)}`, pointers: q.flag_ids ?? [], texts: [q.question, q.reason] })),
    ...answer.integrity_screen.map((i) => ({ label: `Data screen: ${i.title}`, pointers: i.cites ?? [], texts: [i.title, i.why] })),
  ]
}

// entries: every finding and cell the answer points at, numbered 1, 2, 3 in the order first met.
//   { n, kind: 'finding', flag, supports, figures } or { n, kind: 'cell', cell, label, value, supports, figures }
// data: the table of entered values that was sent ({ cell, label, value }), so a cell can say what it holds.
export function buildEvidence(answer, flags = [], data = []) {
  const byId = new Map(flags.map((f) => [f.id, f]))
  const byCell = new Map(data.map((d) => [d.cell, d]))
  const all = statements(answer, byId)

  // 1. number everything in reading order
  const entries = []
  const numberOf = new Map()
  for (const st of all) {
    for (const p of st.pointers) {
      if (typeof p !== 'string' || numberOf.has(p)) continue
      const n = entries.length + 1
      numberOf.set(p, n)
      if (byId.has(p)) entries.push({ n, kind: 'finding', flag: byId.get(p), supports: [], figures: [] })
      else entries.push({ n, kind: 'cell', cell: p, label: byCell.get(p)?.label ?? null, value: byCell.get(p)?.value ?? null, supports: [], figures: [] })
    }
  }

  // 2. which ideas each piece of evidence supports
  for (const st of all) {
    for (const p of st.pointers) {
      const e = entries[(numberOf.get(p) ?? 0) - 1]
      if (e && !e.supports.includes(st.label)) e.supports.push(st.label)
    }
  }

  // 3. which of the figures in the answer each piece of evidence explains
  const stated = new Map() // comparable figure -> the way the answer wrote it
  for (const st of all) for (const text of st.texts) for (const f of figuresIn(text ?? '', true)) if (!stated.has(f.key)) stated.set(f.key, f.raw)
  for (const e of entries) {
    const corpus = e.kind === 'finding' ? `${e.flag.title} ${e.flag.evidence}` : `${e.label ?? ''} ${e.value ?? ''}`
    const has = new Set(figuresIn(corpus).map((f) => f.key))
    e.figures = [...stated].filter(([key]) => has.has(key)).map(([, raw]) => raw)
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
