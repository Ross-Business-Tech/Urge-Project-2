import { useState } from 'react'
import { importWorkbook, ImportError, MAX_FILE_BYTES } from './modules/shared/index.js'

// Groups that are not read from cells, with what to tell the underwriter instead.
const NOT_FROM_CELLS = {
  projects: 'Filled in from the project tabs below',
  stage: 'You choose this after loading',
  t12: 'Loaded separately from a T-12 template',
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function GroupRow({ group }) {
  const total = group.filled + group.blank
  const pct = total === 0 ? 0 : Math.round((group.filled / total) * 100)
  const special = NOT_FROM_CELLS[group.id]
  return (
    <li className="group-row">
      <div className="group-head">
        <span>{group.title}</span>
        {special ? (
          <span className="chip">{special}</span>
        ) : !group.read ? (
          <span className="chip warn">Not read</span>
        ) : (
          <span className="chips">
            <span className="chip">{total === 0 ? 'nothing entered' : `${group.filled} of ${total} filled`}</span>
            {group.errors > 0 && <span className="chip warn">{plural(group.errors, 'error cell')}</span>}
            {group.bad > 0 && <span className="chip warn">{plural(group.bad, 'odd value')}</span>}
          </span>
        )}
      </div>
      {!special && group.read && total > 0 && (
        <div className="bar" role="img" aria-label={`${pct}% filled`}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  )
}

function ProjectCard({ project }) {
  const visibility = project.state === 'veryHidden' ? 'very hidden tab' : project.state === 'hidden' ? 'hidden tab' : null
  return (
    <details className="card">
      <summary>
        <span className="title">{project.name || project.tab}</span>
        <span className="size">{project.hint}</span>
        {visibility && <span className="chip warn">{visibility}</span>}
      </summary>
      <div className="body">
        <ul className="groups">
          {project.groups.map((g) => (
            <GroupRow key={g.id} group={g} />
          ))}
        </ul>
      </div>
    </details>
  )
}

function Report({ result, onReset }) {
  const { report } = result
  const withData = report.projects.filter((p) => p.hasData)
  const empty = report.projects.filter((p) => !p.hasData)
  const skipped = new Set(report.layoutProblems.map((l) => l.tab))
  const emptyReadable = empty.filter((p) => !skipped.has(p.tab))
  const w = report.workbook

  return (
    <>
      <section className="card plain">
        <div className="body">
          <p className="file-name">{report.fileName}</p>
          <ul className="facts">
            <li>
              Workbook version: <strong>{w.version ?? 'not found'}</strong>{' '}
              {w.version && <span className={`chip ${w.versionKnown ? '' : 'warn'}`}>{w.versionKnown ? 'recognized' : 'not recognized'}</span>}
            </li>
            <li>
              {plural(w.sheetCount, 'tab')} ({w.visible} visible, {w.hidden} hidden, {w.veryHidden} very hidden)
            </li>
            <li>{plural(withData.length, 'project')} with data</li>
          </ul>
          <p className="note">Read on this device only. Nothing was uploaded or saved.</p>
        </div>
      </section>

      <h2>Things to look at</h2>
      {report.notes.length === 0 ? (
        <p className="ok">Nothing unusual found in what we read.</p>
      ) : (
        <ul className="notes">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h2>The firm</h2>
      <ul className="groups">
        {report.firmGroups.map((g) => (
          <GroupRow key={g.id} group={g} />
        ))}
      </ul>

      <h2>The projects</h2>
      {withData.length === 0 && <p className="note">No project tab has any entries.</p>}
      {withData.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
      {emptyReadable.length > 0 && (
        <p className="note">
          {plural(emptyReadable.length, 'other project tab')} {emptyReadable.length === 1 ? 'is' : 'are'} empty (template only):{' '}
          {emptyReadable.map((p) => p.tab.replace(/ Details$/, '')).join(', ')}.
        </p>
      )}

      <p className="note">This is a preview. Nothing is saved yet, and no stage has been chosen for any project.</p>
      <button type="button" className="button" onClick={onReset}>
        Choose another file
      </button>
    </>
  )
}

export default function ImportPreview() {
  const [state, setState] = useState({ status: 'idle' })
  const [dragging, setDragging] = useState(false)

  async function handleFile(file) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setState({ status: 'error', message: 'That file is larger than 25 MB, which is too big for this tool.' })
      return
    }
    setState({ status: 'reading', name: file.name })
    try {
      const result = await importWorkbook(file, { fileName: file.name })
      setState({ status: 'done', result })
    } catch (err) {
      const message =
        err instanceof ImportError ? err.message : 'Something went wrong reading that file. Please check it is an .xlsx or .xlsm workbook.'
      setState({ status: 'error', message })
    }
  }

  if (state.status === 'done') return <Report result={state.result} onReset={() => setState({ status: 'idle' })} />

  return (
    <>
      <label
        className={`drop${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFile(e.dataTransfer.files?.[0])
        }}
      >
        <input
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(e) => {
            handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <span className="drop-title">{state.status === 'reading' ? `Reading ${state.name}…` : 'Drop the applicant workbook here'}</span>
        <span className="drop-sub">or tap to choose a file (.xlsx or .xlsm)</span>
      </label>
      {state.status === 'error' && (
        <p className="problem" role="alert">
          {state.message}
        </p>
      )}
      <p className="note">The file is read on this device only. Nothing is uploaded, and macros are never run.</p>
    </>
  )
}
