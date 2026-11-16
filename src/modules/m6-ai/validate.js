// Checks the AI's answer BEFORE it is shown. The AI advises; this decides what of its advice may appear.
//
//   1. The answer must be the expected structure (one JSON object).
//   2. Every statement must point to a real flag id or a real cell from what was sent. A statement whose pointers are all
//      made up is removed ("a claim without a citation is not allowed"), and made-up pointers inside a statement are cut.
//   3. Every figure in the AI's own words should appear in what was sent. A figure that does not is NOT silently trusted:
//      the statement is kept but marked "unverified", with the figures listed, so the reviewer sees the doubt.
//   4. Lists are capped, text is length-limited, and anything unknown is ignored.
//
// It never changes a rule's result and never adds anything the AI did not say.

export const CAPS = { connections: 5, look_first: 3, questions: 8, integrity_screen: 5, cannot_tell: 3 }
const OPINIONS = ['agrees', 'agrees_with_caveats', 'disagrees', 'cannot_tell']
const CONFIDENCE = ['high', 'medium', 'low']

const MAX = { summary: 1200, headline: 160, explanation: 600, reason: 400, question: 300, title: 160, why: 500, what: 300, settle: 300, confidence_reason: 300, cite: 200 }

// Control characters are removed, except line breaks and tabs.
const str = (v, max) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim().slice(0, max) : '')
const list = (v) => (Array.isArray(v) ? v : [])

// ---- figures ----------------------------------------------------------------------------------------------------------

// Thousands are read as groups of three digits, so a comma that follows a figure in a sentence ("$700,000, yet...") is not part of it.
const NUMBER = /(\$?)(\d+(?:,\d{3})*(?:\.\d+)?)(\s?%?)/g

function normalize(token) {
  let t = token.replace(/,/g, '')
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '')
  return t
}

// Every figure in a piece of text, in a comparable form. `onlyNotable` keeps just the ones worth checking: a dollar amount, a
// percentage, a decimal, or a number of four or more digits. A bare small count ("three flags") is not a claim about the data.
export function figuresIn(text, onlyNotable = false) {
  const out = []
  for (const m of String(text).matchAll(NUMBER)) {
    const [, dollar, digits, pct] = m
    const notable = Boolean(dollar) || pct.includes('%') || digits.includes('.') || digits.replace(/[^0-9]/g, '').length >= 4
    if (onlyNotable && !notable) continue
    out.push({ raw: m[0].trim(), key: normalize(digits) })
  }
  return out
}

// Every figure that appears anywhere in what was sent.
export function figuresSent(payload) {
  const seen = new Set()
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) seen.add(normalize(String(v)))
    else if (typeof v === 'string') for (const f of figuresIn(v)) seen.add(f.key)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(payload)
  return seen
}

// ---- citations written into sentences ----------------------------------------------------------------------------------

// The AI is told never to write sources inside a sentence, but if it does ("... roles identified. [Balance Sheet!B9; M5-no-track-record]")
// they are taken out of the wording, and kept as evidence. Only a bracket or parenthesis holding NOTHING BUT flag ids and cell
// references is touched: a label such as [Project A], or "(about 4 months)", is left alone.
const FLAG_ID = /^M\d[A-Z]?(?:-[a-z])?(?:-[A-Za-z0-9]+)+$/
const CELL_REF = /^[^![\]()]+![A-Z]{1,3}\d+$/

export function extractCitations(text) {
  const pointers = []
  const cleaned = String(text)
    .replace(/\s*[[(]([^[\]()]*)[\])]/g, (whole, inner) => {
      const tokens = inner.split(/[;,]/).map((t) => t.trim()).filter(Boolean)
      if (tokens.length === 0 || !tokens.every((t) => FLAG_ID.test(t) || CELL_REF.test(t))) return whole
      pointers.push(...tokens)
      return ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
  return { text: cleaned, pointers: pointers.filter((p, i, a) => a.indexOf(p) === i) }
}

// ---- pointers ---------------------------------------------------------------------------------------------------------

function pointersOf(payload) {
  const ids = new Set()
  const cells = new Set()
  for (const f of list(payload?.flags)) {
    if (typeof f?.id === 'string') ids.add(f.id)
    for (const c of list(f?.cell_refs)) if (typeof c === 'string') cells.add(c)
  }
  for (const d of list(payload?.data)) if (typeof d?.cell === 'string') cells.add(d.cell)
  return { ids, cells }
}

// ---- the answer -------------------------------------------------------------------------------------------------------

// Models sometimes wrap JSON in a code fence even when told not to.
function parseJson(text) {
  const raw = String(text ?? '').trim()
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(unfenced)
  } catch {
    return undefined
  }
}

export function validateAnswer(text, payload) {
  const parsed = parseJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'The AI answer was not in the expected structure, so nothing from it is shown. Try again.' }
  }
  if (!OPINIONS.includes(parsed.second_opinion)) {
    return { ok: false, reason: 'The AI answer did not include a clear second opinion, so nothing from it is shown. Try again.' }
  }

  const { ids, cells } = pointersOf(payload)
  const known = figuresSent(payload)
  const dropped = []
  let unverifiedCount = 0

  const unverifiedIn = (...texts) => {
    const bad = []
    for (const t of texts) for (const f of figuresIn(t, true)) if (!known.has(f.key) && !bad.includes(f.raw)) bad.push(f.raw)
    if (bad.length) unverifiedCount++
    return bad
  }
  const idsOf = (v) => list(v).filter((x) => typeof x === 'string' && ids.has(x)).filter((x, i, a) => a.indexOf(x) === i)
  const citesOf = (v) => list(v).map((x) => str(x, MAX.cite)).filter((x) => ids.has(x) || cells.has(x)).filter((x, i, a) => a.indexOf(x) === i)
  const mark = (item, ...texts) => {
    const bad = unverifiedIn(...texts)
    return bad.length ? { ...item, unverified: bad } : item
  }
  const cap = (section, items) => {
    if (items.length > CAPS[section]) dropped.push({ section, reason: `only the first ${CAPS[section]} are shown` })
    return items.slice(0, CAPS[section])
  }
  const drop = (section, reason) => dropped.push({ section, reason })

  // Text with any sources written into it taken out. The sources it held are returned as `found`, to be kept as evidence.
  const plain = (value, max) => {
    const { text, pointers } = extractCitations(str(value, max))
    return { text, found: pointers }
  }
  const validIds = (pointers) => pointers.filter((x) => ids.has(x))
  const unique = (list2) => list2.filter((x, i, a) => a.indexOf(x) === i)

  const summaryText = plain(parsed.summary, MAX.summary)
  const summary = summaryText.text
  if (!summary) return { ok: false, reason: 'The AI answer had no summary, so nothing from it is shown. Try again.' }
  // What stands behind the summary: its own evidence fields, plus anything it wrote into the sentences.
  const summary_pointers = unique([...idsOf(parsed.summary_evidence?.flag_ids), ...citesOf(parsed.summary_evidence?.cites), ...citesOf(summaryText.found)])

  const connections = []
  for (const c of list(parsed.connections)) {
    const headline = plain(c?.headline, MAX.headline)
    const explanation = plain(c?.explanation, MAX.explanation)
    const found = [...headline.found, ...explanation.found]
    const flag_ids = idsOf([...list(c?.flag_ids), ...validIds(found)])
    if (!headline.text || !explanation.text) { drop('connections', 'an item was incomplete'); continue }
    if (flag_ids.length === 0) { drop('connections', 'a statement pointed at no real finding'); continue }
    const check_first = ids.has(c?.check_first) ? c.check_first : flag_ids[0]
    connections.push(mark({ headline: headline.text, explanation: explanation.text, flag_ids, check_first, cites: citesOf([...list(c?.cites), ...found]) }, headline.text, explanation.text))
  }

  const look_first = []
  for (const l of list(parsed.look_first)) {
    const reason = plain(l?.reason, MAX.reason)
    const flag_id = ids.has(l?.flag_id) ? l.flag_id : validIds(reason.found)[0]
    if (!flag_id || !reason.text) { drop('look_first', 'an item pointed at no real finding'); continue }
    look_first.push(mark({ flag_id, reason: reason.text }, reason.text))
  }

  const questions = []
  const seenQuestions = new Set()
  for (const q of list(parsed.questions)) {
    const question = plain(q?.question, MAX.question)
    const reason = plain(q?.reason, MAX.reason)
    const flag_ids = idsOf([...list(q?.flag_ids), ...validIds([...question.found, ...reason.found])])
    if (!question.text) { drop('questions', 'an item was incomplete'); continue }
    if (flag_ids.length === 0) { drop('questions', 'a question pointed at no real finding'); continue }
    const dedupe = question.text.toLowerCase().replace(/\s+/g, ' ')
    if (seenQuestions.has(dedupe)) continue
    seenQuestions.add(dedupe)
    questions.push(mark({ question: question.text, reason: reason.text, flag_ids }, question.text, reason.text))
  }

  const integrity_screen = []
  for (const i of list(parsed.integrity_screen)) {
    const title = plain(i?.title, MAX.title)
    const why = plain(i?.why, MAX.why)
    const cites = citesOf([...list(i?.cites), ...title.found, ...why.found])
    if (!title.text || !why.text) { drop('integrity_screen', 'an item was incomplete'); continue }
    if (cites.length === 0) { drop('integrity_screen', 'a concern cited no real finding or cell'); continue }
    integrity_screen.push(mark({ title: title.text, why: why.text, cites, confidence: CONFIDENCE.includes(i?.confidence) ? i.confidence : 'low' }, title.text, why.text))
  }

  const cannot_tell = []
  for (const c of list(parsed.cannot_tell)) {
    const what = plain(c?.what, MAX.what).text
    if (!what) continue
    cannot_tell.push({ what, would_settle_it: plain(c?.would_settle_it, MAX.settle).text })
  }

  const answer = {
    second_opinion: parsed.second_opinion,
    ...mark({ summary }, summary),
    summary_pointers,
    connections: cap('connections', connections),
    look_first: cap('look_first', look_first),
    questions: cap('questions', questions),
    integrity_screen: cap('integrity_screen', integrity_screen),
    cannot_tell: cap('cannot_tell', cannot_tell),
    confidence: CONFIDENCE.includes(parsed.confidence) ? parsed.confidence : 'low',
    confidence_reason: plain(parsed.confidence_reason, MAX.confidence_reason).text,
  }
  return { ok: true, answer, dropped, unverifiedCount }
}
