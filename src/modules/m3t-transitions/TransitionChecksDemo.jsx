import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { scenarios as samples } from '../shared/samples/scenarios.js'
import TransitionChecks from './TransitionChecks.jsx'

// Try the stage-change checks without a workbook: pick one of the made-up sample projects (the same ones used to test every
// module). Every stage is reviewed for its own next hand-off. Nothing here is real data.
export default function TransitionChecksDemo() {
  const [id, setId] = useState(samples.find((s) => s.stage === 'lease_up')?.id ?? samples[0].id)
  const sample = samples.find((s) => s.id === id)
  const { built, record } = useMemo(() => {
    const made = sample.build()
    const project = made.projects[0].record
    if (sample.t12) project.data.t12.rows = sample.t12.rows // the samples that come with a T-12 file
    return { built: made, record: applyStageAndDate(project, { stage: sample.stage, asOfDate: sample.asOf }) }
  }, [sample])
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
        <span className="help">{sample.what}</span>
      </label>
      <TransitionChecks key={sample.id} record={record} firm={built.firm} settings={DEFAULT_SETTINGS} />
    </>
  )
}
