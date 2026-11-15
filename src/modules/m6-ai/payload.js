// Builds the reduced copy of a review that is sent to the AI: what the fixed checks found, the key numbers, the sponsor's
// scores, and a table of the entered values with the spreadsheet cell each came from (so the AI can cite cells).
//
// What is NOT sent: names and addresses (replaced by neutral labels first), free text such as descriptions, the file name,
// and any value the workbook did not provide. Nothing is sent until the reviewer presses the button.

import { fmt, keyRatios, firmSchema, projectSchema, getValue } from '../shared/index.js'
import { firmHealth, trackRecord } from '../m5-sponsor/index.js'
import { buildNameMap, deidentify } from './deidentify.js'

const MAX_DATA_ENTRIES = 300
const MAX_NOTES = 40

// Which kinds of value are sent. Free text (names, addresses, descriptions) is not, apart from three plain categories.
const SENT_TYPES = new Set(['dollars', 'percent', 'number', 'date', 'yearMonth', 'boolean', 'sourceType', 'leaseType'])
const SENT_TEXT_KEYS = new Set(['unitType', 'constructionType', 'propertyType'])

const safe = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}

function describePath(schema, path) {
  const parts = path.split('.')
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

function shown(type, value) {
  if (type === 'dollars') return fmt.usd(value)
  if (type === 'percent') return fmt.pct(value)
  if (type === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

// The entered values that came from workbook cells, each with its cell and a readable label.
export function dataTable(rec, schema) {
  const out = []
  for (const [path, cell] of Object.entries(rec?.sources ?? {})) {
    if (!cell || cell === 'manual') continue
    const d = describePath(schema, path)
    if (!d || !(SENT_TYPES.has(d.type) || (d.type === 'text' && SENT_TEXT_KEYS.has(d.key)))) continue
    const value = safe(() => getValue(rec, path))
    if (value === null || value === undefined || value === '' || typeof value === 'object') continue
    out.push({ cell, label: d.label, value: shown(d.type, value) })
  }
  return out
}

const display = (r) => (r.unit === 'times' ? fmt.times(r.value) : r.unit === 'percent' ? fmt.pct(r.value) : r.unit === 'months' ? `${Number(r.value).toFixed(1)} months` : String(r.value))

// Everything for one project, with names already replaced. Returns the payload and the name map (kept on this device).
export function buildPayload({ record, firm, settings, result, flags = [], notes = [] }) {
  const projects = result?.projects ?? []
  const map = buildNameMap({ record, firm, projects })
  const health = safe(() => firmHealth(firm, projects, settings))
  const track = safe(() => trackRecord(firm, projects, settings, record))
  const ratios = safe(() => keyRatios(record, settings)) ?? []

  const raw = {
    version: 1,
    project: {
      label: '[Project A]',
      stage: record?.data?.stage?.stage ?? null,
      as_of: record?.data?.stage?.asOfDate ?? null,
      t12_months: record?.data?.t12?.rows?.length ?? 0,
      other_projects_in_workbook: Math.max(0, projects.length - 1),
    },
    lender_settings: settings ?? {},
    key_ratios: ratios.map((r) => ({ id: r.id, title: r.title, value: r.ok ? display(r) : null, status: r.ok ? (r.status ?? 'ok') : 'not available', why: r.ok ? undefined : r.reason })),
    sponsor: {
      firm_health: health
        ? {
            ok: Boolean(health.ok),
            score: health.score ?? null,
            label: health.label ?? null,
            measures: (health.parts ?? []).map((p) => ({ id: p.id, title: p.title, value: p.ok === false ? null : (p.value ?? null), score: p.score ?? null, detail: p.ok === false ? [p.reason].filter(Boolean) : (p.detail ?? []) })),
          }
        : null,
      track_record: track ? { ok: Boolean(track.ok), score: track.score ?? null, label: track.label ?? null, reason: track.reason ?? null, completed_projects: track.projects?.length ?? 0 } : null,
    },
    flags: flags.map((f) => ({ id: f.id, module: f.module, severity: f.severity, stage_used: f.stage_used, title: f.title, evidence: f.evidence, cell_refs: f.cell_refs, follow_up: f.follow_up, transition: f.transition || undefined })),
    notes: notes.slice(0, MAX_NOTES).map((n) => String(n).slice(0, 300)),
    data: [...dataTable(record, projectSchema), ...dataTable(firm, firmSchema)].slice(0, MAX_DATA_ENTRIES),
  }
  return { payload: deidentify(raw, map), map }
}

// The gateway refuses a request over its size limit, so trim the least important parts first: the value table, then the
// notes. The flags and key numbers are never cut.
export function fitPayload(payload, maxBytes = 180_000) {
  const size = (p) => new TextEncoder().encode(JSON.stringify(p)).length
  let p = payload
  const trimmed = []
  if (size(p) > maxBytes && p.data?.length) {
    let keep = p.data.length
    while (keep > 0 && size({ ...p, data: p.data.slice(0, keep) }) > maxBytes) keep = Math.floor(keep * 0.8)
    p = { ...p, data: p.data.slice(0, keep) }
    trimmed.push(`the table of entered values was cut to ${keep} rows`)
  }
  if (size(p) > maxBytes && p.notes?.length) {
    p = { ...p, notes: [] }
    trimmed.push('the module notes were left out')
  }
  return { payload: p, trimmed, tooLarge: size(p) > maxBytes }
}
