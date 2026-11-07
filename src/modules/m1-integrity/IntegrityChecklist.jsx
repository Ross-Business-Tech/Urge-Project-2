import { useMemo } from 'react'
import { checklist } from './index.js'
import './integrity.css'

const STATUS = {
  pass: { icon: '✓', label: 'Pass', className: 'pass' },
  fail: { icon: '✗', label: 'Fail', className: 'fail' },
  not_checked: { icon: '?', label: 'Could not check', className: 'unchecked' },
  not_applicable: { icon: '–', label: 'Not needed', className: 'na' },
}

const SEVERITY = { high: 'warn', medium: 'amber', low: '' }

// M1's pass / fail checklist for one project, with the failing cells named. Shown once a stage and date are chosen.
export default function IntegrityChecklist({ record, firm, facts, report }) {
  const ready = Boolean(record.data.stage.stage && record.data.stage.asOfDate)
  const rows = useMemo(() => {
    if (!ready) return null
    try {
      return checklist(record, { firm, facts, report })
    } catch {
      return 'error'
    }
  }, [ready, record, firm, facts, report])

  if (!ready) {
    return (
      <section className="integrity">
        <p className="section-label">Integrity checks</p>
        <p className="note">Choose a stage and an &quot;as of&quot; date above to run the integrity checks.</p>
      </section>
    )
  }
  if (rows === 'error') {
    return (
      <section className="integrity">
        <p className="section-label">Integrity checks</p>
        <p className="banner warn">The integrity checks could not be completed for this project. Review it by hand for now.</p>
      </section>
    )
  }

  const failed = rows.filter((r) => r.status === 'fail')
  const counted = rows.filter((r) => r.status !== 'not_applicable')
  const passed = counted.filter((r) => r.status === 'pass').length
  return (
    <section className="integrity">
      <p className="section-label">Integrity checks: can we trust the numbers?</p>
      <p className={failed.length ? 'banner warn' : 'ok'} role="status">
        {passed} of {counted.length} checks pass
        {failed.length ? `. ${failed.length} need${failed.length === 1 ? 's' : ''} a look.` : '. Nothing to fix.'}
      </p>
      <ul className="checklist">
        {rows.map((r) => {
          const st = STATUS[r.status]
          const severity = r.status === 'fail' ? r.flags[0]?.severity : null
          return (
            <li key={r.id} className={`check ${st.className}`}>
              <span className="check-icon" aria-hidden="true">
                {st.icon}
              </span>
              <div className="check-body">
                <div className="check-top">
                  <span className="check-title">{r.title}</span>
                  <span className="chips">
                    <span className={`chip ${r.status === 'pass' ? 'good' : r.status === 'fail' ? SEVERITY[severity] ?? 'warn' : ''}`}>
                      {r.status === 'fail' && severity ? `${st.label} · ${severity}` : st.label}
                    </span>
                  </span>
                </div>
                <p className="check-detail">{r.detail}</p>
                {r.status === 'fail' && r.flags[0] && <p className="check-detail ask">Ask the sponsor: {r.flags[0].follow_up}</p>}
                {r.status !== 'pass' && r.cells.length > 0 && (
                  <p className="check-cells">
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
