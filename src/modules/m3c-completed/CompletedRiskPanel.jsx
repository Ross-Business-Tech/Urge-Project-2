import { useMemo } from 'react'
import { checklist } from './index.js'
import './completed.css'

const STATUS = {
  pass: { icon: '✓', label: 'Pass', className: 'pass' },
  fail: { icon: '!', label: 'Flagged', className: 'fail' },
  not_checked: { icon: '?', label: 'Could not check', className: 'unchecked' },
  not_applicable: { icon: '–', label: 'Not needed yet', className: 'na' },
}

const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }
const SEVERITY_WORD = { high: 'High', medium: 'Medium', low: 'Low' }

function intro(stage) {
  if (stage === 'completed') return 'The property is operating, so its real results are checked against what was underwritten.'
  if (stage === 'lease_up') return 'The property is still filling, so only what is already real is checked here: the rent roll and expenses to date. The rest runs once it is completed.'
  return null
}

// M3C on screen: the four completed-property checks in plain language, each with pass or flag status, the numbers behind
// it, the question for the sponsor and the cells it comes from.
export default function CompletedRiskPanel({ project, context }) {
  const stage = project?.data?.stage?.stage ?? null
  const rows = useMemo(() => {
    if (!project) return null
    try {
      return checklist(project, context)
    } catch {
      return 'error'
    }
  }, [project, context])

  const heading = <p className="section-label">Completed-property risk: what can go wrong now that it operates?</p>

  if (!project || !stage) {
    return (
      <section className="m3c">
        {heading}
        <p className="note">Choose a stage and an &quot;as of&quot; date to run these checks.</p>
      </section>
    )
  }
  if (rows === 'error') {
    return (
      <section className="m3c">
        {heading}
        <p className="banner warn">These checks could not be completed for this project. Review it by hand for now.</p>
      </section>
    )
  }
  if (stage === 'development') {
    return (
      <section className="m3c">
        {heading}
        <p className="note">This project is in development, so there are no actual results to check yet. These checks start once it is leasing up or completed.</p>
      </section>
    )
  }

  const flagged = rows.filter((r) => r.status === 'fail')
  const counted = rows.filter((r) => r.status !== 'not_applicable')
  const passed = counted.filter((r) => r.status === 'pass').length
  return (
    <section className="m3c">
      {heading}
      <p className="note">{intro(stage)}</p>
      <p className={flagged.length ? 'banner warn' : 'ok'} role="status">
        {passed} of {counted.length} checks pass
        {flagged.length ? `. ${flagged.length} need${flagged.length === 1 ? 's' : ''} a look.` : '.'}
      </p>
      <ul className="m3c-list">
        {rows.map((r) => {
          const st = STATUS[r.status] ?? STATUS.not_checked
          const findings = r.flags.filter((f) => !f.id.endsWith('-missing') && f.id !== 'M3C-missing-data')
          const missing = r.flags.filter((f) => f.id.endsWith('-missing') || f.id === 'M3C-missing-data')
          return (
            <li key={r.id} className={`m3c-item ${st.className}`}>
              <span className="m3c-icon" aria-hidden="true">
                {st.icon}
              </span>
              <div className="m3c-body">
                <div className="m3c-top">
                  <span className="m3c-title">{r.title}</span>
                  <span className={`chip ${r.status === 'pass' ? 'good' : r.status === 'fail' ? SEVERITY_CHIP[findings[0]?.severity] ?? 'warn' : ''}`}>{st.label}</span>
                </div>
                <p className="m3c-question">{r.question}</p>
                <p className="m3c-detail">{r.detail}</p>
                {findings.map((f) => (
                  <div className="m3c-flag" key={f.id}>
                    <p className="m3c-flag-title">
                      <span className={`chip ${SEVERITY_CHIP[f.severity]}`}>{SEVERITY_WORD[f.severity]}</span> {f.title}
                      {f.transition && <span className="chip"> Ahead: refinance or sale ({f.transition})</span>}
                    </p>
                    <p className="m3c-detail">{f.evidence}</p>
                    <p className="m3c-detail ask">Ask the sponsor: {f.follow_up}</p>
                  </div>
                ))}
                {missing.map((f) => (
                  <p className="m3c-detail" key={f.id}>
                    {f.evidence}
                  </p>
                ))}
                {r.status !== 'pass' && r.status !== 'not_applicable' && r.cells.length > 0 && (
                  <p className="m3c-cells">
                    {r.cells.slice(0, 8).map((c) => (
                      <span className="chip cell" key={c}>
                        {c}
                      </span>
                    ))}
                    {r.cells.length > 8 && <span className="chip">+{r.cells.length - 8} more</span>}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
