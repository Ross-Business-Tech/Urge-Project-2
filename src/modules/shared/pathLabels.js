// Turns a record path such as "budget.lines.constructionInterest.amount" into words a reader recognises, such as
// "Development budget: Construction interest". Built by M0 from the field schema, so it can never drift from the screens.
//
// Used where a path would otherwise leak into text people read (a flag's cell references when a value is blank or typed by
// hand) and by the AI screen when it lists the entered values.

import { firmSchema, projectSchema } from './schema.js'

// The schema group, label and type for one path, or null if the path is not a single field.
export function describePath(schema, path) {
  const parts = String(path).split('.')
  const group = schema.find((g) => g.id === parts[0])
  if (!group) return null
  if (parts[1] === 'rows' && parts.length === 4) {
    const col = (group.columns ?? []).find((c) => c.key === parts[3])
    return col ? { label: `${group.title}, row ${Number(parts[2]) + 1}: ${col.label}`, type: col.type, key: col.key } : null
  }
  if (parts[1] === 'lines' && parts.length === 4) {
    const row = (group.rows ?? []).find((r) => r.key === parts[2])
    const col = (group.columns ?? []).find((c) => c.key === parts[3])
    if (!row || !col) return null
    const extra = (group.columns ?? []).length > 1 ? ` (${col.label})` : ''
    return { label: `${group.title}: ${row.label}${extra}`, type: col.type, key: col.key }
  }
  if (parts.length === 2) {
    const field = (group.fields ?? []).find((f) => f.key === parts[1])
    return field ? { label: `${group.title}: ${field.label}`, type: field.type, key: field.key } : null
  }
  return null
}

// A readable name for any path on a record: the field if it is one, else the group it belongs to, else the path itself.
export function labelForPath(record, path) {
  const schema = record?.kind === 'firm' ? firmSchema : projectSchema
  const field = describePath(schema, path)
  if (field) return field.label
  const group = schema.find((g) => g.id === String(path).split('.')[0])
  return group ? group.title : String(path)
}
