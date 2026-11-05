// The flag format and the helpers for making flags (section 1c and 1d of the module spec). Built by M0.
//
// Nine modules are built separately and then combined by M6, so a flag has to mean exactly the same thing whoever made it.
// A flag is created with `makeFlag`, which REFUSES a flag with any mistake (a severity of "critical", a missing question
// for the sponsor, a misspelled field) instead of passing it along for M6 to choke on. A finished flag is frozen, so one
// module cannot alter another's.
//
// Also here:
//  - createFlagMaker: makes flags for one module and one project (fills in the module and the stage).
//  - missingDataFlag / flagFromUnavailable: "if a check can't run because data is missing, return a low-severity flag
//    saying what's missing. Never crash and never skip silently."
//  - citeCells: the cell references for a flag, taken from where each value came from.
//  - guardModule: wraps a module's run(project, context) so a crash or malformed result becomes a flag, not a lost check.

import { STAGE_VALUES } from './projectStage.js'

export const SEVERITIES = ['high', 'medium', 'low']
export const TRANSITIONS = ['T1', 'T2', 'T3']

// Which layer each module belongs to. A split module (M3D-a, M3D-b) takes its parent's layer.
export const MODULE_LAYERS = { M1: 1, M2: 2, M3D: 3, M3C: 3, M3T: 3, M4: 4, M5: 5, M6: 6 }

// What each field means and its rule, in plain words. The "Flag format" page shows this, and a test checks it covers every field.
export const FLAG_FIELD_DOCS = [
  { field: 'id', meaning: 'A stable name for this finding.', rule: 'The module, then lowercase words joined by hyphens, such as M3D-contingency-low.' },
  { field: 'module', meaning: 'Which module raised it.', rule: 'M1, M2, M3D, M3C, M3T, M4, M5 or M6 (a split module may add -a or -b).' },
  { field: 'layer', meaning: 'Which of the six layers it belongs to.', rule: 'Filled in from the module, and must agree with it.' },
  { field: 'stage_used', meaning: 'The stage the check ran under.', rule: 'development, lease_up or completed.' },
  { field: 'severity', meaning: 'How serious it is.', rule: 'high, medium or low.' },
  { field: 'title', meaning: 'One sentence a business reader understands.', rule: 'Not blank, one line, at most 200 characters.' },
  { field: 'evidence', meaning: 'The numbers behind it, with the value and the comparison.', rule: 'Not blank, at most 1,000 characters.' },
  { field: 'cell_refs', meaning: 'Where the numbers come from, in spreadsheet terms.', rule: 'A list of up to 50 references such as Budget!C14.' },
  { field: 'follow_up', meaning: 'The question to put to the sponsor.', rule: 'Not blank, at most 500 characters.' },
  { field: 'transition', meaning: 'Which stage change it is about, if any.', rule: 'T1, T2, T3 or empty.' },
]

const FIELDS = ['id', 'module', 'layer', 'stage_used', 'severity', 'title', 'evidence', 'cell_refs', 'follow_up', 'transition']
const MAX = { title: 200, evidence: 1000, follow_up: 500, cell_ref: 200, cell_refs: 50 }

export class FlagError extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isSentence = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max
const baseModule = (module) => (typeof module === 'string' ? module.replace(/-[a-z]$/, '') : '')

// Most serious first.
export const compareSeverity = (a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b)

// A message-safe way to show any value (a Symbol or an object with a broken toString must not crash an error message).
const show = (v) => {
  try {
    return typeof v === 'symbol' ? v.toString() : String(v)
  } catch {
    return typeof v
  }
}

// Take ONE snapshot of a flag, and fill in what can be filled in: the layer from the module, an empty transition, an empty
// list of cells. Everything after this reads the snapshot, never the original, so an object whose fields change when read
// (a getter) cannot pass the checks and then produce something different. The snapshot has no prototype, so an own key
// named "__proto__" is an ordinary (and refused) unknown field instead of quietly supplying inherited values.
function normalized(fields) {
  const out = Object.create(null)
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.slice() : value
  }
  if (out.layer === undefined && MODULE_LAYERS[baseModule(out.module)] !== undefined) out.layer = MODULE_LAYERS[baseModule(out.module)]
  if (out.transition === undefined || out.transition === null) out.transition = ''
  if (out.cell_refs === undefined) out.cell_refs = []
  return out
}

// Every problem with a snapshot, in plain words.
function problemsOf(f) {
  const problems = []
  const unknown = Object.keys(f).filter((k) => !FIELDS.includes(k))
  if (unknown.length) problems.push(`These fields are not part of a flag: ${unknown.join(', ')}.`)

  const base = baseModule(f.module)
  const moduleOk = typeof f.module === 'string' && /^M\d[A-Z]?(-[a-z])?$/.test(f.module) && base in MODULE_LAYERS
  if (!moduleOk) problems.push('module must be one of M1, M2, M3D, M3C, M3T, M4, M5 or M6 (a split module may add -a or -b).')
  else if (f.layer !== MODULE_LAYERS[base]) problems.push(`layer ${show(f.layer)} does not match module ${f.module}, which is layer ${MODULE_LAYERS[base]}.`)

  if (!(typeof f.id === 'string' && /^[A-Za-z0-9]+(-[a-z0-9]+)+$/.test(f.id) && (!moduleOk || f.id.startsWith(`${base}-`)))) {
    problems.push(`id must be a stable name such as ${moduleOk ? base : 'M3D'}-contingency-low: it starts with the module, then lowercase words joined by hyphens.`)
  }
  if (!STAGE_VALUES.includes(f.stage_used)) problems.push('stage_used must be development, lease_up or completed.')
  if (!SEVERITIES.includes(f.severity)) problems.push('severity must be high, medium or low.')
  if (!isSentence(f.title, MAX.title) || /[\r\n]/.test(f.title)) problems.push(`title must be one plain sentence of at most ${MAX.title} characters.`)
  if (!isSentence(f.evidence, MAX.evidence)) problems.push(`evidence must state the numbers behind the flag (at most ${MAX.evidence} characters).`)
  if (!isSentence(f.follow_up, MAX.follow_up)) problems.push(`follow_up must be the question to put to the sponsor (at most ${MAX.follow_up} characters).`)
  if (!(Array.isArray(f.cell_refs) && f.cell_refs.length <= MAX.cell_refs && f.cell_refs.every((c) => isSentence(c, MAX.cell_ref)))) {
    problems.push(`cell_refs must be a list of up to ${MAX.cell_refs} cell references such as Budget!C14.`)
  }
  if (!(f.transition === '' || TRANSITIONS.includes(f.transition))) problems.push('transition must be T1, T2, T3 or empty.')
  return problems
}

const snapshotOf = (flag) => {
  try {
    return isObject(flag) ? normalized(flag) : null
  } catch {
    return null // an object that cannot even be read
  }
}

// Every problem with a flag, in plain words. An empty list means the flag is fine. Never throws.
export function validateFlag(flag) {
  if (!isObject(flag)) return ['A flag must be an object.']
  const f = snapshotOf(flag)
  return f ? problemsOf(f) : ['The flag could not be read.']
}

// Create a flag, or refuse with a FlagError that lists every problem.
export function makeFlag(fields) {
  if (!isObject(fields)) throw new FlagError('Not a valid flag: A flag must be an object.')
  const f = snapshotOf(fields)
  if (!f) throw new FlagError('Not a valid flag: The flag could not be read.')
  const problems = problemsOf(f)
  if (problems.length) throw new FlagError(`Not a valid flag: ${problems.join(' ')}`)
  return Object.freeze({
    id: f.id,
    module: f.module,
    layer: f.layer,
    stage_used: f.stage_used,
    severity: f.severity,
    title: f.title,
    evidence: f.evidence,
    cell_refs: Object.freeze([...f.cell_refs]),
    follow_up: f.follow_up,
    transition: f.transition,
  })
}

const knownModule = (module) => typeof module === 'string' && /^M\d[A-Z]?(-[a-z])?$/.test(module) && baseModule(module) in MODULE_LAYERS

// A flag maker for one module reviewing one project. It fills in the module and the stage the project was reviewed under.
// A lease-up project runs some development checks; pass stage_used: 'development' for those.
export function createFlagMaker(module, project) {
  if (!knownModule(module)) throw new FlagError(`${module} is not a module that raises flags.`)
  const stage = project?.data?.stage?.stage
  if (!STAGE_VALUES.includes(stage)) throw new FlagError('This project has no stage yet. The underwriter must choose one before it can be reviewed.')
  // A field passed as undefined counts as "not given", so it cannot wipe out the default stage.
  const given = (fields) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
  return { module, stage, flag: (fields) => makeFlag(isObject(fields) ? { stage_used: stage, ...given(fields), module } : fields) }
}

// "Could not be checked" flag: low severity, says what is missing.
export function missingDataFlag({ module, stage_used, check, checkTitle, missing, cell_refs = [], severity = 'low' }) {
  // Items often end in a full stop; drop it so they join cleanly with semicolons.
  const list = (Array.isArray(missing) ? missing : [missing]).filter(Boolean).map((m) => String(m).replace(/[.\s]+$/, ''))
  const what = list.join('; ')
  return makeFlag({
    id: `${module}-${check}-missing`,
    module,
    stage_used,
    severity,
    title: `${checkTitle} could not be checked.`,
    evidence: `Missing: ${what}`,
    cell_refs,
    follow_up: `Please provide the missing information: ${what}`,
  })
}

// A calculator result of "not available" becomes a flag. Returns null when the calculator worked. A refused (implausible)
// input can be flagged more seriously by passing a severity.
export function flagFromUnavailable(result, { module, stage_used, check, checkTitle, severity = 'low' }) {
  if (result.ok) return null
  const fill = (result.needs ?? []).map((n) => n.label)
  return missingDataFlag({
    module,
    stage_used,
    check,
    checkTitle,
    severity,
    missing: [result.reason, ...(fill.length ? [`fill in: ${fill.join(', ')}`] : [])],
  })
}

// Cell references for a flag, from where each value came from. Values typed by hand and blank values are named too, so a
// flag never points at a cell that does not exist.
export function citeCells(record, paths) {
  const refs = []
  for (const path of paths) {
    const source = record.sources?.[path]
    const ref = source && source !== 'manual' ? source : `${path} (${source === 'manual' ? 'entered by hand' : 'blank'})`
    if (!refs.includes(ref)) refs.push(ref)
  }
  return refs
}

const MAX_FLAGS_PER_MODULE = 1000

// Wrap a module's run(project, context) -> { flags, notes } so that nothing a module does can break the review: a crash, a
// result that is not { flags, notes }, an object that throws when read, a malformed flag, or a flag claiming to come from a
// different module all become a visible "check failed" flag instead of a lost check or a crash in M6. Good flags are kept,
// and every flag that comes out is complete and frozen.
export function guardModule(module, run) {
  if (!knownModule(module)) throw new FlagError(`${module} is not a module that raises flags.`)
  return (project, context) => {
    const notes = []
    let stage = 'development'
    try {
      const chosen = project?.data?.stage?.stage
      if (STAGE_VALUES.includes(chosen)) stage = chosen
      else notes.push('The project has no stage yet, so development was used to describe any failure.')
    } catch {
      notes.push('The project could not be read, so development was used to describe any failure.')
    }
    const failure = (reason) => {
      notes.push(reason)
      return makeFlag({
        id: `${module}-check-failed`,
        module,
        stage_used: stage,
        severity: 'medium',
        title: `The ${module} checks could not be completed.`,
        evidence: 'A check stopped because of an internal error, so some findings may be missing.',
        follow_up: 'Ask whoever maintains this tool to look at the error, and review this project by hand in the meantime.',
      })
    }

    try {
      const result = run(project, context)
      if (!isObject(result) || !Array.isArray(result.flags)) return { flags: [failure(`${module} returned something that is not { flags, notes }.`)], notes }

      const flags = []
      const incoming = result.flags.slice(0, MAX_FLAGS_PER_MODULE)
      let malformed = 0
      for (const flag of incoming) {
        const problems = validateFlag(flag)
        if (!problems.length && flag.module !== module) problems.push(`it says it came from ${show(flag.module)}, not ${module}.`)
        if (problems.length) {
          malformed++
          notes.push(`${module} produced a flag that was dropped: ${problems.join(' ')}`)
        } else flags.push(makeFlag(flag)) // rebuilt, so it is always complete and frozen
      }
      if (result.flags.length > MAX_FLAGS_PER_MODULE) {
        malformed++
        notes.push(`${module} produced ${result.flags.length} flags; only the first ${MAX_FLAGS_PER_MODULE} were kept.`)
      }
      if (malformed) flags.push(failure(`${module} produced ${malformed} malformed or surplus flag${malformed === 1 ? '' : 's'}.`))
      const moduleNotes = Array.isArray(result.notes) ? result.notes.filter((n) => typeof n === 'string').slice(0, 200) : []
      return { flags, notes: [...moduleNotes, ...notes] }
    } catch (e) {
      return { flags: [failure(`${module} stopped with an error: ${show(e?.message ?? e)}`)], notes }
    }
  }
}
