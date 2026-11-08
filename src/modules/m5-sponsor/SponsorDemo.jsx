import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { scenarios as samples } from '../shared/samples/scenarios.js'
import SponsorPanel from './SponsorPanel.jsx'

// Try the sponsor page without a workbook: pick one of the made-up sample sponsors (the same ones used to test every
// module). Nothing here is real data.
export default function SponsorDemo() {
  const [id, setId] = useState(samples[0].id)
  const sample = samples.find((s) => s.id === id)
  const { firm, projects } = useMemo(() => {
    const built = sample.build()
    return {
      firm: built.firm,
      projects: built.projects.map((p, i) => {
        const record = i === 0 ? applyStageAndDate(p.record, { stage: sample.stage, asOfDate: sample.asOf }) : p.record
        return record
      }),
    }
  }, [sample])
  const stageLabel = STAGES.find((s) => s.value === sample.stage)?.label

  return (
    <>
      <label className="field">
        <span>Made-up sample sponsor</span>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <span className="help">
          {stageLabel} stage project. {sample.what}
        </span>
      </label>
      <SponsorPanel key={sample.id} firm={firm} projects={projects} settings={DEFAULT_SETTINGS} />
    </>
  )
}
