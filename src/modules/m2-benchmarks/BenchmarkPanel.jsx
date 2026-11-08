import { useMemo } from 'react'
import { benchmarkSetFor, comparisons, formatAmount, formatValue, run } from './index.js'
import './benchmarks.css'

const STAGE_WORDS = { development: 'Development', lease_up: 'Lease-up', completed: 'Completed' }
const SEVERITY_WORDS = { high: 'High', medium: 'Medium', low: 'Low' }

function result(row) {
  switch (row.status) {
    case 'within':
      return { text: 'Within the range', className: 'ok' }
    case 'above':
    case 'below': {
      const pct = typeof row.percentOutside === 'number' ? `${Math.round(row.percentOutside * 100)}% ` : ''
      return { text: `${pct}${row.status} the range`, severity: row.severity, className: `out ${row.severity ?? ''}` }
    }
    case 'no-benchmark':
      return { text: 'No comparable benchmark', note: row.note, severity: 'low', className: 'none' }
    case 'not-applicable':
      return { text: 'Not compared at this stage', className: 'na' }
    default:
      return { text: 'Could not compare', note: row.note, severity: 'low', className: 'none' }
  }
}

// M2's market comparison for one project: each metric, the project's value, the market range, and a flag when outside.
export default function BenchmarkPanel({ project, context }) {
  const view = useMemo(() => {
    try {
      const stage = project?.data?.stage?.stage
      if (!stage) return { kind: 'no-stage' }
      const chosen = benchmarkSetFor(project, context)
      if (!chosen.ok) return { kind: 'no-set', reason: chosen.reason }
      const rows = comparisons(project, context)
      if (!rows.length) return { kind: 'error' }
      const questions = run(project, context).flags
      return { kind: 'ok', set: chosen.set, stage, rows, questions }
    } catch {
      return { kind: 'error' }
    }
  }, [project, context])

  const heading = <p className="section-label">Market comparison: are the rents, expenses and costs reasonable?</p>

  if (view.kind === 'no-stage') {
    return (
      <section className="benchmarks">
        {heading}
        <p className="note">Choose a stage for this project to compare it with the market.</p>
      </section>
    )
  }
  if (view.kind !== 'ok') {
    return (
      <section className="benchmarks">
        {heading}
        <p className="banner warn">{view.kind === 'no-set' ? `There is no market data to compare with. ${view.reason}` : 'The market comparison could not be completed for this project. Review it by hand for now.'}</p>
      </section>
    )
  }

  const outside = view.rows.filter((r) => r.status === 'above' || r.status === 'below').length
  return (
    <section className="benchmarks">
      {heading}
      <p className="note">
        Compared with the {STAGE_WORDS[view.stage].toLowerCase()} market figures
        {view.set.madeUp ? ' (made-up sample numbers for now, not real market data)' : ''}.{' '}
        {outside ? `${outside} of ${view.rows.length} figures fall outside the market range.` : 'Nothing falls outside the market range.'}
      </p>
      <table className="bench-table">
        <thead>
          <tr>
            <th scope="col">What we compared</th>
            <th scope="col">This project</th>
            <th scope="col">Market range</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => {
            const r = result(row)
            return (
              <tr key={row.id} className={`bench-row ${r.className}`}>
                <th scope="row" data-label="What we compared">
                  {row.label}
                  <span className="bench-basis">{row.basis}</span>
                </th>
                <td data-label="This project">{row.value === null ? '–' : formatValue(row)}</td>
                <td data-label="Market range">
                  {row.range ? (
                    <>
                      {formatAmount(row.range.low)} to {formatAmount(row.range.high)}
                      <span className="bench-basis">middle {formatAmount(row.range.median)}{row.comparedTo ? `, ${row.comparedTo}` : ''}</span>
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td data-label="Result">
                  <span className="bench-result">{r.text}</span>
                  {r.severity && r.className !== 'ok' ? <span className={`bench-chip ${r.severity}`}>{SEVERITY_WORDS[r.severity]}</span> : null}
                  {r.note ? <span className="bench-basis">{r.note}</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {view.questions.length ? (
        <>
          <p className="section-label">Questions for the sponsor</p>
          <ul className="bench-questions">
            {view.questions.map((f) => (
              <li key={f.id}>
                <strong>{f.title}</strong> {f.follow_up}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
