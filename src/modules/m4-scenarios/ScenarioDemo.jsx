import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { scenarios as samples } from '../shared/samples/scenarios.js'
import { ScenarioPanel } from './ScenarioPanel.jsx'

// Try the scenario screen without a workbook: pick one of the made-up sample projects (the same ones used to test every
// module) and stress it. Nothing here is real data.
export default function ScenarioDemo() {
  const [id, setId] = useState(samples[0].id)
  const sample = samples.find((s) => s.id === id)
  const record = useMemo(() => {
    const project = sample.build().projects[0].record
    if (sample.t12) project.data.t12.rows = sample.t12.rows // the samples that come with a T-12 file
    return applyStageAndDate(project, { stage: sample.stage, asOfDate: sample.asOf })
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
      <ScenarioPanel key={sample.id} record={record} settings={DEFAULT_SETTINGS} />
    </>
  )
}
