import { useMemo } from 'react'
import './transitions.css'
import { fmt } from '../shared/index.js'
import { run, transitionTimeline, leaseUpView } from './index.js'

const STATE_LABEL = { done: 'Done', current: 'Now', next: 'Next', later: 'Later' }
const CONDITION = {
  ok: { icon: '✓', label: 'Met', className: 'ok' },
  watch: { icon: '!', label: 'Watch', className: 'watch' },
  concern: { icon: '✗', label: 'Not met', className: 'concern' },
  unknown: { icon: '?', label: 'Could not check', className: 'unknown' },
  ask: { icon: '?', label: 'Ask the sponsor', className: 'unknown' },
}
const STATUS = {
  on_track: { label: 'On track', chip: 'good' },
  watch: { label: 'Watch', chip: 'amber' },
  at_risk: { label: 'At risk', chip: 'warn' },
  unknown: { label: 'Not fully checked', chip: '' },
}
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }

function work(project, context) {
  try {
    const timeline = transitionTimeline(project, context)
    if (!timeline.ok) return { ok: false, reason: timeline.reason }
    const view = timeline.stage === 'development' ? null : leaseUpView(project, context)
    const { flags } = run(project, context)
    return { ok: true, timeline, view, flags }
  } catch {
    return { ok: false, reason: 'The stage-change checks could not be shown for this project. Review it by hand for now.', broken: true }
  }
}

function Timeline({ steps }) {
  return (
    <ol className="tr-timeline" aria-label="Where the project is in its life">
      {steps.map((s) => (
        <li key={s.id} className={`tr-step tr-${s.kind} tr-${s.state}`}>
          <span className="tr-dot" aria-hidden="true" />
          <div className="tr-step-body">
            <span className="tr-step-label">{s.label}</span>
            <span className="tr-state">{STATE_LABEL[s.state]}</span>
            {s.when && <span className="tr-when">{s.when}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function NextCard({ next }) {
  if (!next.ok) return <p className="note">{next.reason}</p>
  const status = STATUS[next.status]
  return (
    <div className="tr-nextcard">
      <div className="tr-nextcard-top">
        <h3>
          Next: {next.transition} {next.label.toLowerCase()}
        </h3>
        <span className={`chip ${status.chip}`}>{status.label}</span>
      </div>
      <p className="tr-plain">{next.plain}</p>
      <p>
        <strong>When:</strong> {next.when.idx === null ? 'not known yet' : next.when.text}
        {next.when.basis && <span className="muted"> ({next.when.basis})</span>}
      </p>
      <p className="section-label">What has to be true for it to go well</p>
      <ul className="tr-conditions">
        {next.conditions.map((c, i) => {
          const look = CONDITION[c.status] ?? CONDITION.unknown
          return (
            <li key={i} className={`tr-cond tr-${look.className}`}>
              <span className="tr-icon" aria-label={look.label} title={look.label}>
                {look.icon}
              </span>
              <span>{c.text}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`)

function LeaseUp({ view }) {
  if (!view) return null
  if (!view.ok) {
    return (
      <div className="tr-leaseup">
        <p className="section-label">Lease-up so far</p>
        <p className="note">{view.reason} Upload the monthly T-12 to see the occupancy trend and a stabilization estimate.</p>
      </div>
    )
  }
  const { occupancy, absorption, concessions, stability } = view
  const est = stability.estimate
  return (
    <div className="tr-leaseup">
      <p className="section-label">Lease-up so far (from the T-12)</p>
      <div className="tr-facts">
        <div className="tr-fact">
          <span className="tr-fact-label">Occupancy</span>
          <span className="tr-fact-value">{pct(occupancy.latest)}</span>
          <span className="tr-fact-hint">
            {occupancy.latestMonth ? `${occupancy.latestMonth}, ${occupancy.trend}` : 'not entered'}; floor {pct(occupancy.floor)}
          </span>
        </div>
        <div className="tr-fact">
          <span className="tr-fact-label">Leasing pace</span>
          <span className="tr-fact-value">{absorption.ok ? `${absorption.pacePerMonth >= 0 ? '+' : ''}${(absorption.pacePerMonth * 100).toFixed(1)} pts/mo` : '–'}</span>
          <span className="tr-fact-hint">
            {!absorption.ok
              ? absorption.reason
              : absorption.reached
                ? `Target ${pct(absorption.target)} reached`
                : absorption.reachText
                  ? `Reaches ${pct(absorption.target)} around ${absorption.reachText}`
                  : `Not on track to reach ${pct(absorption.target)}`}
          </span>
        </div>
        <div className="tr-fact">
          <span className="tr-fact-label">Free rent</span>
          <span className="tr-fact-value">{concessions.ok ? `${(concessions.share * 100).toFixed(1)}%` : '–'}</span>
          <span className="tr-fact-hint">{concessions.ok ? `of billed rent, last ${concessions.months} mo (${fmt.usd(concessions.monthly)} a month)` : concessions.reason}</span>
        </div>
        <div className="tr-fact">
          <span className="tr-fact-label">Stability streak</span>
          <span className="tr-fact-value">{stability.ok ? `${stability.streak} of ${stability.needed}` : '–'}</span>
          <span className="tr-fact-hint">
            {stability.ok ? 'months in a row passing the DSCR and NOI tests' : stability.reason}
            {stability.brokenBy ? `. No data for ${stability.brokenBy}, which ends the streak.` : ''}
          </span>
        </div>
      </div>
      <p className="tr-estimate">
        <strong>Stabilization estimate:</strong>{' '}
        {!est.ok ? est.reason : est.onTrack ? (est.monthsAway === 0 ? 'the stability test is met now. ' : `about ${est.monthsAway} months after ${view.latestMonth}, around ${est.monthText}. `) : 'not on track at the current pace. '}
        {est.ok && est.how}
        {est.ok && est.planned ? ` Planned: ${est.planned}.` : ''}
      </p>
      <div className="tr-months" role="img" aria-label="Occupancy by month">
        {view.months.map((m) => (
          <div key={m.idx} className={`tr-bar ${m.passes ? 'tr-pass' : ''}`} title={`${m.month}: occupancy ${pct(m.occupancy)}${m.passes === null ? '' : m.passes ? ', passes' : ', does not pass'}`}>
            <span className="tr-bar-fill" style={{ height: `${Math.round((m.occupancy ?? 0) * 100)}%` }} />
            <span className="tr-bar-label">{m.month.slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <p className="tr-legend muted">Bars show occupancy each month; darker bars pass the DSCR and NOI tests.</p>
    </div>
  )
}

function Flags({ flags }) {
  if (!flags.length) return <p className="note">No stage-change concerns found.</p>
  return (
    <ul className="tr-flags">
      {flags.map((f) => (
        <li key={f.id} className="tr-flag">
          <div className="tr-flag-top">
            <span className={`chip ${SEVERITY_CHIP[f.severity]}`}>{f.severity}</span>
            {f.transition && <span className="chip">{f.transition}</span>}
            <strong>{f.title}</strong>
          </div>
          <p className="tr-evidence">{f.evidence}</p>
          <p className="tr-ask">
            <strong>Ask the sponsor:</strong> {f.follow_up}
          </p>
          {f.cell_refs.length > 0 && <p className="tr-cells muted">From: {f.cell_refs.slice(0, 8).join(', ')}{f.cell_refs.length > 8 ? ` and ${f.cell_refs.length - 8} more` : ''}</p>}
        </li>
      ))}
    </ul>
  )
}

// M3T's screen for one project: a timeline of where it is, which stage change is next and when, the lease-up picture,
// and the stage-change flags. Props: { project, context } (context as for run: settings, benchmarks, transitions).
export default function TransitionPanel({ project, context }) {
  const result = useMemo(() => work(project, context), [project, context])
  return (
    <section className="transitions">
      <p className="section-label">Stage changes</p>
      {!result.ok ? (
        <p className={result.broken ? 'banner warn' : 'note'}>{result.reason}</p>
      ) : (
        <>
          <Timeline steps={result.timeline.steps} />
          <NextCard next={result.timeline.next} />
          <LeaseUp view={result.view} />
          <p className="section-label">Stage-change flags</p>
          <Flags flags={result.flags} />
        </>
      )}
    </section>
  )
}
