import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  importWorkbook,
  ImportError,
  MAX_FILE_BYTES,
  parseReview,
  ReviewFileError,
  STAGES,
  firmSchema,
  projectSchema,
  countGroup,
  applyStageAndDate,
  projectReadiness,
  reviewReadiness,
  DEFAULT_SETTINGS,
} from './modules/shared/index.js'
import { GroupEditor } from './RecordEditor.jsx'
import { T12Tools } from './T12Tools.jsx'
import { downloadReview, rescueStore } from './download.js'
import { SAMPLES, buildSampleReview } from './sampleReview.js'

// Today's date on this device, as YYYY-MM-DD.
function todayLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Groups that have no tab to read from in the applicant workbook.
const NO_TAB = new Set(['projects', 't12', 'stage'])

// One group of a record: a summary line with a live fill bar that opens into the editing form. The form is only built
// once the group is opened, and the row only redraws when its own record changes, so a big workbook stays fast.
const GroupRow = memo(function GroupRow({ schemaGroup, reportGroup, record, recordKey, onEdit }) {
  const [open, setOpen] = useState(false)
  const edit = useCallback((fn) => onEdit(recordKey, fn), [onEdit, recordKey])
  const live = countGroup(schemaGroup, record.data[schemaGroup.id])
  const pct = live.total === 0 ? 0 : Math.round((live.filled / live.total) * 100)
  const unread = reportGroup && !reportGroup.read && !NO_TAB.has(schemaGroup.id)
  return (
    <li className="group-row">
      <details className="group-details" data-group={`${recordKey}:${schemaGroup.id}`} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <div className="group-head">
            <span>{schemaGroup.title}</span>
            <span className="chips">
              <span className="chip">{live.total === 0 ? 'nothing entered' : `${live.filled} of ${live.total} filled`}</span>
              {unread && <span className="chip warn">not read from the workbook</span>}
              {reportGroup?.errors > 0 && <span className="chip warn">{plural(reportGroup.errors, 'error cell')} in the workbook</span>}
              {reportGroup?.bad > 0 && <span className="chip warn">{plural(reportGroup.bad, 'odd value')} in the workbook</span>}
            </span>
          </div>
          {live.total > 0 && (
            <div className="bar" role="img" aria-label={`${pct}% filled`}>
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </summary>
        <div className="editor">
          {open && schemaGroup.id === 't12' && <T12Tools record={record} onEdit={edit} />}
          {open && <GroupEditor group={schemaGroup} record={record} onEdit={edit} />}
        </div>
      </details>
    </li>
  )
})

// The two choices only the underwriter can make for a project: its stage and the date its facts are "as of".
export function StageControls({ project, record, onChange }) {
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

const PROJECT_GROUPS = projectSchema.filter((g) => g.id !== 'stage')

const ProjectCard = memo(function ProjectCard({ project, record, onChange, onEdit }) {
  const [open, setOpen] = useState(false)
  const visibility = project.state === 'veryHidden' ? 'very hidden tab' : project.state === 'hidden' ? 'hidden tab' : null
  const { ready } = projectReadiness(record)
  const chosen = STAGES.find((s) => s.value === record.data.stage.stage)
  return (
    <details className="card" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="title">{project.name || project.tab}</span>
        <span className="size">{project.hint}</span>
        <span className="chips">
          {ready ? <span className="chip good">{chosen?.label}</span> : <span className="chip warn">needs stage and date</span>}
          {visibility && <span className="chip warn">{visibility}</span>}
        </span>
      </summary>
      {open && (
        <div className="body">
          <StageControls project={project} record={record} onChange={onChange} />
          <div className="controls">
            <p className="section-label">T-12 (twelve months of actual results)</p>
            <p className="note">{record.data.t12.rows.length > 0 ? `${record.data.t12.rows.length} month${record.data.t12.rows.length === 1 ? '' : 's'} loaded.` : 'No T-12 loaded yet. It is optional, and it is what lets the completed-property checks run.'}</p>
            <T12Tools record={record} onEdit={(fn) => onEdit(project.id, fn)} />
          </div>
          <p className="section-label">Values (tap a group to view or edit)</p>
          <ul className="groups">
            {PROJECT_GROUPS.map((g) => (
              <GroupRow key={g.id} schemaGroup={g} reportGroup={project.groups.find((x) => x.id === g.id)} record={record} recordKey={project.id} onEdit={onEdit} />
            ))}
          </ul>
        </div>
      )}
    </details>
  )
})

function Report({ result, saved, reopenedAt, onSave, onReset, onProjectChange, onEdit, onContinue }) {
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
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <p className="eyebrow">Workbook loaded</p>
            <p className="file-name">{report.fileName}</p>
          </div>
          {onContinue && (
            <button type="button" className="button primary" onClick={onContinue}>
              See the key numbers
            </button>
          )}
        </div>
        <ul className="stats">
          <li>
            <span className="stat-value">{withData.length}</span>
            <span className="stat-label">{withData.length === 1 ? 'project' : 'projects'} with data</span>
          </li>
          <li>
            <span className="stat-value">{w.sheetCount}</span>
            <span className="stat-label">tabs ({w.hidden + w.veryHidden} hidden)</span>
          </li>
          <li>
            <span className="stat-value small">{w.version ?? 'not found'}</span>
            <span className="stat-label">{w.version ? (w.versionKnown ? 'workbook version, recognized' : 'workbook version, not recognized') : 'workbook version'}</span>
          </li>
        </ul>
        {reopenedAt && <p className="note">Reopened from a review saved on {new Date(reopenedAt).toLocaleDateString()}.</p>}
        <p className="note">Read on this device only. Nothing was uploaded.</p>
      </section>

      <h2>Things to look at</h2>
      <p className="note">These describe the workbook as it was read. They do not change when you edit values below.</p>
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
      <p className="note">Tap a group to see and edit its values. A small tag under each value says where it came from. The checks and analysis are on the other tabs.</p>
      <ul className="groups">
        {firmSchema.map((g) => (
          <GroupRow
            key={g.id}
            schemaGroup={g}
            reportGroup={report.firmGroups.find((x) => x.id === g.id)}
            record={result.firm}
            recordKey="firm"
            onEdit={onEdit}
          />
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
        return record ? <ProjectCard key={p.id} project={p} record={record} onChange={onProjectChange} onEdit={onEdit} /> : null
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

export default function ImportPreview({ onReview, onContinue }) {
  const [state, setState] = useState({ status: 'idle' })
  const [dragging, setDragging] = useState(false)
  const latest = useRef(0) // a ticket per file chosen, so a slow file cannot overwrite a newer choice

  // Keep a copy of the review on screen where the crash screen can find it.
  useEffect(() => {
    rescueStore.current = state.status === 'done' ? state.result : null
  }, [state])

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
    const ticket = ++latest.current
    if (file.size > MAX_FILE_BYTES) {
      setState({ status: 'error', message: 'That file is larger than 25 MB, which is too big for this tool.' })
      return
    }
    setState({ status: 'reading', name: file.name })
    try {
      if (/\.json$/i.test(file.name)) {
        const review = parseReview(await file.text())
        if (ticket !== latest.current) return // a newer file was chosen while this one was being read
        setState({ status: 'done', result: review, saved: true, reopenedAt: review.savedAt })
      } else {
        const result = await importWorkbook(file, { fileName: file.name })
        if (ticket !== latest.current) return
        setState({ status: 'done', result: { ...result, settings: { ...DEFAULT_SETTINGS } }, saved: false })
      }
    } catch (err) {
      if (ticket !== latest.current) return
      const message =
        err instanceof ImportError || err instanceof ReviewFileError
          ? err.message
          : 'Something went wrong reading that file. Please check it is an .xlsx or .xlsm workbook, or a saved review.'
      setState({ status: 'error', message })
    }
  }

  async function loadSample(id) {
    const ticket = ++latest.current
    setState({ status: 'reading', name: 'the sample' })
    try {
      const result = await buildSampleReview(id)
      if (ticket !== latest.current) return
      setState({ status: 'done', result, saved: true })
    } catch {
      if (ticket !== latest.current) return
      setState({ status: 'error', message: 'The sample could not be opened. Please try again, or load a workbook of your own.' })
    }
  }

  function reset() {
    if (unsaved && !window.confirm('This review has not been saved. Leave without saving?')) return
    latest.current++ // cancels any file still being read
    setState({ status: 'idle' })
  }

  // Change one record ('firm' or a project id) with a function that returns the edited copy. Marks the review unsaved.
  const editRecord = useCallback((target, fn) => {
    setState((s) => ({
      ...s,
      saved: false,
      result:
        target === 'firm'
          ? { ...s.result, firm: fn(s.result.firm) }
          : { ...s.result, projects: s.result.projects.map((p) => (p.meta?.projectId === target ? fn(p) : p)) },
    }))
  }, [])

  const changeSettings = useCallback((patch) => setState((s) => ({ ...s, saved: false, result: { ...s.result, settings: { ...s.result.settings, ...patch } } })), [])
  const changeProject = useCallback((id, patch) => editRecord(id, (p) => applyStageAndDate(p, patch)), [editRecord])

  // Tell the page what is loaded, so the other tabs can show it. null while nothing is loaded.
  const done = state.status === 'done'
  const result = done ? state.result : null
  useEffect(() => {
    onReview?.(result ? { result, editRecord, changeProject, changeSettings } : null)
  }, [onReview, result, editRecord, changeProject, changeSettings])

  function save() {
    downloadReview(state.result)
    setState((s) => ({ ...s, saved: true }))
  }

  if (state.status === 'done') {
    return <Report result={state.result} saved={state.saved} reopenedAt={state.reopenedAt} onSave={save} onReset={reset} onProjectChange={changeProject} onEdit={editRecord} onContinue={onContinue} />
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
        <span className="drop-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
        </span>
        <span className="drop-title">{state.status === 'reading' ? `Reading ${state.name}…` : 'Drop the applicant workbook here'}</span>
        <span className="drop-sub">or tap to choose a file (.xlsx, .xlsm, or a saved review .json)</span>
        <span className="drop-sub faint">Several projects? Put them in one workbook, one tab each. Past projects help the sponsor&apos;s track record.</span>
      </label>
      {state.status === 'error' && (
        <p className="problem" role="alert">
          {state.message}
        </p>
      )}
      <div className="samples">
        <p className="section-label">No workbook handy? Try a sample</p>
        <div className="sample-grid">
          {SAMPLES.map((sample) => (
            <button type="button" key={sample.id} className="sample" disabled={state.status === 'reading'} onClick={() => loadSample(sample.id)}>
              <span className="sample-title">{sample.label}</span>
              <span className="sample-blurb">{sample.blurb}</span>
            </button>
          ))}
        </div>
        <p className="note">Samples use made-up data.</p>
      </div>
      <p className="privacy">Files are read on this device only. Nothing is uploaded, and macros are never run.</p>
    </>
  )
}
