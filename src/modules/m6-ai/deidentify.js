// Replace names and addresses with neutral labels before anything leaves the device, and put them back on screen.
//
// A flag's own words ("Developer equity from Pat Sample...") often contain names, so the replacement works on the TEXT, using
// the names found in the review's records. Labels are bracketed, like [Project A], so they cannot be mistaken for a tab
// name such as "Development Project 1 Details" when they are put back.
//
// Never replaced: cell references and ids, because the answer is checked against them exactly.

// Words that are not names even when they sit in a "name" box (an equity line is often just called "Sponsor").
const GENERIC = /^(sponsor|equity|developer|developer equity|deferred fee|deferred developer fee|owner|owners|grant|bank|loan|other|n\/a|none|tbd|tba|example|tax credit equity)$/i
const MIN_LENGTH = 4
const KEEP_KEYS = new Set(['cell_refs', 'cell', 'id', 'flag_id', 'flag_ids', 'module', 'severity', 'stage_used', 'transition', 'status', 'unit', 'stage'])

const letters = (n) => String.fromCharCode(65 + (n % 26)).repeat(1 + Math.floor(n / 26))
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The names found in a review, each with its label. Longest first, so "Maple Ridge Partners LLC" is replaced before
// "Maple Ridge".
export function buildNameMap({ record, firm, projects = [] }) {
  const entries = []
  const seen = new Set()
  const add = (original, label) => {
    const o = text(original)
    if (o.length < MIN_LENGTH || GENERIC.test(o) || seen.has(o.toLowerCase())) return
    seen.add(o.toLowerCase())
    entries.push({ original: o, label })
  }

  const reviewedId = record?.meta?.projectId
  let pastIndex = 0
  let addressIndex = 0
  const project = (p, label) => {
    add(p?.data?.identity?.name, label)
    add(p?.data?.identity?.address, `[Address ${letters(addressIndex++)}]`)
    ;(p?.data?.sources?.rows ?? []).forEach((r) => add(r?.name, `[Lender ${letters(entries.length)}]`))
    const team = p?.data?.team?.lines ?? {}
    for (const line of Object.values(team)) {
      add(line?.firmName, `[Team firm ${letters(entries.length)}]`)
      add(line?.principal, `[Team person ${letters(entries.length)}]`)
    }
  }
  project(record, '[Project A]')
  for (const p of projects) if (p?.meta?.projectId !== reviewedId) project(p, `[Past project ${letters(pastIndex++)}]`)

  const id = firm?.data?.identity ?? {}
  add(id.name, '[Sponsor firm]')
  add(id.street, '[Firm address A]')
  add(id.cityStateZip, '[Firm address B]')
  add(id.principalName, '[Principal A]')
  ;(firm?.data?.owners?.rows ?? []).forEach((r, i) => add(r?.name, `[Owner ${letters(i)}]`))
  add(firm?.data?.principalStatement?.name, '[Principal A]')

  return entries.sort((a, b) => b.original.length - a.original.length)
}

const wordBoundary = (original) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(original)}(?![A-Za-z0-9])`, 'gi')

export function replaceInText(value, map) {
  let out = value
  for (const { original, label } of map) out = out.replace(wordBoundary(original), label)
  return out
}

// Walk any JSON-like value, replacing names inside every string except under the keys that must stay exact.
export function deidentify(value, map, key = '') {
  if (KEEP_KEYS.has(key)) return value
  if (typeof value === 'string') return replaceInText(value, map)
  if (Array.isArray(value)) return value.map((v) => deidentify(v, map, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deidentify(v, map, k)]))
  return value
}

// Put the real names back, for display only. The label is turned back into the first real name that had it.
export function restore(value, map) {
  if (typeof value !== 'string') return value
  let out = value
  const seen = new Set()
  for (const { original, label } of map) {
    if (seen.has(label)) continue
    seen.add(label)
    out = out.split(label).join(original)
  }
  return out
}

// Every real name still present in some text (used by tests and as a last check before sending).
export function leaks(value, map) {
  const json = typeof value === 'string' ? value : JSON.stringify(value)
  return map.filter(({ original }) => wordBoundary(original).test(json)).map(({ original }) => original)
}
