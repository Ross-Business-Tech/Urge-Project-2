// Editing a record by hand. Built by M0.
//
// Every function here returns a NEW record and never changes the one it is given.
//
// Where a value came from is tracked in two maps on the record, keyed by the value's path
// ("identity.name", "sources.rows.0.amount", "budget.lines.land.amount"):
//   sources:   path -> 'Tab!Cell' (read from the workbook) or 'manual' (typed by hand)
//   originals: path -> { value, source }  what the applicant's workbook said, kept when someone changes or clears it
// A value changed back to the original is restored to its workbook source, and its entry in `originals` is dropped.
// Removing a table row keeps what the applicant had for that row in originals['<group>.removedRows'].

import { blankTableRow } from './records.js'
import { firmSchema, projectSchema } from './schema.js'
import { STAGE_VALUES, isValidDate } from './projectStage.js'
import { isEmpty, limitError } from './fieldFormat.js'

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

function keysOf(path) {
  const keys = path.split('.')
  if (keys.length < 2 || keys.some((k) => k === '' || FORBIDDEN.has(k))) throw new Error(`Not a valid path: ${path}`)
  return keys
}

export function getValue(record, path) {
  let node = record.data
  for (const key of keysOf(path)) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[key]
  }
  return node
}

// Copy the structure along one path and put the value at the end. The path must already exist.
function setIn(node, keys, value) {
  const [key, ...rest] = keys
  if (node === null || typeof node !== 'object' || !(key in node)) throw new Error(`Nothing to edit at ${keys.join('.')}`)
  const copy = Array.isArray(node) ? node.slice() : { ...node }
  copy[key] = rest.length ? setIn(node[key], rest, value) : value
  return copy
}

// The schema definition (type and limits) of the value at a path, or null if there is none.
function fieldDefinition(record, path) {
  const schema = record.kind === 'firm' ? firmSchema : projectSchema
  const [groupId, ...rest] = path.split('.')
  const group = schema.find((g) => g.id === groupId)
  if (!group) return null
  if (rest.length === 1) return (group.fields ?? []).find((f) => f.key === rest[0]) ?? null
  if ((rest[0] === 'rows' || rest[0] === 'lines') && rest.length === 3) return (group.columns ?? []).find((c) => c.key === rest[2]) ?? null
  return null
}

// Is this value acceptable for a field? Returns a plain message if not, or null.
function valueProblem(def, value) {
  if (isEmpty(value)) return null
  switch (def.type) {
    case 'number':
    case 'dollars':
    case 'percent':
      return limitError(def.type, value, def)
    case 'boolean':
      return typeof value === 'boolean' ? null : 'It must be yes or no.'
    case 'date':
      return isValidDate(value) ? null : 'It must be a real date.'
    case 'yearMonth':
      return typeof value === 'string' && /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(value) ? null : 'It must be a year or a year and month.'
    case 'stage':
      return STAGE_VALUES.includes(value) ? null : 'It must be one of the three stages.'
    default:
      return typeof value === 'string' && value.length <= 500 ? null : 'It must be text of at most 500 characters.'
  }
}

const copyMaps = (record) => ({ ...record, sources: { ...record.sources }, originals: { ...record.originals } })

// Set one value (null clears it). Records where it came from and keeps the applicant's original. A value of the wrong
// kind, or outside the field's limits, is refused. `restore: true` skips that check, so "put back" can return the
// applicant's original value even when it was out of range.
export function setValue(record, path, value, { restore = false } = {}) {
  const oldValue = getValue(record, path)
  if (oldValue === undefined) throw new Error(`Nothing to edit at ${path}`)
  const next = isEmpty(value) ? null : value
  if (!restore && next !== null) {
    const def = fieldDefinition(record, path)
    const problem = def ? valueProblem(def, next) : 'It is not a field that can be edited.'
    if (problem) throw new Error(`That is not valid for "${def?.label ?? path}": ${problem}`)
  }
  if (Object.is(oldValue ?? null, next)) return record

  const out = copyMaps(record)
  out.data = setIn(record.data, keysOf(path), next)
  const source = record.sources[path]
  const original = record.originals[path]
  const setSource = (s) => (s === null ? delete out.sources[path] : (out.sources[path] = s))

  if (original) {
    if (Object.is(original.value, next)) {
      delete out.originals[path]
      setSource(original.source) // back to what the workbook said
    } else setSource(next === null ? null : 'manual')
  } else if (source && source !== 'manual' && oldValue !== null) {
    out.originals[path] = { value: oldValue, source }
    setSource(next === null ? null : 'manual')
  } else setSource(next === null ? null : 'manual')
  return out
}

// How a value got there: from the workbook, typed by hand, or changed from what the workbook said.
export function provenance(record, path) {
  const original = record.originals?.[path]
  const source = record.sources?.[path]
  if (original) return { kind: 'changed', original: original.value, originalSource: original.source }
  if (source === 'manual') return { kind: 'manual' }
  if (source) return { kind: 'workbook', source }
  return { kind: 'none' }
}

const rowKey = (groupId) => new RegExp(`^${groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.rows\\.(\\d+)\\.(.+)$`)

export function addTableRow(record, group) {
  const rows = record.data[group.id].rows
  if (group.kind !== 'table' || rows.length >= group.maxRows) return record
  const out = copyMaps(record)
  out.data = { ...record.data, [group.id]: { ...record.data[group.id], rows: [...rows, blankTableRow(group)] } }
  return out
}

export function removeTableRow(record, group, index) {
  const rows = record.data[group.id].rows
  if (group.kind !== 'table' || index < 0 || index >= rows.length) return record
  const pattern = rowKey(group.id)
  const out = copyMaps(record)
  out.sources = {}
  out.originals = {}
  const removed = { row: rows[index], sources: {}, originals: {} }

  for (const [path, value] of Object.entries(record.sources)) {
    const m = path.match(pattern)
    if (!m) out.sources[path] = value
    else if (Number(m[1]) === index) removed.sources[m[2]] = value
    else out.sources[`${group.id}.rows.${Number(m[1]) > index ? Number(m[1]) - 1 : Number(m[1])}.${m[2]}`] = value
  }
  for (const [path, value] of Object.entries(record.originals)) {
    const m = path.match(pattern)
    if (!m) out.originals[path] = value
    else if (Number(m[1]) === index) removed.originals[m[2]] = value
    else out.originals[`${group.id}.rows.${Number(m[1]) > index ? Number(m[1]) - 1 : Number(m[1])}.${m[2]}`] = value
  }
  // Keep what the applicant had, if any of this row came from the workbook.
  const cameFromWorkbook = Object.values(removed.sources).some((s) => s !== 'manual') || Object.keys(removed.originals).length > 0
  if (cameFromWorkbook) {
    const key = `${group.id}.removedRows`
    out.originals[key] = [...(record.originals[key] ?? []), removed]
  }
  out.data = { ...record.data, [group.id]: { ...record.data[group.id], rows: rows.filter((_, i) => i !== index) } }
  return out
}

// How many of a group's boxes are filled in, out of how many it has right now.
export function countGroup(group, data) {
  let filled = 0
  let total = 0
  const take = (value) => {
    total++
    if (!isEmpty(value)) filled++
  }
  const takeFields = () => (group.kind === 'fields' || group.fields) && (group.fields || []).forEach((f) => take(data[f.key]))
  takeFields()
  if (group.kind === 'table') for (const row of data.rows) for (const c of group.columns) take(row[c.key])
  if (group.kind === 'grid') for (const r of group.rows) for (const c of group.columns) take(data.lines[r.key][c.key])
  return { filled, total, blank: total - filled }
}

// Replace a project's whole T-12 with rows read from a T-12 template. The old rows and their history are dropped
// (a T-12 never came from the applicant workbook), the new rows record the template cell each value came from, and
// nothing else in the record changes.
export function replaceT12Rows(record, { rows, sources }) {
  const out = copyMaps(record)
  const keep = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith('t12.')))
  out.sources = { ...keep(record.sources), ...sources }
  out.originals = keep(record.originals)
  out.data = { ...record.data, t12: { ...record.data.t12, rows } }
  return out
}
