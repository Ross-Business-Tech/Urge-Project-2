import { useState } from 'react'
import LoadedProject, { EmptyState } from './LoadedProject.jsx'
import { ScenarioPanel } from './modules/m4-scenarios/ScenarioPanel.jsx'
import DevelopmentRisk from './modules/m3d-development/DevelopmentRisk.jsx'
import CompletedRisk from './modules/m3c-completed/CompletedRisk.jsx'
import TransitionChecks from './modules/m3t-transitions/TransitionChecks.jsx'
import { KeyRatios, SettingsPanel } from './KeyRatios.jsx'
import BenchmarkTable from './modules/m2-benchmarks/BenchmarkTable.jsx'
import IntegrityChecklist from './modules/m1-integrity/IntegrityChecklist.jsx'
import SponsorPanel from './modules/m5-sponsor/SponsorPanel.jsx'
import './App.css'
import './shell.css'
import { NAV_GROUPS, VIEWS } from './views.jsx'
import ImportPreview from './ImportPreview.jsx'
import { RescueBoundary } from './RescueBoundary.jsx'
import FlagFormat from './FlagFormat.jsx'
import { rescueStore } from './download.js'
import {
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

const APP_NAME = 'Deal Review'

function NavButton({ view, active, hasReview, onPick }) {
  return (
    <button
      type="button"
      role="tab"
      className={`nav-item${view.needsReview && !hasReview ? ' idle' : ''}`}
      aria-selected={active}
      aria-controls="main-panel"
      onClick={() => onPick(view.id)}
    >
      <span className="nav-icon" aria-hidden="true">
        {view.icon}
      </span>
      <span className="nav-label">{view.label}</span>
    </button>
  )
}

export default function App() {
  const [view, setView] = useState('import')
  const [review, setReview] = useState(null) // what "Load workbook" has on screen; the other tabs show it
  const [attempt, setAttempt] = useState(0) // changing this starts the review screen over after a crash
  const current = VIEWS.find((v) => v.id === view)
  const hasReview = Boolean(review)
  const goLoad = () => goTo('import')
  function goTo(id) {
    setView(id)
    window.scrollTo({ top: 0 })
  }

  const heading = current.id === 'import' && !hasReview ? 'Review a loan application in minutes' : current.heading
  const lede =
    current.id === 'import' && !hasReview
      ? 'Load the applicant\u2019s spreadsheet and get the key numbers, data checks, stress tests and risk flags on one page. Everything stays on your device.'
      : current.lede
  const fileName = review?.result?.report?.fileName

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={goLoad} aria-label={`${APP_NAME}: back to the start`}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V10l8-6 8 6v10M9 20v-6h6v6" />
            </svg>
          </span>
          <span className="brand-name">{APP_NAME}</span>
        </button>
        {fileName && (
          <span className="file-pill" title={fileName}>
            <span className="dot" aria-hidden="true" />
            <span className="file-pill-name">{fileName}</span>
          </span>
        )}
      </header>

      <div className="layout">
        <nav className="nav" aria-label="Sections">
          <div className="nav-groups" role="tablist" aria-label="What to show">
            {NAV_GROUPS.map((g) => (
              <div className="nav-group" key={g.title}>
                <p className="nav-title">{g.title}</p>
                <div className="nav-items">
                  {g.ids.map((id) => {
                    const v = VIEWS.find((x) => x.id === id)
                    return <NavButton key={id} view={v} active={view === id} hasReview={hasReview} onPick={goTo} />
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <main className="page" id="main-panel" role="tabpanel">
          <h1>{heading}</h1>
          <p className="lede">{lede}</p>

          {/* Kept on the page (just hidden) so a loaded review is not lost when you look at another tab. */}
          <div hidden={current.id !== 'import'}>
            <RescueBoundary
              key={attempt}
              onReset={() => {
                rescueStore.current = null
                setAttempt((n) => n + 1)
              }}
            >
              <ImportPreview onReview={setReview} onContinue={() => goTo('keynumbers')} />
            </RescueBoundary>
          </div>
          {current.id === 'keynumbers' && (
            <LoadedProject review={review} onGoLoad={goLoad}>
              {(record, firm, settings) => (
                <>
                  <SettingsPanel settings={settings} onChange={review.changeSettings} />
                  <KeyRatios key={record.meta?.projectId} record={record} settings={settings} onOpenGroup={goLoad} />
                  <BenchmarkTable record={record} />
                </>
              )}
            </LoadedProject>
          )}
          {current.id === 'datachecks' && (
            <LoadedProject review={review} onGoLoad={goLoad}>
              {(record, firm, settings, result) => <IntegrityChecklist key={record.meta?.projectId} record={record} firm={firm} facts={result.facts} report={result.report} />}
            </LoadedProject>
          )}
          {current.id === 'scenarios' && (
            <LoadedProject review={review} onGoLoad={goLoad}>
              {(record, firm, settings) => <ScenarioPanel key={record.meta?.projectId} record={record} settings={settings} onOpenGroup={goLoad} />}
            </LoadedProject>
          )}
          {current.id === 'devrisk' && (
            <LoadedProject review={review} onGoLoad={goLoad}>
              {(record, firm, settings) => <DevelopmentRisk key={record.meta?.projectId} record={record} firm={firm} settings={settings} />}
            </LoadedProject>
          )}
          {current.id === 'completedrisk' && (
            <LoadedProject review={review} onGoLoad={goLoad} withT12>
              {(record, firm, settings) => <CompletedRisk key={record.meta?.projectId} record={record} firm={firm} settings={settings} />}
            </LoadedProject>
          )}
          {current.id === 'transitions' && (
            <LoadedProject review={review} onGoLoad={goLoad}>
              {(record, firm, settings) => <TransitionChecks key={record.meta?.projectId} record={record} firm={firm} settings={settings} />}
            </LoadedProject>
          )}
          {current.id === 'sponsor' &&
            (review ? (
              <SponsorPanel firm={review.result.firm} projects={review.result.projects} settings={review.result.settings} sourceLabel={review.result.report?.fileName} onChooseStage={goLoad} />
            ) : (
              <EmptyState onGoLoad={goLoad} />
            ))}
          {current.id === 'flags' && <FlagFormat />}
          {current.schema && (
            <>
              <p className="summary-line">{plural(current.schema.length, 'group')}</p>
              {current.schema.map((g) => (
                <GroupCard key={g.id} group={g} />
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
