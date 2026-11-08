import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { scenarios } from '../shared/samples/scenarios.js'
import DevelopmentRisk from './DevelopmentRisk.jsx'

// Try the development risk checks without a workbook: pick one of the made-up sample projects (the same ones used to test
// every module). Completed samples are left out because M3D does not review them. Nothing here is real data.
const samples = scenarios.filter((s) => s.stage !== 'completed')

export default function DevelopmentRiskDemo() {
  const [id, setId] = useState(samples[0].id)
  const sample = samples.find((s) => s.id === id)
  const built = useMemo(() => sample.build(), [sample])
  const record = useMemo(() => applyStageAndDate(built.projects[0].record, { stage: sample.stage, asOfDate: sample.asOf }), [built, sample])
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
      <DevelopmentRisk key={sample.id} record={record} firm={built.firm} settings={DEFAULT_SETTINGS} />
    </>
  )
}
