import { useState } from 'react'
import { projectReadiness, STAGES } from './modules/shared/index.js'
import { StageControls } from './ImportPreview.jsx'
import { T12Tools } from './T12Tools.jsx'

// What every analysis tab shows. Nothing until a workbook has been loaded; then the loaded projects, one at a time.
// `review` is what the "Load workbook" tab has on screen (see App.jsx), or null when nothing is loaded yet.
export function EmptyState({ onGoLoad }) {
  return (
    <section className="card plain">
      <div className="body">
        <p className="file-name">Nothing to show yet</p>
        <p className="note">Load an applicant workbook first. This page fills in once a workbook has been read.</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={onGoLoad}>
            Go to Load workbook
          </button>
        </div>
      </div>
    </section>
  )
}

// Picks one of the loaded projects (projects with entries only) and draws `children(record, firm, settings, result)` for it.
// withStage: show the stage / date choices above the result, so they can be set without leaving this tab.
// withT12: show the T-12 upload above the result.
export default function LoadedProject({ review, onGoLoad, children, withStage = true, withT12 = false }) {
  const [pick, setPick] = useState(null)
  const result = review?.result
  const projects = result ? result.report.projects.filter((p) => p.hasData) : []
  const chosen = projects.find((p) => p.id === pick) ?? projects[0]

  if (!result) return <EmptyState onGoLoad={onGoLoad} />
  if (!chosen) return <p className="note">The loaded workbook has no project with entries, so there is nothing to show here.</p>

  const record = result.projects.find((r) => r.meta?.projectId === chosen.id)
  if (!record) return null
  const stageLabel = STAGES.find((s) => s.value === record.data.stage.stage)?.label
  const ready = projectReadiness(record).ready
  const edit = (fn) => review.editRecord(chosen.id, fn)

  return (
    <>
      <div className="project-bar">
        <label className="field">
          <span>Project from {result.report.fileName}</span>
          <select value={chosen.id} onChange={(e) => setPick(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.tab}
              </option>
            ))}
          </select>
          {stageLabel && <span className="help">{stageLabel} stage.</span>}
        </label>
        {withStage && <StageControls project={chosen} record={record} onChange={review.changeProject} />}
        {withT12 && (
          <div className="controls">
            <p className="section-label">T-12 (twelve months of actual results)</p>
            <T12Tools record={record} onEdit={edit} />
          </div>
        )}
      </div>
      {!ready && <p className="banner warn">Choose a stage and an &quot;as of&quot; date above to see the checks for this project.</p>}
      {children(record, result.firm, result.settings, result)}
    </>
  )
}
