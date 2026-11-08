// M6: Synthesis (layer 6, shared). "What should the reviewer look at first, and what do we ask the sponsor?"
//
//   synthesize(project, moduleResults, context) -> { ranked, followUps, notes, counts, coverage, headline }
//   followUpList(ranked) -> ['1. question', '2. question', ...]   plain text, ready to paste into an email
//   followUpText(ranked, project) -> one block of text (a short opening line, then the numbered questions)
//   layersCovered(moduleResults, stage) -> which of the six layers were checked and which were not run
//   run(project, context) -> { flags: [], notes }                  the shared module interface (section 1d)
//
// M6 never calls another module. It reads what the others returned: an array of { module, flags, notes }, usually the
// output of each module's guarded run(). Anything in that array may be missing or malformed; that becomes a visible note
// (and one medium M6 flag, so it cannot be missed), never a crash. M6 never drops a readable flag, and never lowers one.
//
// context (all optional):
//   impacts   { [flagId]: dollars }  how much each flag could move the downside case, if the caller knows it
//   downside  { debtService }        yearly loan payments in the downside case, to turn a DSCR shortfall into dollars
//   settings  { minDscr }            the lender's minimum DSCR, used when a flag's evidence names a DSCR but no minimum

import { SEVERITIES, MODULE_LAYERS, STAGE_VALUES, compareSeverity, validateFlag, makeFlag } from '../shared/index.js'

export const MODULE_ID = 'M6'

// The six questions (section 0), in plain words.
export const LAYERS = [
  { layer: 1, name: 'Integrity', question: 'Is the data valid?' },
  { layer: 2, name: 'Benchmarking', question: 'How does it compare with the market?' },
  { layer: 3, name: 'Risk checks', question: 'What can go wrong?' },
  { layer: 4, name: 'Scenarios', question: 'What happens in the downside, base and upside cases?' },
  { layer: 5, name: 'Sponsor and portfolio', question: 'Can this sponsor deliver, and absorb a miss?' },
  { layer: 6, name: 'Synthesis', question: 'What should the reviewer look at first?' },
]

const MODULE_NAMES = {
  M1: 'Integrity checks',
  M2: 'Benchmarking',
  M3D: 'Development risk',
  M3C: 'Completed risk',
  M3T: 'Transition checks',
  M4: 'Scenarios',
  M5: 'Sponsor and portfolio',
  M6: 'Synthesis',
}
export const moduleName = (module) => MODULE_NAMES[baseModule(module)] ?? String(module)

// Which risk modules (layer 3) apply to each stage (section 2, M3).
const RISK_MODULES_FOR = {
  development: ['M3D', 'M3T'],
  lease_up: ['M3D', 'M3C', 'M3T'],
  completed: ['M3C', 'M3T'],
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const baseModule = (m) => (typeof m === 'string' ? m.replace(/-[a-z]$/, '') : '')
const knownModule = (m) => typeof m === 'string' && /^M\d[A-Z]?(-[a-z])?$/.test(m) && baseModule(m) in MODULE_LAYERS
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const stageOf = (project) => {
  try {
    const s = project?.data?.stage?.stage
    return STAGE_VALUES.includes(s) ? s : null
  } catch {
    return null
  }
}

// Flags about the tool itself (a module that crashed, or M6's own note about unreadable results) are for the review team,
// not the sponsor, so their questions stay out of the sponsor list.
export const isInternal = (item) => item.module === MODULE_ID || /-check-failed$/.test(item.id)

// ---- Reading the module results ---------------------------------------------------------------------------------

// Every readable flag from every module result, plus plain notes about anything that could not be read.
function collect(moduleResults) {
  const notes = []
  const flags = [] // { flag, from, order }
  const ran = new Set()
  let unreadable = 0

  if (moduleResults === undefined || moduleResults === null) {
    notes.push('No results from the other checks were given, so there is nothing to rank yet.')
    return { flags, notes, ran, unreadable }
  }
  if (!Array.isArray(moduleResults)) {
    notes.push('The results from the other checks were not a list, so they could not be read.')
    return { flags, notes, ran, unreadable: 1 }
  }

  moduleResults.forEach((result, i) => {
    let label = `Result ${i + 1}`
    try {
      if (!isObject(result)) {
        unreadable++
        notes.push(`${label} is empty or not a module result, so it was skipped.`)
        return
      }
      const module = knownModule(result.module) ? result.module : null
      if (module) label = `${module} (${moduleName(module)})`
      else notes.push(`${label} does not say which module it came from${result.module ? ` ("${String(result.module).slice(0, 20)}" is not a module)` : ''}; its flags are kept under their own module names.`)

      if (Array.isArray(result.notes)) {
        for (const n of result.notes.slice(0, 50)) if (typeof n === 'string' && n.trim()) notes.push(`${module ?? label}: ${n.trim()}`)
      }

      if (!Array.isArray(result.flags)) {
        unreadable++
        notes.push(`${label} did not return a list of flags, so its findings are missing. Review that layer by hand.`)
        return
      }
      if (module) ran.add(baseModule(module))

      let dropped = 0
      result.flags.slice(0, 1000).forEach((flag) => {
        const problems = validateFlag(flag)
        if (problems.length) {
          dropped++
          return
        }
        const clean = makeFlag(flag) // a frozen, complete copy
        ran.add(baseModule(clean.module))
        if (module && baseModule(clean.module) !== baseModule(module)) {
          notes.push(`${label} passed on a flag from ${clean.module} (${clean.id}); it is kept under ${clean.module}.`)
        }
        flags.push({ flag: clean, order: flags.length })
      })
      if (result.flags.length > 1000) notes.push(`${label} returned ${result.flags.length} flags; only the first 1,000 were read.`)
      if (dropped) {
        unreadable++
        notes.push(`${label} returned ${plural(dropped, 'flag')} that could not be read, so ${dropped === 1 ? 'it was' : 'they were'} left out. Review that layer by hand.`)
      }
    } catch {
      unreadable++
      notes.push(`${label} could not be read, so it was skipped. Review that layer by hand.`)
    }
  })
  return { flags, notes, ran, unreadable }
}

// Same id from two places: keep one, the most serious (the first seen wins a tie), and remember who else reported it.
function dedupe(collected) {
  const byId = new Map()
  let removed = 0
  for (const entry of collected) {
    const { flag } = entry
    const prev = byId.get(flag.id)
    if (!prev) {
      byId.set(flag.id, { ...entry, reportedBy: [flag.module], merged: 0 })
      continue
    }
    removed++
    const reportedBy = prev.reportedBy.includes(flag.module) ? prev.reportedBy : [...prev.reportedBy, flag.module]
    const keepNew = compareSeverity(flag.severity, prev.flag.severity) < 0
    byId.set(flag.id, { flag: keepNew ? flag : prev.flag, order: prev.order, reportedBy, merged: prev.merged + 1 })
  }
  return { unique: [...byId.values()], removed }
}

// ---- How much each flag could move the downside case --------------------------------------------------------------

const NUMBER = String.raw`\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`
const NOT_PERCENT = String.raw`(?![\d,.]*\s?%)`
// "Funding gap $250,000", "Short by $40,000 a year", "shortfall of $12,000", "overrun $300,000"
const AFTER_WORD = new RegExp(String.raw`(?:funding gap|gap of|short by|shortfall of|shortfall|overrun of|missing)\s*:?\s*${NUMBER}${NOT_PERCENT}`, 'gi')
// "a 350,000 gap", "$350,000 short", "$40,000 a year shortfall"
const BEFORE_WORD = new RegExp(String.raw`${NUMBER}${NOT_PERCENT}\s*(?:a year\s*)?(?:funding\s+)?(?:gap|short(?:fall)?)\b`, 'gi')
// "DSCR 1.09 vs a 1.20 minimum", "DSCR 1.10× against the lender's minimum of 1.20×"
const DSCR_VS = /DSCR\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*[x×]?\s*(?:vs\.?|versus|against|below|under)[^\d\n]{0,50}?(\d+(?:\.\d+)?)/i

const toNumber = (s) => Number(String(s).replace(/[$,\s]/g, ''))

// The largest dollar gap or shortfall the evidence names, or null. Percentages are never read as dollars.
export function dollarsFromEvidence(text) {
  if (typeof text !== 'string') return null
  let best = null
  for (const re of [AFTER_WORD, BEFORE_WORD]) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const n = toNumber(m[1])
      if (isNum(n) && n >= 100 && (best === null || n > best)) best = n
    }
  }
  return best
}

// How far a DSCR in the evidence sits under its minimum (for example 0.11 for "DSCR 1.09 vs 1.20"), or null.
export function dscrShortfallFromEvidence(text, minDscr) {
  if (typeof text !== 'string') return null
  const m = text.match(DSCR_VS)
  if (m) {
    const [dscr, min] = [Number(m[1]), Number(m[2])]
    if (isNum(dscr) && isNum(min) && min > dscr && min < 10) return min - dscr
    return null
  }
  const lone = text.match(/DSCR\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*[x×]?/i)
  if (lone && isNum(minDscr)) {
    const d = Number(lone[1])
    if (isNum(d) && minDscr > d) return minDscr - d
  }
  return null
}

// The estimated downside effect of one flag: { kind: 'dollars' | 'dscr' | 'unknown', value, text, basis }.
export function downsideImpact(flag, context = {}) {
  const ctx = isObject(context) ? context : {}
  const given = isObject(ctx.impacts) ? ctx.impacts[flag.id] : undefined
  if (isNum(given) && given > 0) {
    return { kind: 'dollars', value: given, text: `Could move the downside case by about ${usd(given)}.`, basis: 'given' }
  }
  const dollars = dollarsFromEvidence(flag.evidence)
  if (dollars !== null) {
    return { kind: 'dollars', value: dollars, text: `Could move the downside case by about ${usd(dollars)} (from the evidence).`, basis: 'evidence' }
  }
  const minDscr = isObject(ctx.settings) && isNum(ctx.settings.minDscr) ? ctx.settings.minDscr : null
  const gap = dscrShortfallFromEvidence(flag.evidence, minDscr)
  if (gap !== null) {
    const ds = isObject(ctx.downside) && isNum(ctx.downside.debtService) && ctx.downside.debtService > 0 ? ctx.downside.debtService : null
    if (ds) {
      const value = gap * ds
      return { kind: 'dollars', value, text: `Coverage is ${gap.toFixed(2)}x under the minimum: about ${usd(value)} a year of income missing.`, basis: 'dscr' }
    }
    return { kind: 'dscr', value: gap, text: `Coverage is ${gap.toFixed(2)}x under the minimum.`, basis: 'evidence' }
  }
  return { kind: 'unknown', value: null, text: 'Effect on the downside case not known.', basis: 'none' }
}

const IMPACT_TIER = { dollars: 0, dscr: 1, unknown: 2 }

// Most serious first; within a severity, the largest known downside effect first (dollars, then DSCR shortfall); then by
// layer (data problems before market comparisons, and so on); then in the order the modules reported them.
function compareItems(a, b) {
  return (
    compareSeverity(a.severity, b.severity) ||
    IMPACT_TIER[a.impact.kind] - IMPACT_TIER[b.impact.kind] ||
    (b.impact.value ?? 0) - (a.impact.value ?? 0) ||
    a.layer - b.layer ||
    a.order - b.order
  )
}

// ---- Layers covered ---------------------------------------------------------------------------------------------

// Which of the six layers were checked for this project and which were not run. Layer 3 counts as checked only when every
// risk module that applies to the stage ran (for a project with no stage, all three are expected). Layer 6 is M6 itself.
export function layersCovered(moduleResults, stage) {
  const ran = new Set()
  if (Array.isArray(moduleResults)) {
    for (const r of moduleResults) {
      try {
        if (isObject(r) && knownModule(r.module) && Array.isArray(r.flags)) ran.add(baseModule(r.module))
      } catch {
        // an unreadable result does not count as run
      }
    }
  }
  ran.add(MODULE_ID)
  const riskModules = RISK_MODULES_FOR[stage] ?? ['M3D', 'M3C', 'M3T']
  const expected = { 1: ['M1'], 2: ['M2'], 3: riskModules, 4: ['M4'], 5: ['M5'], 6: ['M6'] }

  const layers = LAYERS.map((l) => {
    const want = expected[l.layer]
    const missing = want.filter((m) => !ran.has(m))
    return { ...l, modules: want, missing, checked: missing.length === 0, partly: missing.length > 0 && missing.length < want.length }
  })
  const checked = layers.filter((l) => l.checked)
  const notRun = layers.filter((l) => !l.checked)
  const describe = (l) => (l.partly ? `${l.layer} ${l.name} (${l.missing.map(moduleName).join(', ').toLowerCase()} not run)` : `${l.layer} ${l.name}`)
  const sentence = notRun.length
    ? `Not run yet: layer${notRun.length === 1 ? '' : 's'} ${notRun.map(describe).join('; ')}. Findings from ${notRun.length === 1 ? 'that layer' : 'those layers'} are missing from this list.`
    : 'All six layers were checked.'
  return { layers, checked, notRun, sentence }
}

// ---- Putting it together ----------------------------------------------------------------------------------------

function headlineFor(ranked, counts) {
  if (!ranked.length) return 'Nothing was flagged by the checks that ran.'
  const serious = (i) => i.severity === 'high' || i.severity === 'medium'
  const projectSerious = ranked.some((i) => serious(i) && i.layer <= 4 && !isInternal(i))
  const sponsorHigh = ranked.some((i) => i.severity === 'high' && i.layer === 5)
  if (!projectSerious && sponsorHigh) return 'The project looks sound on its own numbers, but the sponsor is a serious risk.'
  const parts = SEVERITIES.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`)
  return `${plural(ranked.length, 'item')} to review: ${parts.join(', ')}. Start at the top.`
}

export function synthesize(project, moduleResults, context) {
  const stage = stageOf(project)
  const { flags, notes: readNotes, unreadable } = collect(moduleResults)
  const { unique, removed } = dedupe(flags)
  const notes = []
  const ctx = isObject(context) ? context : {}

  if (unreadable) {
    // A visible flag, so a missing layer cannot hide at the bottom of the notes.
    const flag = makeFlag({
      id: 'M6-results-unreadable',
      module: MODULE_ID,
      stage_used: stage ?? 'development',
      severity: 'medium',
      title: 'Some findings from the other checks could not be read, so this list may be incomplete.',
      evidence: `${plural(unreadable, 'module result')} could not be read in full. The notes below name which.`,
      follow_up: 'Ask whoever maintains this tool to look at the notes, and review the missing layers by hand in the meantime.',
    })
    unique.push({ flag, order: unique.length, reportedBy: [MODULE_ID], merged: 0 })
  }

  let ranked = unique.map(({ flag, order, reportedBy, merged }) => ({
    ...flag,
    cell_refs: [...flag.cell_refs],
    order,
    reportedBy,
    merged,
    impact: downsideImpact(flag, ctx),
  }))
  ranked.sort(compareItems)
  ranked = ranked.map((item, i) => {
    const rest = { ...item }
    delete rest.order
    return Object.freeze({ rank: i + 1, ...rest })
  })

  const counts = { total: ranked.length, high: 0, medium: 0, low: 0, duplicatesRemoved: removed, unreadable }
  for (const item of ranked) counts[item.severity]++

  if (!stage) notes.push('This project has no stage yet, so the stage-specific risk checks may not have run.')
  if (removed) notes.push(`${plural(removed, 'duplicate flag')} removed (the same finding reported twice); the most serious copy is kept.`)
  const known = ranked.filter((i) => i.impact.kind !== 'unknown').length
  if (ranked.length > 1) {
    notes.push(
      known
        ? `Ranked by seriousness, then by how much each could move the downside case. ${known} of ${ranked.length} items have a known effect; the rest keep their order by layer.`
        : 'Ranked by seriousness. None of the items say how much they could move the downside case, so within each level they are in layer order.',
    )
  }
  const coverage = layersCovered(moduleResults, stage)

  return {
    stage,
    ranked,
    followUps: followUpList(ranked),
    notes: [...notes, ...readNotes],
    counts,
    coverage,
    headline: headlineFor(ranked, counts),
  }
}

// ---- Follow-up questions for the sponsor --------------------------------------------------------------------------

// Plain text that survives being pasted into any email: straight quotes, plain dashes and spaces, no markup, one line.
export function plainText(s) {
  return String(s ?? '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/×/g, 'x')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[*_`#>|~]/g, '')
    // eslint-disable-next-line no-control-regex -- removing control characters (line breaks, tabs) is the point
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// The follow-up questions, numbered, most serious first, each asked once. Questions about the tool itself are left out.
export function followUpList(ranked) {
  if (!Array.isArray(ranked)) return []
  const items = ranked
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => isObject(item) && typeof item.follow_up === 'string' && typeof item.id === 'string' && !isInternal(item))
    .sort((a, b) => compareSeverity(a.item.severity, b.item.severity) || a.i - b.i)
  const seen = new Set()
  const lines = []
  for (const { item } of items) {
    const text = plainText(item.follow_up)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    lines.push(`${lines.length + 1}. ${text}`)
  }
  return lines
}

// The whole block to paste into an email to the sponsor.
export function followUpText(ranked, project) {
  const lines = followUpList(ranked)
  if (!lines.length) return ''
  let name = ''
  try {
    name = plainText(project?.data?.identity?.name)
  } catch {
    name = ''
  }
  const opening = `Questions about ${name || 'the project'}:`
  return [opening, '', ...lines].join('\n')
}

// ---- The shared module interface --------------------------------------------------------------------------------

// M6 raises no flags of its own from a project: it works on the other modules' results through synthesize().
export function run() {
  return {
    flags: [],
    notes: ['M6 does not check the project itself. It ranks the other modules’ flags: call synthesize(project, moduleResults, context).'],
  }
}
