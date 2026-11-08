import { fmt } from '../shared/index.js'
import { labelFor } from './index.js'

const BAND = { Strong: 'good', Adequate: '', Weak: 'amber', Failing: 'warn' }
const STATUS = {
  good: { chip: 'good', text: 'On target' },
  watch: { chip: 'amber', text: 'Behind' },
  concern: { chip: 'warn', text: 'Fell short' },
  unavailable: { chip: '', text: 'Not available' },
}

const QUESTIONS = {
  income: 'Did the completed projects earn what was underwritten?',
  rentOccupancy: 'Did they reach the rents and occupancy that were promised?',
  stabilization: 'Did they fill up and stabilize by the promised date?',
  scale: 'Is the new project a believable step up from what the sponsor has built?',
}

function Part({ part }) {
  const band = part.ok ? labelFor(part.score).label : null
  return (
    <li className={`measure ${part.ok ? '' : 'missing'}`}>
      <div className="measure-top">
        <span className="measure-title">{part.title}</span>
        <span className="chips">
          <span className="chip">counts {Math.round(part.weight * 100)}%</span>
          {band && <span className={`chip ${BAND[band]}`}>{band}</span>}
        </span>
      </div>
      <p className="measure-question">{QUESTIONS[part.id]}</p>
      {part.ok ? (
        <>
          <div className="bar" role="meter" aria-label={`${part.title} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part.score)}>
            <div className={`bar-fill ${BAND[band] || 'plain'}`} style={{ width: `${Math.max(2, Math.round(part.score))}%` }} />
          </div>
          <p className="measure-score">Score {Math.round(part.score)} out of 100</p>
          <ul className="measure-detail">
            {part.detail.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="measure-note">{part.reason}</p>
      )}
    </li>
  )
}

// The worked sum behind the credibility score, so it is clear how the number was reached.
function HowReached({ track }) {
  const left = track.parts.filter((p) => !p.ok)
  return (
    <div className="reached">
      <p className="reached-title">How this score was reached</p>
      <ul className="reached-rows">
        {track.breakdown.map((b) => (
          <li key={b.id}>
            <span>{b.title}</span>
            <span className="reached-math">
              {Math.round(b.score)} × {Math.round(b.share * 100)}% = {b.points.toFixed(1)}
            </span>
          </li>
        ))}
        <li className="reached-total">
          <span>Credibility score</span>
          <span className="reached-math">{track.score} out of 100</span>
        </li>
      </ul>
      <p className="note">
        Each part is the <strong>average across the completed projects</strong>, so a weak project is balanced by strong ones, not hidden: the project cards below show each
        one on its own.
        {left.length > 0 && ` Left out because it could not be worked out: ${left.map((p) => p.title.toLowerCase()).join(', ')}. The rest are scaled up to add to 100%.`}
      </p>
      {track.summary.count === 1 && <p className="note">This rests on a single completed project. Add more below for a more reliable score.</p>}
    </div>
  )
}

// A plain guide to adding more projects, with what is loaded so far.
function AddProjects({ track, onAddProjects }) {
  const rows = track.projects
  const withT12 = rows.filter((p) => p.months > 0).length
  const missing = rows.filter((p) => p.months === 0).map((p) => p.name)
  return (
    <div className="add-projects">
      <p className="add-title">Add more completed projects</p>
      <p>The more completed projects the sponsor has, the more reliable this score. You can add as many as you like:</p>
      <ol>
        <li>
          Put each past project on its own <strong>Completed Project</strong> tab in the applicant workbook. One workbook holds them all, and each tab is read as its own project.
        </li>
        <li>
          Load the workbook on the first tab. For each past project, choose the stage <strong>Completed</strong> and an &quot;as of&quot; date.
        </li>
        <li>
          Open each completed project&apos;s <strong>Trailing 12 months</strong> group and load its T-12 file.
        </li>
      </ol>
      <p className="add-status" role="status">
        {rows.length === 0
          ? 'No completed projects are loaded yet.'
          : `${rows.length} completed project${rows.length === 1 ? '' : 's'} loaded, ${withT12} with a T-12.${missing.length ? ` Still needs a T-12: ${missing.join(', ')}.` : ''}`}
      </p>
      {onAddProjects && (
        <button type="button" className="button small primary" onClick={onAddProjects}>
          Go to Load workbook
        </button>
      )}
    </div>
  )
}

function Delivery({ project }) {
  return (
    <li className="delivery">
      <details open>
        <summary>
          <span className="project-name">{project.name}</span>
          <span className="chips">
            {project.score !== null && project.score !== undefined && <span className={`chip ${BAND[labelFor(project.score).label]}`}>this project alone: {project.score}</span>}
            {project.units && <span className="chip">{project.units} units</span>}
            {project.size && <span className="chip">{fmt.usd(project.size)}</span>}
          </span>
        </summary>
        <ul className="delivery-rows">
          {project.measures.map((m) => {
            const st = STATUS[m.status]
            return (
              <li key={m.id} className={`delivery-row ${m.status}`}>
                <div className="delivery-top">
                  <span className="delivery-label">{m.label}</span>
                  <span className="chips">
                    <span className={`chip ${st.chip}`}>{st.text}</span>
                  </span>
                </div>
                {(m.status !== 'unavailable' || m.projected !== '—') && (
                  <p className="delivery-nums">
                    <span>
                      Promised <strong>{m.projected}</strong>
                    </span>
                    {m.status !== 'unavailable' && (
                      <span>
                        Delivered <strong>{m.delivered}</strong>
                      </span>
                    )}
                  </p>
                )}
                <p className="delivery-note">{m.note}</p>
              </li>
            )
          })}
        </ul>
      </details>
    </li>
  )
}

// M5-b: the sponsor's track record. "Has this sponsor delivered what it promised before?" Shows the credibility score,
// the four parts behind it, and a promised-vs-delivered table for each completed project.
export default function TrackRecordSection({ track, reviewedStage, onAddProjects }) {
  return (
    <section className="track">
      <p className="section-label">Track record: has this sponsor delivered before?</p>

      {track.ok ? (
        <div className="score-card">
          <div className={`score-dial ${BAND[track.label] || 'plain'}`} aria-label={`Credibility score ${track.score} out of 100`}>
            <span className="score-number">{track.score}</span>
            <span className="score-of">of 100</span>
          </div>
          <div className="score-text">
            <p className="score-label">{track.label}</p>
            <p>Credibility score: {track.plain}</p>
            <p className="note">
              {track.summary.count} completed project{track.summary.count === 1 ? '' : 's'}
              {track.summary.units ? `, ${track.summary.units} units` : ''}
              {track.summary.largest ? `, largest ${fmt.usd(track.summary.largest)}` : ''}. Based on {track.used} of {track.total} parts.
            </p>
          </div>
        </div>
      ) : track.noTrackRecord ? (
        <div className="so-what amber" role="status">
          <p className="so-what-title">No track record</p>
          <p className="so-what-text">No completed projects are loaded for this sponsor, so there is nothing to judge.</p>
          {track.notes
            .filter((n) => n.includes('no stage yet'))
            .map((n) => (
              <p className="note" key={n}>
                {n} Choose a stage for it to count.
              </p>
            ))}
          {reviewedStage === 'development' && <p className="note">For a project still being built, ask who else carries the delivery risk: an experienced partner, a guarantor or the general contractor.</p>}
        </div>
      ) : (
        <p className="banner warn" role="status">
          {track.reason}
        </p>
      )}

      {track.ok && <HowReached track={track} />}

      <AddProjects track={track} onAddProjects={onAddProjects} />

      {track.parts.length > 0 && (
        <ul className="measures">
          {track.parts.map((p) => (
            <Part key={p.id} part={p} />
          ))}
        </ul>
      )}

      {track.projects.length > 0 && (
        <>
          <p className="section-label">Promised vs. delivered, by completed project</p>
          <ul className="deliveries">
            {track.projects.map((p, i) => (
              <Delivery key={`${p.name}-${i}`} project={p} />
            ))}
          </ul>
        </>
      )}

      {track.notes.length > 0 && (
        <details className="assumptions">
          <summary>About this evidence ({track.notes.length})</summary>
          {track.notes.map((n) => (
            <p className="measure-note" key={n}>
              {n}
            </p>
          ))}
        </details>
      )}
    </section>
  )
}
