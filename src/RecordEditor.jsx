import { useState } from 'react'
import {
  SOURCE_TYPES,
  LEASE_TYPES,
  getValue,
  setValue,
  provenance,
  addTableRow,
  removeTableRow,
  formatForInput,
  parseInput,
} from './modules/shared/index.js'

const CHOICES = {
  sourceType: SOURCE_TYPES,
  leaseType: LEASE_TYPES,
  boolean: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
}

const cellOf = (source) => (typeof source === 'string' ? (source.split('!')[1] ?? source) : '')

function showValue(type, value) {
  const text = formatForInput(type, value)
  if (text === '') return 'nothing'
  return type === 'dollars' ? `$${text}` : type === 'percent' ? `${text}%` : text
}

// Where a value came from: the workbook, typed by hand, or changed from what the workbook said.
function Provenance({ prov, type, onRestore }) {
  if (prov.kind === 'workbook') return <span className="prov">From workbook ({cellOf(prov.source)})</span>
  if (prov.kind === 'manual') return <span className="prov hand">Entered by hand</span>
  if (prov.kind === 'changed') {
    return (
      <span className="prov changed">
        Changed by you. Applicant said {showValue(type, prov.original)} ({cellOf(prov.originalSource)}).{' '}
        <button type="button" className="link" onClick={onRestore}>
          Put back
        </button>
      </span>
    )
  }
  return null
}

function ChoiceSelect({ type, value, onChange }) {
  const list = CHOICES[type]
  const current = type === 'boolean' ? (value === true ? 'yes' : value === false ? 'no' : '') : (value ?? '')
  const known = current === '' || list.some((o) => o.value === current)
  return (
    <select value={current} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not set</option>
      {list.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {!known && <option value={current}>{current} (not recognized)</option>}
    </select>
  )
}

// One value: shows it, lets the person change it, and says where it came from.
function FieldInput({ label, type, path, record, onEdit }) {
  const value = getValue(record, path)
  const prov = provenance(record, path)
  const [error, setError] = useState(null)

  const apply = (next) => {
    setError(null)
    onEdit((r) => setValue(r, path, next))
  }

  let control
  if (CHOICES[type]) {
    control = (
      <ChoiceSelect
        type={type}
        value={value}
        onChange={(v) => {
          const parsed = v === '' ? { value: null } : parseInput(type === 'boolean' ? 'boolean' : 'text', v)
          apply(parsed.value)
        }}
      />
    )
  } else if (type === 'date') {
    control = (
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => {
          const parsed = parseInput('date', e.target.value)
          if (parsed.error) setError(parsed.error)
          else apply(parsed.value)
        }}
      />
    )
  } else {
    const numeric = type === 'dollars' || type === 'number' || type === 'percent'
    control = (
      <span className="input-wrap">
        {type === 'dollars' && <span className="unit">$</span>}
        <input
          // Remounts when the stored value changes, so the box always shows the saved value.
          key={`${path}|${formatForInput(type, value)}`}
          type="text"
          inputMode={numeric ? 'decimal' : 'text'}
          defaultValue={formatForInput(type, value)}
          placeholder={type === 'yearMonth' ? '2026 or 2026-03' : ''}
          onBlur={(e) => {
            const parsed = parseInput(type, e.target.value)
            if (parsed.error) setError(parsed.error)
            else {
              e.target.value = formatForInput(type, parsed.value) // tidy what was typed, even if the value did not change
              apply(parsed.value)
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {type === 'percent' && <span className="unit">%</span>}
      </span>
    )
  }

  return (
    <label className="edit-field">
      <span className="edit-label">{label}</span>
      {control}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
      <Provenance prov={prov} type={type} onRestore={() => onEdit((r) => setValue(r, path, prov.original))} />
    </label>
  )
}

function FieldList({ group, fields, record, onEdit }) {
  return fields.map((f) => <FieldInput key={f.key} label={f.label} type={f.type} path={`${group.id}.${f.key}`} record={record} onEdit={onEdit} />)
}

function rowTitle(group, row, index) {
  const label = row.name ?? row.description ?? row.unitType ?? row.month ?? row.fiscalYear ?? row.projectId ?? row.firmName
  return label ? `Row ${index + 1}: ${label}` : `Row ${index + 1}`
}

function TableEditor({ group, record, onEdit }) {
  const data = record.data[group.id]
  const removedCount = record.originals[`${group.id}.removedRows`]?.length ?? 0
  const startOpen = group.columns.length <= 8

  const remove = (index) => {
    const row = data.rows[index]
    const hadWorkbookValues = group.columns.some((c) => {
      const source = record.sources[`${group.id}.rows.${index}.${c.key}`]
      return source && source !== 'manual'
    })
    const message = hadWorkbookValues
      ? "This row came from the applicant's workbook. It will be removed, but the applicant's version is kept in the saved history. Remove it?"
      : 'Remove this row?'
    if (row && window.confirm(message)) onEdit((r) => removeTableRow(r, group, index))
  }

  return (
    <>
      {group.fields && <FieldList group={group} fields={group.fields} record={record} onEdit={onEdit} />}
      {data.rows.length === 0 && <p className="note">No rows yet.</p>}
      {data.rows.map((row, i) => (
        <details className="row-card" key={i} open={startOpen}>
          <summary>{rowTitle(group, row, i)}</summary>
          <div className="row-body">
            {group.columns.map((c) => (
              <FieldInput key={c.key} label={c.label} type={c.type} path={`${group.id}.rows.${i}.${c.key}`} record={record} onEdit={onEdit} />
            ))}
            <button type="button" className="button small danger" onClick={() => remove(i)}>
              Remove this row
            </button>
          </div>
        </details>
      ))}
      <div className="actions">
        <button type="button" className="button small" disabled={data.rows.length >= group.maxRows} onClick={() => onEdit((r) => addTableRow(r, group))}>
          Add a row
        </button>
        <span className="help">
          {data.rows.length} of up to {group.maxRows} rows
        </span>
      </div>
      {removedCount > 0 && <p className="help">{removedCount} removed row{removedCount === 1 ? '' : 's'} kept in the saved history.</p>}
    </>
  )
}

function GridEditor({ group, record, onEdit }) {
  const data = record.data[group.id]
  const sections = []
  for (const r of group.rows) {
    const label = r.section || ''
    const last = sections[sections.length - 1]
    if (last && last.label === label) last.rows.push(r)
    else sections.push({ label, rows: [r] })
  }
  const multi = group.columns.length > 1

  const lines = (rows) =>
    rows.map((r) =>
      multi ? (
        <div className="line" key={r.key}>
          <span className="line-label">{r.label}</span>
          <div className="line-inputs">
            {group.columns.map((c) => (
              <FieldInput key={c.key} label={c.label} type={c.type} path={`${group.id}.lines.${r.key}.${c.key}`} record={record} onEdit={onEdit} />
            ))}
          </div>
        </div>
      ) : (
        <FieldInput key={r.key} label={r.label} type={group.columns[0].type} path={`${group.id}.lines.${r.key}.${group.columns[0].key}`} record={record} onEdit={onEdit} />
      ),
    )

  return (
    <>
      {group.fields && <FieldList group={group} fields={group.fields} record={record} onEdit={onEdit} />}
      {sections.map((s, i) => {
        if (!s.label) return <div key={i}>{lines(s.rows)}</div>
        const filled = s.rows.reduce((n, r) => n + group.columns.filter((c) => data.lines[r.key][c.key] !== null && data.lines[r.key][c.key] !== '').length, 0)
        const total = s.rows.length * group.columns.length
        return (
          <details className="row-card" key={s.label}>
            <summary>
              {s.label} <span className="chip">{filled} of {total} filled</span>
            </summary>
            <div className="row-body">{lines(s.rows)}</div>
          </details>
        )
      })}
    </>
  )
}

export function GroupEditor({ group, record, onEdit }) {
  return (
    <div className="editor-body">
      {group.note && <p className="note">{group.note}</p>}
      {group.kind === 'fields' && <FieldList group={group} fields={group.fields} record={record} onEdit={onEdit} />}
      {group.kind === 'table' && <TableEditor group={group} record={record} onEdit={onEdit} />}
      {group.kind === 'grid' && <GridEditor group={group} record={record} onEdit={onEdit} />}
    </div>
  )
}

