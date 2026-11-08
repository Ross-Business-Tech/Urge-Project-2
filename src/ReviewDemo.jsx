import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from './modules/shared/index.js'
import { scenarios as samples } from './modules/shared/samples/scenarios.js'
import { run as runM1 } from './modules/m1-integrity/index.js'
import { run as runM2 } from './modules/m2-benchmarks/index.js'
import { run as runM3D } from './modules/m3d-development/index.js'
import { run as runM3C } from './modules/m3c-completed/index.js'
import { run as runM3T } from './modules/m3t-transitions/index.js'
import { run as runM4 } from './modules/m4-scenarios/index.js'
import { synthesize } from './modules/m6-synthesis/index.js'
import BenchmarkTable from './modules/m2-benchmarks/BenchmarkTable.jsx'
import DevelopmentRiskPanel from './modules/m3d-development/DevelopmentRiskPanel.jsx'
import CompletedRiskPanel from './modules/m3c-completed/CompletedRiskPanel.jsx'
import TransitionPanel from './modules/m3t-transitions/TransitionPanel.jsx'
import SponsorPanel from './modules/m5-sponsor/SponsorPanel.jsx'
import SynthesisPanel from './modules/m6-synthesis/SynthesisPanel.jsx'

// Runs every module on one made-up sample project and shows the results. Nothing here is real data.
// Each module is guarded, so one broken module shows a "check failed" flag instead of stopping the screen.
export default function ReviewDemo() {
  const [id, setId] = useState(samples[0].id)
  const sample = samples.find((s) => s.id === id)

  const review = useMemo(() => {
    const built = sample.build()
    const project = built.projects[0].record
    if (sample.t12) project.data.t12.rows = sample.t12.rows
    const record = applyStageAndDate(project, { stage: sample.stage, asOfDate: sample.asOf })
    const firm = built.firm
    const context = { settings: DEFAULT_SETTINGS, firm, projects: [record] }
    const moduleResults = [
      { module: 'M1', ...runM1(record, { firm, facts: null, report: null, projects: [record] }) },
      { module: 'M2', ...runM2(record, context) },
      { module: 'M3D', ...runM3D(record, context) },
      { module: 'M3C', ...runM3C(record, context) },
      { module: 'M3T', ...runM3T(record, context) },
      { module: 'M4', ...runM4(record, context) },
    ]
    const synthesis = synthesize(record, moduleResults, context)
    return { record, firm, context, moduleResults, synthesis }
  }, [sample])

  const stageLabel = STAGES.find((s) => s.value === sample.stage)?.label

  return (
    <>
      <label className="field">
        <span>Made-up sample project</span>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({STAGES.find((x) => x.value === s.stage)?.label})
            </option>
          ))}
        </select>
        <span className="help">
          {stageLabel} stage. {sample.what}
        </span>
      </label>

      <SynthesisPanel project={review.record} moduleResults={review.moduleResults} context={review.context} />

      <h2>Module detail</h2>
      <details className="card">
        <summary><span className="title">Market comparison (M2)</span></summary>
        <div className="body"><BenchmarkTable record={review.record} /></div>
      </details>
      <details className="card">
        <summary><span className="title">Development risk (M3D)</span></summary>
        <div className="body"><DevelopmentRiskPanel project={review.record} context={review.context} /></div>
      </details>
      <details className="card">
        <summary><span className="title">Completed risk (M3C)</span></summary>
        <div className="body"><CompletedRiskPanel project={review.record} context={review.context} /></div>
      </details>
      <details className="card">
        <summary><span className="title">Stage changes (M3T)</span></summary>
        <div className="body"><TransitionPanel project={review.record} context={review.context} /></div>
      </details>
      <details className="card">
        <summary><span className="title">Sponsor (M5-a)</span></summary>
        <div className="body">
          <SponsorPanel firm={review.firm} projects={review.context.projects} settings={DEFAULT_SETTINGS} sourceLabel="Made-up sample" />
        </div>
      </details>
    </>
  )
}
