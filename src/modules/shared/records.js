// Blank records built from the schema. Built by M0.
//
// A record looks like:
//   { schemaVersion, kind: 'firm' | 'project', data: { <groupId>: ... }, sources: { <path>: 'Tab!Cell' | 'manual' },
//     originals: { <path>: { value, source } } }
// and each group's data depends on its kind:
//   fields -> { key: null, ... }
//   table  -> { rows: [], <extra field keys>: null }            (each row is { column: null, ... })
//   grid   -> { lines: { rowKey: { column: null } }, <extra field keys>: null }
// `sources` remembers where each value came from in the applicant workbook, keyed by path such as
// "sources.rows.0.amount". It starts empty. A value typed by hand is marked 'manual'. When someone changes a value that
// came from the workbook, `originals` keeps what the applicant said (and where it came from) so both can be shown.

import { SCHEMA_VERSION, firmSchema, projectSchema } from './schema.js'

const nulls = (list) => Object.fromEntries(list.map((item) => [item.key, null]))

export function blankTableRow(group) {
  return nulls(group.columns)
}

function blankGroup(group) {
  const extra = group.fields && group.kind !== 'fields' ? nulls(group.fields) : {}
  if (group.kind === 'fields') return nulls(group.fields)
  if (group.kind === 'table') return { rows: [], ...extra }
  if (group.kind === 'grid') {
    const lines = Object.fromEntries(group.rows.map((r) => [r.key, nulls(group.columns)]))
    return { lines, ...extra }
  }
  throw new Error(`Unknown group kind: ${group.kind}`)
}

function blankRecord(kind, schema) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind,
    data: Object.fromEntries(schema.map((g) => [g.id, blankGroup(g)])),
    sources: {},
    originals: {},
  }
}

export const blankFirm = () => blankRecord('firm', firmSchema)
export const blankProject = () => blankRecord('project', projectSchema)

// How big a group is, in plain numbers, for display.
export function describeGroup(group) {
  const extra = group.kind === 'fields' ? 0 : (group.fields || []).length
  if (group.kind === 'fields') return { fields: group.fields.length }
  if (group.kind === 'table') return { columns: group.columns.length, maxRows: group.maxRows, extra }
  return { lines: group.rows.length, columns: group.columns.length, extra }
}

// Returns a list of problems in a schema (empty list means fine): duplicate group ids or duplicate keys inside a group.
export function checkSchema(schema) {
  const problems = []
  const ids = new Set()
  for (const g of schema) {
    if (ids.has(g.id)) problems.push(`Duplicate group id: ${g.id}`)
    ids.add(g.id)
    const lists = { fields: g.fields, columns: g.columns, rows: g.rows }
    const everyKey = [...(g.fields || []), ...(g.columns || []), ...(g.rows || [])]
    for (const [name, list] of Object.entries(lists)) {
      if (!list) continue
      const seen = new Set()
      for (const item of list) {
        if (seen.has(item.key)) problems.push(`${g.id}.${name}: duplicate key ${item.key}`)
        seen.add(item.key)
      }
    }
    if (g.kind !== 'fields' && g.kind !== 'table' && g.kind !== 'grid') problems.push(`${g.id}: unknown kind ${g.kind}`)
    if (everyKey.some((i) => !i.label)) problems.push(`${g.id}: an item has no label`)
  }
  return problems
}
