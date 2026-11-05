import { useState } from 'react'
import './App.css'
import ImportPreview from './ImportPreview.jsx'
import { RescueBoundary } from './RescueBoundary.jsx'
import { rescueStore } from './download.js'
import {
  firmSchema,
  projectSchema,
  describeGroup,
  STAGES,
  SOURCE_TYPES,
  LEASE_TYPES,
} from './modules/shared/index.js'

const TYPE_LABELS = {
  text: 'text',
  number: 'number',
  dollars: '$',
  percent: '%',
  date: 'date',
  yearMonth: 'year / month',
  boolean: 'yes / no',
  stage: 'choice',
  sourceType: 'choice',
  leaseType: 'choice',
}

const CHOICES = {
  stage: { title: 'Stage choices', lines: true, list: STAGES.map((s) => `${s.label}: ${s.plain}`) },
  sourceType: { title: 'Source type choices', list: SOURCE_TYPES.map((s) => s.label) },
  leaseType: { title: 'Lease type choices', list: LEASE_TYPES.map((s) => s.label) },
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function sizeText(group) {
  const d = describeGroup(group)
  if (group.kind === 'fields') return plural(d.fields, 'field')
  if (group.kind === 'table') return `${plural(d.columns, 'column')}, up to ${plural(d.maxRows, 'row')}`
  return plural(d.lines, 'line')
}

function CellChip({ cell }) {
  if (!cell) return null
  if (cell === 'new') return <span className="chip new">new</span>
  return <span className="chip cell">{cell}</span>
}

function Item({ item }) {
  return (
    <li>
      <span>{item.label}</span>
      <span className="chips">
        {item.type && <span className="chip">{TYPE_LABELS[item.type] ?? item.type}</span>}
        <CellChip cell={item.cell} />
      </span>
    </li>
  )
}

function ItemList({ items }) {
  return (
    <ul className="items">
      {items.map((item) => (
        <Item key={item.key} item={item} />
      ))}
    </ul>
  )
}

// Group lines by their section label, keeping their order.
function Sections({ rows }) {
  const out = []
  for (const r of rows) {
    const label = r.section || ''
    const last = out[out.length - 1]
    if (last && last.label === label) last.rows.push(r)
    else out.push({ label, rows: [r] })
  }
  return out.map((s, i) => (
    <div key={`${s.label}-${i}`}>
      {s.label && <p className="section-label">{s.label}</p>}
      <ul className="items">
        {s.rows.map((r) => (
          <Item key={r.key} item={r} />
        ))}
      </ul>
    </div>
  ))
}

function ChoiceBoxes({ items }) {
  const kinds = [...new Set(items.map((i) => i.type).filter((t) => CHOICES[t]))]
  return kinds.map((k) => (
    <div className="choices" key={k}>
      <strong>{CHOICES[k].title}</strong>
      {CHOICES[k].lines
        ? CHOICES[k].list.map((line) => <div key={line}>{line}</div>)
        : CHOICES[k].list.join(' · ')}
    </div>
  ))
}

function GroupCard({ group }) {
  const allItems = [...(group.fields || []), ...(group.columns || [])]
  return (
    <details className="card">
      <summary>
        <span className="title">{group.title}</span>
        <span className="size">{sizeText(group)}</span>
      </summary>
      <div className="body">
        {group.note && <p className="note">{group.note}</p>}

        {group.kind === 'fields' && <ItemList items={group.fields} />}

        {group.kind === 'table' && (
          <>
            <p className="section-label">Columns in each row</p>
            <ItemList items={group.columns} />
            {group.fields && (
              <>
                <p className="section-label">Also on this tab</p>
                <ItemList items={group.fields} />
              </>
            )}
          </>
        )}

        {group.kind === 'grid' && (
          <>
            {group.fields && <ItemList items={group.fields} />}
            <p className="section-label">
              Each line has: {group.columns.map((c) => c.label).join(', ')}
            </p>
            <Sections rows={group.rows} />
          </>
        )}

        <ChoiceBoxes items={allItems} />
        <p className="where">From the workbook tab: {group.where}</p>
      </div>
    </details>
  )
}

const VIEWS = [
  {
    id: 'import',
    label: 'Load workbook',
    heading: 'Load an applicant workbook',
    lede: "Drop the applicant's spreadsheet here to see what we can read from it. Nothing is sent anywhere. You can save the review as a file and reopen it later.",
  },
  {
    id: 'firm',
    label: 'Firm record',
    schema: firmSchema,
    heading: 'What we store about a firm',
    lede: 'The record structure, grouped the way the applicant workbook groups it. Tap a group to see its fields. Blue "new" tags mark things the workbook does not have.',
  },
  {
    id: 'project',
    label: 'Project record',
    schema: projectSchema,
    heading: 'What we store about a project',
    lede: 'The record structure, grouped the way the applicant workbook groups it. Tap a group to see its fields. Blue "new" tags mark things the workbook does not have.',
  },
]

export default function App() {
  const [view, setView] = useState('import')
  const [attempt, setAttempt] = useState(0) // changing this starts the review screen over after a crash
  const current = VIEWS.find((v) => v.id === view)

  return (
    <main className="page">
      <h1>{current.heading}</h1>
      <p className="lede">{current.lede}</p>

      <div className="tabs" role="tablist" aria-label="What to show">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Kept on the page (just hidden) so a loaded review is not lost when you look at another tab. */}
      <div hidden={current.id !== 'import'}>
        <RescueBoundary
          key={attempt}
          onReset={() => {
            rescueStore.current = null
            setAttempt((n) => n + 1)
          }}
        >
          <ImportPreview />
        </RescueBoundary>
      </div>
      {current.id !== 'import' && (
        <>
          <p className="summary-line">{plural(current.schema.length, 'group')}</p>
          {current.schema.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </>
      )}
    </main>
  )
}
