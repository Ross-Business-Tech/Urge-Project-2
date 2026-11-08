import { useMemo } from 'react'
import { checklist } from './index.js'
import './development-risk.css'

const STATUS = {
  pass: { icon: '✓', label: 'Looks fine', className: 'pass' },
  fail: { icon: '!', label: 'Look closer', className: 'fail' },
  not_checked: { icon: '?', label: 'Could not check', className: 'unchecked' },
  not_applicable: { icon: '–', label: 'Not needed', className: 'na' },
}
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }

// M3D's development risk checks for one project, grouped as the spec groups them. Shown once a stage and date are chosen.
export default function DevelopmentRisk({ record, firm, settings, benchmarkSets }) {
  const stage = record.data.stage.stage
  const ready = Boolean(stage && record.data.stage.asOfDate)
  const rows = useMemo(() => {
    if (!ready) return null
    try {
      return checklist(record, { firm, settings, benchmarkSets })
    } catch {
      return 'error'
    }
  }, [ready, record, firm, settings, benchmarkSets])

  const heading = <p className="section-label">Development risk: what can go wrong while it is built and filled?</p>
  if (!ready) {
    return (
      <section className="m3d">
        {heading}
        <p className="note">Choose a stage and an &quot;as of&quot; date above to run the development risk checks.</p>
      </section>
    )
  }
  if (stage === 'completed') {
    return (
      <section className="m3d">
        {heading}
        <p className="note">This project is completed, so there is no construction or lease-up risk left to review here. The completed-risk checks cover it instead.</p>
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

  const flags = rows.flatMap((r) => r.flags).filter((f) => !f.id.endsWith('-missing'))
  const count = (sev) => flags.filter((f) => f.severity === sev).length
  const groups = [...new Set(rows.map((r) => r.group))]
  return (
    <section className="m3d">
      {heading}
      {stage === 'lease_up' && <p className="note">Lease-up project: only the parts still ahead of it are reviewed (schedule, reserves, loans and team).</p>}
      <p className={flags.length ? 'banner warn' : 'ok'} role="status">
        {flags.length === 0
          ? 'No development risks raised.'
          : `${flags.length} risk${flags.length === 1 ? '' : 's'} to look at: ${count('high')} high, ${count('medium')} medium, ${count('low')} low.`}
      </p>
      {groups.map((group) => (
        <div key={group} className="m3d-group">
          <p className="m3d-group-title">{group}</p>
          <ul className="m3d-list">
            {rows
              .filter((r) => r.group === group)
              .map((r) => {
                const st = STATUS[r.status]
                const worst = r.flags.find((f) => !f.id.endsWith('-missing')) ?? r.flags[0]
                return (
                  <li key={r.id} className={`m3d-item ${st.className}`}>
                    <span className="m3d-icon" aria-hidden="true">
                      {st.icon}
                    </span>
                    <div className="m3d-body">
                      <div className="m3d-top">
                        <span className="m3d-title">{r.title}</span>
                        <span className={`chip ${r.status === 'pass' ? 'good' : r.status === 'fail' ? SEVERITY_CHIP[worst?.severity] ?? 'warn' : ''}`}>
                          {r.status === 'fail' && worst ? `${st.label} · ${worst.severity}` : st.label}
                        </span>
                      </div>
                      {(r.status !== 'fail' || r.flags.length === 0) && <p className="m3d-detail">{r.detail}</p>}
                      {r.status === 'fail' &&
                        r.flags.map((f) => (
                          <div key={f.id} className="m3d-flag">
                            <p className="m3d-detail strong">
                              <span className={`chip ${SEVERITY_CHIP[f.severity]}`}>{f.severity}</span> {f.title}
                            </p>
                            <p className="m3d-detail">{f.evidence}</p>
                            <p className="m3d-detail ask">Ask the sponsor: {f.follow_up}</p>
                          </div>
                        ))}
                      {r.status === 'not_checked' && <p className="m3d-detail ask">{r.flags[0]?.follow_up}</p>}
                      {r.status !== 'pass' && r.cells.length > 0 && (
                        <p className="m3d-cells">
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
        </div>
      ))}
    </section>
  )
}
