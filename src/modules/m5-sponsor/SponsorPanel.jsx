import { useMemo } from 'react'
import { fmt } from '../shared/index.js'
import { firmHealth, WEIGHTS, LABELS } from './index.js'
import './sponsor.css'

// What each measure asks, in plain words.
const QUESTIONS = {
  liquidity: 'Can the firm pay what it owes within a year?',
  globalDscr: "Do the firm's earnings and its projects cover all the loan payments together?",
  feeDependence: 'Does the firm live off one fee, and is its income shrinking?',
  leverage: 'How much of the firm is financed by debt?',
}

const BAND = { Strong: 'good', Adequate: '', Weak: 'amber', Failing: 'warn' }

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

function projectLine(p) {
  return p.data?.identity?.name || p.meta?.sourceTab || 'Unnamed project'
}

// M5-a: the sponsor page for one firm and its projects. Shows the firm health score and the four measures behind it.
export default function SponsorPanel({ firm, projects = [], settings }) {
  const result = useMemo(() => {
    try {
      return firmHealth(firm, projects, settings)
    } catch {
      return 'error'
    }
  }, [firm, projects, settings])

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

      <ul className="measures">
        {result.parts.map((p) => (
          <Measure key={p.id} part={p} />
        ))}
      </ul>

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
          Bands: {LABELS.map((l) => `${l.label} ${l.min === 0 ? 'below 35' : `${l.min} and up`}`).join(', ')}.
        </p>
      </details>

      <p className="section-label">The sponsor&apos;s projects</p>
      {projects.length === 0 ? (
        <p className="note">No projects are loaded for this sponsor.</p>
      ) : (
        <ul className="project-list">
          {projects.map((p, i) => (
            <li key={p.meta?.projectId ?? i}>
              <span>{projectLine(p)}</span>
              <span className="chips">
                <span className="chip">{p.data?.stage?.stage ? p.data.stage.stage.replace('_', '-') : 'stage not chosen'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="note">Track record and the credibility score (projected vs. delivered) come later, once past-project data exists.</p>
    </section>
  )
}
