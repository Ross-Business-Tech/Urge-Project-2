import { useMemo } from 'react'
import { summary } from './index.js'
import './transitions.css'

const STAGES = [
  { id: 'development', label: 'Development' },
  { id: 'lease_up', label: 'Lease-up' },
  { id: 'completed', label: 'Completed' },
  { id: 'exit', label: 'Refinance or sale' },
]
const HANDOFFS = ['T1', 'T2', 'T3']
const STATUS_TEXT = { on_track: 'On track', watch: 'Worth watching', at_risk: 'At risk', unknown: 'Cannot tell yet' }
const STATUS_CLASS = { on_track: 'good', watch: 'amber', at_risk: 'warn', unknown: '' }
const ROW = {
  pass: { icon: '✓', label: 'Looks fine', className: 'pass' },
  fail: { icon: '!', label: 'Look closer', className: 'fail' },
  not_checked: { icon: '?', label: 'Could not check', className: 'unchecked' },
}
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }

const whenText = (when) => {
  if (!when) return 'date not known'
  if (when.monthsAway === null) return when.text
  if (when.monthsAway > 0) return `${when.text}, about ${when.monthsAway} month${when.monthsAway === 1 ? '' : 's'} from the "as of" date`
  if (when.monthsAway === 0) return `${when.text}, the "as of" month`
  return `${when.text}, ${-when.monthsAway} month${when.monthsAway === -1 ? '' : 's'} before the "as of" date`
}

// M3T's stage-change checks for one project: a timeline of where it is and which hand-off is next, then the checks for that
// hand-off. Checks that belong to another stage are listed in one line instead of as empty cards.
export default function TransitionChecks({ record, firm, settings, benchmarkSets }) {
  const stage = record.data.stage.stage
  const ready = Boolean(stage && record.data.stage.asOfDate)
  const result = useMemo(() => {
    if (!ready) return null
    try {
      return summary(record, { firm, settings, benchmarkSets })
    } catch {
      return 'error'
    }
  }, [ready, record, firm, settings, benchmarkSets])

  const heading = <p className="section-label">Stage changes: will it make the next jump?</p>
  if (!ready) {
    return (
      <section className="m3t">
        {heading}
        <p className="note">Choose a stage and an &quot;as of&quot; date above to see where this project is and which stage change is next.</p>
      </section>
    )
  }
  if (!result || result === 'error') {
    return (
      <section className="m3t">
        {heading}
        <p className="banner warn">The stage-change checks could not be completed for this project. Review it by hand for now.</p>
      </section>
    )
  }

  const { next, rows } = result
  const at = STAGES.findIndex((s) => s.id === stage)
  const mine = rows.filter((r) => r.status !== 'not_applicable')
  const elsewhere = rows.filter((r) => r.status === 'not_applicable')
  const flags = rows.flatMap((r) => r.flags).filter((f) => !f.id.endsWith('-missing'))
  return (
    <section className="m3t">
      {heading}
      <ol className="m3t-timeline" aria-label="Project stages">
        {STAGES.map((s, i) => (
          <li key={s.id} className={`m3t-stage ${i < at ? 'past' : i === at ? 'now' : ''}`} aria-current={i === at ? 'step' : undefined}>
            <span className="m3t-dot" aria-hidden="true" />
            <span className="m3t-stage-label">{s.label}</span>
            {i < HANDOFFS.length && <span className={`m3t-handoff ${i === at ? `next ${next.status}` : ''}`}>{HANDOFFS[i]}</span>}
          </li>
        ))}
      </ol>

      <div className={`m3t-next ${next.status}`}>
        <div className="m3t-next-top">
          <span className="m3t-next-title">
            Next: {next.transition}, {next.title}
          </span>
          <span className={`chip ${STATUS_CLASS[next.status]}`}>{STATUS_TEXT[next.status]}</span>
        </div>
        <p className="m3t-detail">Expected {whenText(next.when)}.</p>
        <p className="m3t-detail strong">What has to be true:</p>
        <ul className="m3t-must">
          {next.mustBeTrue.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      <p className={flags.length ? 'banner warn' : 'ok'} role="status">
        {flags.length === 0 ? 'No stage-change risks raised.' : `${flags.length} risk${flags.length === 1 ? '' : 's'} to look at.`}
      </p>
      <ul className="m3t-list">
        {mine.map((r) => {
          const st = ROW[r.status]
          const worst = r.flags.find((f) => !f.id.endsWith('-missing')) ?? r.flags[0]
          return (
            <li key={r.id} className={`m3t-item ${st.className}`}>
              <span className="m3t-icon" aria-hidden="true">
                {st.icon}
              </span>
              <div className="m3t-body">
                <div className="m3t-top">
                  <span className="m3t-title">
                    {r.title} <span className="m3t-tag">{r.transition}</span>
                  </span>
                  <span className={`chip ${r.status === 'pass' ? 'good' : r.status === 'fail' ? SEVERITY_CHIP[worst?.severity] ?? 'warn' : ''}`}>
                    {r.status === 'fail' && worst ? `${st.label} · ${worst.severity}` : st.label}
                  </span>
                </div>
                {(r.status !== 'fail' || r.flags.length === 0) && <p className="m3t-detail">{r.detail}</p>}
                {r.status === 'fail' &&
                  r.flags.map((f) => (
                    <div key={f.id} className="m3t-flag">
                      <p className="m3t-detail strong">
                        <span className={`chip ${SEVERITY_CHIP[f.severity]}`}>{f.severity}</span> {f.title}
                      </p>
                      <p className="m3t-detail">{f.evidence}</p>
                      <p className="m3t-detail strong">Ask the sponsor: {f.follow_up}</p>
                    </div>
                  ))}
                {r.status === 'not_checked' && <p className="m3t-detail strong">{r.flags[0]?.follow_up}</p>}
                {r.status !== 'pass' && r.cells.length > 0 && (
                  <p className="m3t-cells">
                    {r.cells.slice(0, 6).map((c) => (
                      <span className="chip cell" key={c}>
                        {c}
                      </span>
                    ))}
                    {r.cells.length > 6 && <span className="chip">+{r.cells.length - 6} more</span>}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {elsewhere.length > 0 && <p className="note">Not needed at this stage: {elsewhere.map((r) => r.title.toLowerCase()).join('; ')}.</p>}
    </section>
  )
}
