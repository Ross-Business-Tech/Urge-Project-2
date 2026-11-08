import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { scenarios } from '../shared/samples/scenarios.js'
import CompletedRisk from './CompletedRisk.jsx'

// Try the completed risk checks without a workbook: pick one of the made-up sample projects (the same ones used to test every
// module). Development samples are left out because M3C does not review them. Nothing here is real data.
const samples = scenarios.filter((s) => s.stage !== 'development')

export default function CompletedRiskDemo() {
  const [id, setId] = useState(samples[0].id)
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
      <CompletedRisk key={sample.id} record={record} firm={built.firm} settings={DEFAULT_SETTINGS} />
    </>
  )
}
