import { useMemo } from 'react'
import { checklist } from './index.js'
import './development.css'

const STATUS = {
  pass: { icon: '✓', label: 'Pass', className: 'pass' },
  fail: { icon: '!', label: 'Flagged', className: 'fail' },
  not_checked: { icon: '?', label: 'Could not check', className: 'unchecked' },
  not_applicable: { icon: '–', label: 'Not needed', className: 'na' },
}

const QUESTIONS = {
  budget: 'Is the budget big enough to finish the building?',
  schedule: 'Do the dates hang together?',
  capital: 'Who gets repaid first, and can the loans be carried and refinanced?',
  team: 'Is everyone who has to deliver the project named?',
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }
const worst = (flags) => [...flags].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0]

// M3D's four development risk checks for one project, in plain language, each with its pass / flag status.
export default function DevelopmentRiskPanel({ project, context }) {
  const stage = project?.data?.stage?.stage
  const rows = useMemo(() => {
    if (!stage) return null
    try {
      return checklist(project, context)
    } catch {
      return 'error'
    }
  }, [stage, project, context])

  const heading = <p className="section-label">Development risk: what can go wrong before the property is stable?</p>

  if (!stage) {
    return (
      <section className="m3d">
        {heading}
        <p className="note">Choose a stage above to run the development risk checks.</p>
      </section>
    )
  }
  if (rows === 'error') {
    return (
      <section className="m3d">
        {heading}
        <p className="banner warn">The development risk checks could not be completed for this project. Review it by hand for now.</p>
      </section>
    )
  }
  if (stage === 'completed') {
    return (
      <section className="m3d">
        {heading}
        <p className="note">This project is completed, so there is no construction or lease-up risk left to check here. The completed-project checks cover it.</p>
      </section>
    )
  }

  const flagged = rows.filter((r) => r.status === 'fail')
  const counted = rows.filter((r) => r.status !== 'not_applicable')
  const passed = counted.filter((r) => r.status === 'pass').length
  return (
    <section className="m3d">
      {heading}
      {stage === 'lease_up' && (
        <p className="note">This project is leasing up, so only the parts still projected are checked: the remaining schedule, the reserves and the takeout loan.</p>
      )}
      <p className={flagged.length ? 'banner warn' : 'ok'} role="status">
        {passed} of {counted.length} checks pass
        {flagged.length ? `. ${flagged.length} need${flagged.length === 1 ? 's' : ''} a look.` : '.'}
      </p>
      <ul className="m3d-checks">
        {rows.map((r) => {
          const st = STATUS[r.status] ?? STATUS.not_checked
          const top = r.status === 'fail' ? worst(r.flags.filter((f) => !f.id.endsWith('-missing'))) : null
          return (
            <li key={r.id} className={`m3d-check ${st.className}`}>
              <div className="m3d-check-top">
                <span className="m3d-icon" aria-hidden="true">
                  {st.icon}
                </span>
                <div className="m3d-check-heading">
                  <span className="m3d-title">{r.title}</span>
                  <span className="m3d-question">{QUESTIONS[r.id]}</span>
                </div>
                <span className={`chip m3d-chip ${st.className}${top ? ` ${top.severity}` : ''}`}>{top ? `${st.label} · ${top.severity}` : st.label}</span>
              </div>
              {r.status === 'not_applicable' && <p className="m3d-detail">{r.detail}</p>}
              {r.items.length > 0 && (
                <ul className="m3d-items">
                  {r.items.map((it) => (
                    <li key={it.label} className={`m3d-item ${(STATUS[it.status] ?? STATUS.not_checked).className}`}>
                      <span className="m3d-item-label">{it.label}</span>
                      <span className="m3d-item-text">{it.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {r.flags.length > 0 && (
                <ul className="m3d-asks">
                  {r.flags.map((f) => (
                    <li key={f.id}>
                      <span className={`chip m3d-sev ${f.severity}`}>{f.severity}</span> <strong>{f.title}</strong> Ask the sponsor: {f.follow_up}
                      {f.cell_refs.some((c) => c.includes('!')) && <span className="m3d-cells"> Cells: {f.cell_refs.filter((c) => c.includes('!')).slice(0, 6).join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
