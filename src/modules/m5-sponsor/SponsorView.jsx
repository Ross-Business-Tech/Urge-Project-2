import { useMemo, useState } from 'react'
import { applyStageAndDate, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { scenarios as samples } from '../shared/samples/scenarios.js'
import { rescueStore } from '../../download.js'
import SponsorPanel from './SponsorPanel.jsx'
import { trackRecordDemos } from './demoSponsors.js'

const ALL = [...samples, ...trackRecordDemos]

// The Sponsor tab. If a workbook (or saved review) is loaded, it shows that sponsor first. The made-up sample sponsors
// (the same ones used to test every module) are always available too. Nothing here is real data.
export default function SponsorView({ onChooseStage }) {
  const loaded = rescueStore.current // the review on screen in "Load workbook", if any
  const [source, setSource] = useState(loaded ? 'loaded' : 'sample')
  const [id, setId] = useState(samples[0].id)
  const sample = ALL.find((s) => s.id === id)

  const demo = useMemo(() => {
    const built = sample.build()
    return {
      firm: built.firm,
      projects: built.projects.map((p) => applyStageAndDate(p.record, { stage: p.stage ?? sample.stage, asOfDate: sample.asOf })),
    }
  }, [sample])

  const showLoaded = Boolean(loaded) && source === 'loaded'
  const stageLabel = STAGES.find((s) => s.value === sample.stage)?.label
  const fileName = loaded?.report?.fileName ?? 'the loaded review'

  return (
    <>
      {loaded ? (
        <div className="source-switch" role="group" aria-label="Which sponsor to show">
          <button type="button" className={`button ${showLoaded ? 'primary' : ''}`} aria-pressed={showLoaded} onClick={() => setSource('loaded')}>
            My loaded workbook
          </button>
          <button type="button" className={`button ${showLoaded ? '' : 'primary'}`} aria-pressed={!showLoaded} onClick={() => setSource('sample')}>
            Made-up samples
          </button>
        </div>
      ) : (
        <p className="note">No workbook is loaded yet. Showing made-up samples. Load a workbook (first tab) and come back to see your own sponsor here.</p>
      )}

      {showLoaded ? (
        <SponsorPanel firm={loaded.firm} projects={loaded.projects} settings={loaded.settings ?? DEFAULT_SETTINGS} sourceLabel={fileName} onChooseStage={onChooseStage} />
      ) : (
        <>
          <label className="field">
            <span>Made-up sample sponsor</span>
            <select value={id} onChange={(e) => setId(e.target.value)}>
              <optgroup label="Track record examples">
                {trackRecordDemos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Test samples (one project each)">
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </optgroup>
            </select>
            <span className="help">
              {stageLabel} stage project. {sample.what}
            </span>
          </label>
          <SponsorPanel key={sample.id} firm={demo.firm} projects={demo.projects} settings={DEFAULT_SETTINGS} sourceLabel={`made-up sample: ${sample.title}`} onChooseStage={onChooseStage} />
        </>
      )}
    </>
  )
}
