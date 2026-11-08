import { useMemo } from 'react'
import { checklist, GROUPS } from './index.js'
import './development.css'

const STATUS = {
  pass: { icon: '✓', label: 'Looks fine', className: 'pass' },
  fail: { icon: '!', label: 'Flagged', className: 'fail' },
  not_checked: { icon: '?', label: 'Could not check', className: 'unchecked' },
  not_applicable: { icon: '–', label: 'Not needed', className: 'na' },
}
const SEVERITY = { high: 'warn', medium: 'amber', low: '' }

// M3D's development risk checks for one project, grouped as budget, schedule, money and takeout, and team.
// Shown for development and lease-up projects once a stage and date are chosen.
export default function DevelopmentRisk({ record, settings }) {
  const stage = record.data.stage.stage
  const ready = Boolean(stage && record.data.stage.asOfDate)
  const rows = useMemo(() => {
    if (!ready || (stage !== 'development' && stage !== 'lease_up')) return null
    try {
      return checklist(record, { settings })
    } catch {
      return 'error'
    }
  }, [ready, stage, record, settings])

  if (!ready) {
    return (
      <section className="devrisk">
        <p className="section-label">Development risk</p>
        <p className="note">Choose a stage and an &quot;as of&quot; date above to run the development risk checks.</p>
      </section>
    )
  }
  if (rows === null) {
    return (
      <section className="devrisk">
        <p className="section-label">Development risk</p>
        <p className="note">These checks are for projects still being built or leased up. Completed projects get their own checks.</p>
      </section>
    )
  }
  if (rows === 'error') {
    return (
      <section className="devrisk">
        <p className="section-label">Development risk</p>
        <p className="banner warn">The development risk checks could not be completed for this project. Review it by hand for now.</p>
      </section>
    )
  }

  const flagged = rows.filter((r) => r.status === 'fail')
  const counted = rows.filter((r) => r.status !== 'not_applicable')
  const passed = counted.filter((r) => r.status === 'pass').length
  return (
    <section className="devrisk">
      <p className="section-label">Development risk: what could go wrong while it is built?</p>
      <p className={flagged.length ? 'banner warn' : 'ok'} role="status">
        {passed} of {counted.length} checks look fine
        {flagged.length ? `. ${flagged.length} need${flagged.length === 1 ? 's' : ''} a look.` : '. Nothing to flag.'}
      </p>
      {stage === 'lease_up' && <p className="note">Lease-up project: the parts still projected are checked as development.</p>}
      {GROUPS.map((g) => {
        const inGroup = rows.filter((r) => r.group === g.id)
        if (inGroup.length === 0) return null
        return (
          <div key={g.id} className="dev-group">
            <p className="dev-group-title">{g.label}</p>
            <ul className="dev-list">
              {inGroup.map((r) => {
                const st = STATUS[r.status]
                const flag = r.status === 'fail' ? r.flags[0] : null
                return (
                  <li key={r.id} className={`dev-check ${st.className}`}>
                    <span className="dev-icon" aria-hidden="true">
                      {st.icon}
                    </span>
                    <div className="dev-body">
                      <div className="dev-top">
                        <span className="dev-title">{r.title}</span>
                        <span className={`chip ${r.status === 'pass' ? 'good' : flag ? SEVERITY[flag.severity] ?? 'warn' : ''}`}>
                          {flag ? `${st.label} · ${flag.severity}` : st.label}
                        </span>
                      </div>
                      <p className="dev-detail">{r.detail}</p>
                      {flag && <p className="dev-detail ask">Ask the sponsor: {flag.follow_up}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
