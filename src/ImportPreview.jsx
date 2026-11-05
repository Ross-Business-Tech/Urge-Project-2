import { useEffect, useState } from 'react'
import {
  importWorkbook,
  ImportError,
  MAX_FILE_BYTES,
  buildReview,
  serializeReview,
  parseReview,
  reviewFileName,
  ReviewFileError,
  STAGES,
  applyStageAndDate,
  projectReadiness,
  reviewReadiness,
} from './modules/shared/index.js'

// Today's date on this device, as YYYY-MM-DD.
function todayLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Download a review as a file. Nothing is sent anywhere.
function downloadReview(result) {
  const blob = new Blob([serializeReview(buildReview(result))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = reviewFileName()
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

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

// The two choices only the underwriter can make for a project: its stage and the date its facts are "as of".
function StageControls({ project, record, onChange }) {
  const { stage, asOfDate } = record.data.stage
  const today = todayLocal()
  const chosen = STAGES.find((s) => s.value === stage)
  return (
    <div className="controls">
      <p className="section-label">Your choices</p>
      <p className="note">You choose the stage; the tool never guesses it.</p>
      <label className="field">
        <span>Stage</span>
        <select value={stage ?? ''} onChange={(e) => onChange(project.id, { stage: e.target.value || null })}>
          <option value="">Choose a stage…</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {chosen && <span className="help">{chosen.plain}</span>}
      </label>
      <label className="field">
        <span>&quot;As of&quot; date</span>
        <span className="field-row">
          <input type="date" value={asOfDate ?? ''} max={today} onChange={(e) => onChange(project.id, { asOfDate: e.target.value || null })} />
          <button type="button" className="button small" onClick={() => onChange(project.id, { asOfDate: today })}>
            Today
          </button>
        </span>
        <span className="help">The date the facts in this workbook are true for.</span>
      </label>
    </div>
  )
}

function ProjectCard({ project, record, onChange }) {
  const visibility = project.state === 'veryHidden' ? 'very hidden tab' : project.state === 'hidden' ? 'hidden tab' : null
  const { ready } = projectReadiness(record)
  const chosen = STAGES.find((s) => s.value === record.data.stage.stage)
  return (
    <details className="card">
      <summary>
        <span className="title">{project.name || project.tab}</span>
        <span className="size">{project.hint}</span>
        <span className="chips">
          {ready ? <span className="chip good">{chosen?.label}</span> : <span className="chip warn">needs stage and date</span>}
          {visibility && <span className="chip warn">{visibility}</span>}
        </span>
      </summary>
      <div className="body">
        <StageControls project={project} record={record} onChange={onChange} />
        <p className="section-label">What was read</p>
        <ul className="groups">
          {project.groups
            .filter((g) => g.id !== 'stage')
            .map((g) => (
              <GroupRow key={g.id} group={g} />
            ))}
        </ul>
      </div>
    </details>
  )
}

function Report({ result, saved, reopenedAt, onSave, onReset, onProjectChange }) {
  const { report } = result
  const readiness = reviewReadiness(result.projects)
  const recordFor = (id) => result.projects.find((r) => r.meta?.projectId === id)
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
          {reopenedAt && <p className="note">Reopened from a review saved on {new Date(reopenedAt).toLocaleDateString()}.</p>}
          <p className="note">Read on this device only. Nothing was uploaded.</p>
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
      {withData.length > 0 && (
        <p className={readiness.ready ? 'ok' : 'banner warn'} role="status">
          {readiness.ready
            ? `All ${plural(readiness.total, 'project')} have a stage and an "as of" date.`
            : `${readiness.waiting} of ${plural(readiness.total, 'project')} still need a stage and an "as of" date. Open a project to choose them.`}
        </p>
      )}
      {withData.map((p) => {
        const record = recordFor(p.id)
        return record ? <ProjectCard key={p.id} project={p} record={record} onChange={onProjectChange} /> : null
      })}
      {emptyReadable.length > 0 && (
        <p className="note">
          {plural(emptyReadable.length, 'other project tab')} {emptyReadable.length === 1 ? 'is' : 'are'} empty (template only):{' '}
          {emptyReadable.map((p) => p.tab.replace(/ Details$/, '')).join(', ')}.
        </p>
      )}

      <div className="actions">
        <button type="button" className="button primary" onClick={onSave}>
          Save this review
        </button>
        <button type="button" className="button" onClick={onReset}>
          Choose another file
        </button>
      </div>
      <p className={saved ? 'ok' : 'note'} role="status">
        {saved
          ? 'Saved. The file is in your downloads. Open it again here later with "Drop the applicant workbook here".'
          : 'Not saved yet. Saving downloads a file to this device; no copy is kept in the browser.'}
      </p>
    </>
  )
}

export default function ImportPreview() {
  const [state, setState] = useState({ status: 'idle' })
  const [dragging, setDragging] = useState(false)

  // Warn before leaving the page with work that has not been saved to a file.
  const unsaved = state.status === 'done' && !state.saved
  useEffect(() => {
    if (!unsaved) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  async function handleFile(file) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setState({ status: 'error', message: 'That file is larger than 25 MB, which is too big for this tool.' })
      return
    }
    setState({ status: 'reading', name: file.name })
    try {
      if (/\.json$/i.test(file.name)) {
        const review = parseReview(await file.text())
        setState({ status: 'done', result: review, saved: true, reopenedAt: review.savedAt })
      } else {
        const result = await importWorkbook(file, { fileName: file.name })
        setState({ status: 'done', result, saved: false })
      }
    } catch (err) {
      const message =
        err instanceof ImportError || err instanceof ReviewFileError
          ? err.message
          : 'Something went wrong reading that file. Please check it is an .xlsx or .xlsm workbook, or a saved review.'
      setState({ status: 'error', message })
    }
  }

  function reset() {
    if (unsaved && !window.confirm('This review has not been saved. Leave without saving?')) return
    setState({ status: 'idle' })
  }

  function changeProject(id, patch) {
    setState((s) => ({
      ...s,
      saved: false,
      result: { ...s.result, projects: s.result.projects.map((p) => (p.meta?.projectId === id ? applyStageAndDate(p, patch) : p)) },
    }))
  }

  function save() {
    downloadReview(state.result)
    setState({ ...state, saved: true })
  }

  if (state.status === 'done') {
    return <Report result={state.result} saved={state.saved} reopenedAt={state.reopenedAt} onSave={save} onReset={reset} onProjectChange={changeProject} />
  }

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
          accept=".xlsx,.xlsm,.json"
          onChange={(e) => {
            handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <span className="drop-title">{state.status === 'reading' ? `Reading ${state.name}…` : 'Drop the applicant workbook here'}</span>
        <span className="drop-sub">or a saved review. Tap to choose a file (.xlsx, .xlsm or .json)</span>
      </label>
      {state.status === 'error' && (
        <p className="problem" role="alert">
          {state.message}
        </p>
      )}
      <p className="note">Files are read on this device only. Nothing is uploaded, and macros are never run.</p>
    </>
  )
}
