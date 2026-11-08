import { useMemo } from 'react'
import { fmt } from '../shared/index.js'
import { firmHealth, run, trackRecord, WEIGHTS, TRACK_WEIGHTS, LABELS } from './index.js'
import { soWhat } from './soWhat.js'
import TrackRecordSection from './TrackRecordSection.jsx'
import './sponsor.css'

// What each measure asks, in plain words.
const QUESTIONS = {
  liquidity: 'Can the firm pay what it owes within a year?',
  globalDscr: "Do the firm's earnings and its projects cover all the loan payments together?",
  feeDependence: 'Does the firm live off one fee, and is its income shrinking?',
  leverage: 'How much of the firm is financed by debt?',
}

const BAND = { Strong: 'good', Adequate: '', Weak: 'amber', Failing: 'warn' }
const SEVERITY = { high: 'warn', medium: 'amber', low: '' }

const headline = (p) => {
  if (!p.ok) return 'Not available'
  if (p.text) return p.text
  if (p.id === 'feeDependence') return `${fmt.pct(p.value, 0)} of income is the developer fee`
  if (p.id === 'leverage') return `${p.value.toFixed(2)}× equity`
  return fmt.times(p.value)
}

const bandOf = (score) => LABELS.find((l) => score >= l.min).label

function Measure({ part }) {
  const band = part.ok ? bandOf(part.score) : null
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
      <p className="measure-value">{headline(part)}</p>
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
          {part.notes.length > 0 && (
            <details className="assumptions">
              <summary>Show assumptions ({part.notes.length})</summary>
              {part.notes.map((n) => (
                <p className="measure-note" key={n}>
                  {n}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <p className="measure-note">{part.reason}</p>
      )}
    </li>
  )
}

// M5-a: the sponsor page for one firm and its projects. Shows the firm health score, what it means for the projects
// ("so what"), and the four measures behind it. `sourceLabel` names where the data came from, such as the file name.
export default function SponsorPanel({ firm, projects = [], settings, sourceLabel, onChooseStage }) {
  // The project under review: the first one that is not yet completed, else the first with a stage. Flags always say
  // which stage they ran under, and the scale fit compares this project with what the sponsor has delivered.
  const reviewed = useMemo(() => {
    const stage = (p) => p.data?.stage?.stage
    return projects.find((p) => stage(p) && stage(p) !== 'completed') ?? projects.find((p) => stage(p)) ?? null
  }, [projects])

  const { result, meaning, track } = useMemo(() => {
    try {
      const health = firmHealth(firm, projects, settings)
      const track = trackRecord(firm, projects, settings, reviewed)
      return { result: health, meaning: soWhat(health, projects, settings, track), track }
    } catch {
      return { result: 'error', meaning: null, track: null }
    }
  }, [firm, projects, settings, reviewed])

  const flagRun = useMemo(() => {
    if (!reviewed || !firm) return null
    try {
      return run(reviewed, { firm, projects, settings })
    } catch {
      return null
    }
  }, [firm, projects, settings, reviewed])

  if (result === 'error') {
    return (
      <section className="sponsor">
        <p className="banner warn">The sponsor check could not be completed. Review the firm by hand for now.</p>
      </section>
    )
  }

  const firmName = firm?.data?.identity?.name || 'This sponsor'
  return (
    <section className="sponsor">
      <p className="section-label">Sponsor firm health: can {firmName} deliver?</p>
      {sourceLabel && <p className="note source">Showing: {sourceLabel}</p>}

      {result.ok ? (
        <div className="score-card">
          <div className={`score-dial ${BAND[result.label] || 'plain'}`} aria-label={`Firm health score ${result.score} out of 100`}>
            <span className="score-number">{result.score}</span>
            <span className="score-of">of 100</span>
          </div>
          <div className="score-text">
            <p className="score-label">{result.label}</p>
            <p>{result.plain}</p>
            <p className="note">
              Based on {result.used} of {result.total} measures.
              {result.used < result.total && ' The others could not be worked out from the data entered (see below).'}
            </p>
          </div>
        </div>
      ) : (
        <p className="banner warn" role="status">
          {result.reason} Fill in the firm balance sheet and earnings to get a score.
        </p>
      )}

      <div className={`so-what ${meaning.tone || 'plain'}`} role="status">
        <p className="so-what-title">So what?</p>
        <p className="so-what-text">{meaning.headline}</p>
        {meaning.trackLine && <p className="so-what-track">{meaning.trackLine}</p>}
      </div>

      <ul className="measures">
        {result.parts.map((p) => (
          <Measure key={p.id} part={p} />
        ))}
      </ul>

      <TrackRecordSection track={track} reviewedStage={reviewed?.data?.stage?.stage} onAddProjects={onChooseStage} />

      <p className="section-label">Review flags</p>
      {flagRun === null ? (
        <p className="note">Choose a stage for a project to produce the review flags.</p>
      ) : flagRun.flags.length === 0 ? (
        <p className="ok">No review flags: the firm&apos;s finances look sound.</p>
      ) : (
        <ul className="flags">
          {flagRun.flags.map((f) => (
            <li key={f.id} className={`flag ${f.severity}`}>
              <div className="flag-top">
                <span className="flag-title">{f.title}</span>
                <span className="chips">
                  <span className={`chip ${SEVERITY[f.severity]}`}>{f.severity}</span>
                </span>
              </div>
              <p className="flag-text">{f.evidence}</p>
              <p className="flag-text ask">Ask the sponsor: {f.follow_up}</p>
              {f.cell_refs.length > 0 && (
                <p className="flag-cells">
                  {f.cell_refs.slice(0, 8).map((c) => (
                    <span className="chip cell" key={c}>
                      {c}
                    </span>
                  ))}
                  {f.cell_refs.length > 8 && <span className="chip">+{f.cell_refs.length - 8} more</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="how">
        <summary>How the score is built</summary>
        <p>
          Each measure is scored from 0 to 100, then combined. Liquidity counts most because a firm that cannot pay its bills in the short run cannot fund a
          project. A measure that cannot be worked out is left out, never guessed.
        </p>
        <ul>
          <li>Liquidity cover {Math.round(WEIGHTS.liquidity * 100)}%: firm cash and investments against what it owes within a year. The principal&apos;s own cash is shown but not counted.</li>
          <li>Global DSCR {Math.round(WEIGHTS.globalDscr * 100)}%: the firm&apos;s earnings plus each project&apos;s income at the firm&apos;s share, against all loan payments. The principal&apos;s personal loan payments are not in the workbook.</li>
          <li>Fee dependence {Math.round(WEIGHTS.feeDependence * 100)}%: the developer fee as a share of income, and how income has moved over up to three years.</li>
          <li>Leverage {Math.round(WEIGHTS.leverage * 100)}%: firm debt against firm equity.</li>
        </ul>
        <p>
          The credibility score looks at the sponsor&apos;s completed projects: income delivered {Math.round(TRACK_WEIGHTS.income * 100)}% (T-12 NOI against
          underwritten), rent and occupancy delivered {Math.round(TRACK_WEIGHTS.rentOccupancy * 100)}%, stabilization on time {Math.round(TRACK_WEIGHTS.stabilization * 100)}%,
          and scale fit {Math.round(TRACK_WEIGHTS.scale * 100)}% (how much bigger the new project is than the largest delivered). It needs at least one real delivery
          measure, so a sponsor with no T-12 is never scored from scale alone. Budget and completion date cannot be compared yet: the records hold one set of dates and no budget for a completed project.
        </p>
        <p>
          Bands: {LABELS.map((l) => `${l.label} ${l.min === 0 ? 'below 35' : `${l.min} and up`}`).join(', ')}.
        </p>
      </details>

      <p className="section-label">The sponsor&apos;s projects</p>
      {meaning.projects.some((p) => p.needsStage) && (
        <div className="banner warn stage-prompt" role="status">
          <span>
            {meaning.projects.filter((p) => p.needsStage).length === 1 ? 'One project has' : `${meaning.projects.filter((p) => p.needsStage).length} projects have`} no stage yet.
            Choose a stage ({onChooseStage ? 'open the project on the first tab' : 'in The projects below'}) so the notes here fit its life stage.
          </span>
          {onChooseStage && (
            <button type="button" className="button small" onClick={onChooseStage}>
              Choose a stage
            </button>
          )}
        </div>
      )}
      {projects.length === 0 ? (
        <p className="note">No projects are loaded for this sponsor.</p>
      ) : (
        <ul className="project-list">
          {meaning.projects.map((p) => (
            <li key={p.key} className={`project ${p.tone}`}>
              <div className="project-top">
                <span className="project-name">{p.name}</span>
                <span className="chips">
                  <span className="chip">{p.stage ? p.stage.replace('_', '-') : 'stage not chosen'}</span>
                </span>
              </div>
              <p className="project-text">{p.text}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="note">Track record and the credibility score (projected vs. delivered) come later, once past-project data exists.</p>
    </section>
  )
}
