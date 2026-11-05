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
import { isEmpty } from './fieldFormat.js'

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

const copyMaps = (record) => ({ ...record, sources: { ...record.sources }, originals: { ...record.originals } })

// Set one value (null clears it). Records where it came from and keeps the applicant's original.
export function setValue(record, path, value) {
  const oldValue = getValue(record, path)
  if (oldValue === undefined) throw new Error(`Nothing to edit at ${path}`)
  const next = isEmpty(value) ? null : value
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
