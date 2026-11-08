import { useMemo, useState } from 'react'
import { synthesize, followUpText, moduleName, isInternal } from './index.js'
import './synthesis.css'

const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }
const STAGE_LABEL = { development: 'Development', lease_up: 'Lease-up', completed: 'Completed' }

// One ranked finding: the headline facts on top, the detail behind a tap.
function RankedItem({ item }) {
  return (
    <li className={`synth-item sev-${item.severity}`}>
      <div className="synth-item-head">
        <span className="synth-rank" aria-label={`Number ${item.rank}`}>
          {item.rank}
        </span>
        <span className={`synth-badge sev-${item.severity}`}>{SEVERITY_LABEL[item.severity]}</span>
        <span className="synth-from">{moduleName(item.module)}</span>
      </div>
      <p className="synth-title">{item.title}</p>
      <p className="synth-evidence">{item.evidence}</p>
      {item.cell_refs.length > 0 && (
        <p className="synth-cells">
          <span className="synth-label">Cells: </span>
          {item.cell_refs.map((c) => (
            <code key={c}>{c}</code>
          ))}
        </p>
      )}
      <p className="synth-question">
        <span className="synth-label">{isInternal(item) ? 'For the review team: ' : 'Ask the sponsor: '}</span>
        {item.follow_up}
      </p>
      <details className="synth-detail">
        <summary>More detail</summary>
        <dl>
          <dt>Effect on the downside case</dt>
          <dd>{item.impact.text}</dd>
          <dt>Raised by</dt>
          <dd>
            {item.reportedBy.map((m) => `${moduleName(m)} (${m})`).join(', ')}, layer {item.layer}
            {item.merged > 0 ? `. Reported ${item.merged + 1} times; shown once.` : ''}
          </dd>
          <dt>Stage the check used</dt>
          <dd>{STAGE_LABEL[item.stage_used] ?? item.stage_used}</dd>
          {item.transition && (
            <>
              <dt>Stage change it is about</dt>
              <dd>{item.transition}</dd>
            </>
          )}
          <dt>Finding id</dt>
          <dd>
            <code>{item.id}</code>
          </dd>
        </dl>
      </details>
    </li>
  )
}

// The copy button. If the browser will not copy (no permission, an older phone), the text is shown to select by hand.
function CopyQuestions({ text, count }) {
  const [state, setState] = useState('idle') // idle | copied | manual
  if (!count) return <p className="note">There are no questions for the sponsor.</p>

  const copy = async () => {
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('manual')
    }
  }

  return (
    <div className="synth-copy">
      <button type="button" className="button" onClick={copy}>
        Copy {count} follow-up question{count === 1 ? '' : 's'}
      </button>
      {state === 'copied' && <p className="note" role="status">Copied. Paste it into your email to the sponsor.</p>}
      {state === 'manual' && (
        <>
          <p className="note" role="status">
            This browser would not copy automatically. Select the text below and copy it.
          </p>
          <textarea className="synth-copy-box" readOnly value={text} rows={Math.min(12, count + 3)} onFocus={(e) => e.target.select()} aria-label="Follow-up questions for the sponsor" />
        </>
      )}
    </div>
  )
}

// M6: one summary page per project. Ranked findings on top, the detail behind each, and the questions for the sponsor.
export default function SynthesisPanel({ project, moduleResults, context }) {
  const result = useMemo(() => {
    try {
      return synthesize(project, moduleResults, context)
    } catch {
      return null
    }
  }, [project, moduleResults, context])

  if (!result) {
    return (
      <section className="synthesis">
        <p className="section-label">What to look at first</p>
        <p className="banner warn">The summary could not be put together. Review each check&apos;s results on its own tab.</p>
      </section>
    )
  }

  const { ranked, counts, coverage, notes, headline } = result
  const sponsorText = followUpText(ranked, project)
  const questionCount = result.followUps.length
  let name = ''
  try {
    name = typeof project?.data?.identity?.name === 'string' ? project.data.identity.name : ''
  } catch {
    name = ''
  }

  return (
    <section className="synthesis">
      <p className="section-label">What to look at first{name ? `: ${name}` : ''}</p>
      <p className="synth-headline">{headline}</p>
      <div className="synth-counts" aria-label="Findings by seriousness">
        {['high', 'medium', 'low'].map((s) => (
          <span key={s} className={`synth-badge sev-${s}`}>
            {counts[s]} {SEVERITY_LABEL[s].toLowerCase()}
          </span>
        ))}
        {result.stage && <span className="synth-stage">Stage: {STAGE_LABEL[result.stage]}</span>}
      </div>
      {coverage.notRun.length > 0 ? <p className="banner warn">{coverage.sentence}</p> : <p className="note">{coverage.sentence}</p>}

      <CopyQuestions text={sponsorText} count={questionCount} />

      {ranked.length > 0 ? (
        <ol className="synth-list">
          {ranked.map((item) => (
            <RankedItem key={item.id} item={item} />
          ))}
        </ol>
      ) : (
        <p className="note">No findings to show.</p>
      )}

      {notes.length > 0 && (
        <details className="synth-notes">
          <summary>How this list was put together ({notes.length} note{notes.length === 1 ? '' : 's'})</summary>
          <ul>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
