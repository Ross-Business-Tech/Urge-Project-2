import { useMemo } from 'react'
import { compareProject, UNITS } from './index.js'
import './benchmarks.css'

const STATUS = {
  within: { label: 'Within range', chip: 'good' },
  above: { label: 'Above range', chip: 'amber' },
  below: { label: 'Below range', chip: 'amber' },
  no_benchmark: { label: 'No benchmark', chip: '' },
  not_available: { label: 'Not available', chip: '' },
  not_applicable: { label: 'Not compared', chip: '' },
}
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }

// Where the value sits on a strip from a little below the range to a little above it.
function RangeStrip({ row }) {
  const { low, high, median } = row.range
  const span = high - low || 1
  const min = Math.min(low - span * 0.5, row.value)
  const max = Math.max(high + span * 0.5, row.value)
  const at = (v) => `${((v - min) / (max - min)) * 100}%`
  const f = UNITS[row.metric].format
  return (
    <div className="bm-strip" role="img" aria-label={`${f(row.value)} against a range of ${f(low)} to ${f(high)}`}>
      <div className="bm-band" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
      <div className="bm-median" style={{ left: at(median) }} />
      <div className={`bm-dot ${row.status}`} style={{ left: at(row.value) }} />
    </div>
  )
}

// M2's comparison table for one project: each figure, the market range, and whether it falls outside.
export default function BenchmarkTable({ record }) {
  const stage = record.data.stage.stage
  const result = useMemo(() => {
    if (!stage) return null
    try {
      return compareProject(record, {})
    } catch {
      return { ok: false, reason: 'The comparison could not be completed for this project. Review it by hand for now.' }
    }
  }, [stage, record])

  if (!result) {
    return (
      <section className="benchmarks">
        <p className="section-label">Market comparison</p>
        <p className="note">Choose a stage above to compare this project with the market.</p>
      </section>
    )
  }
  if (!result.ok) {
    return (
      <section className="benchmarks">
        <p className="section-label">Market comparison</p>
        <p className="banner warn">{result.reason}</p>
      </section>
    )
  }

  const flagFor = (row) => result.flags.find((fl) => fl.id.includes(`-${row.status}-comps`) && fl.id.startsWith(`M2-${{ rent: 'rent', expense: 'expenses', cost: 'cost' }[row.metric]}-`))
  const outside = result.rows.filter((r) => r.status === 'above' || r.status === 'below').length
  const compared = result.rows.filter((r) => r.range).length
  return (
    <section className="benchmarks">
      <p className="section-label">Market comparison: are rents, expenses and costs reasonable?</p>
      <p className={outside ? 'banner warn' : 'ok'} role="status">
        {compared === 0 ? 'Nothing could be compared yet.' : `${compared - outside} of ${compared} figures are within the market range${outside ? `. ${outside} ${outside === 1 ? 'is' : 'are'} outside.` : '.'}`}
      </p>
      <p className="note">
        Compared with: {result.set.name}.{result.set.madeUp && <strong> Sample numbers only, not real market data.</strong>}
      </p>
      <ul className="bm-list">
        {result.rows.map((row) => {
          const st = STATUS[row.status]
          const flag = flagFor(row)
          const f = UNITS[row.metric].format
          return (
            <li key={row.id} className={`bm-row ${row.status}`}>
              <div className="bm-top">
                <span className="bm-label">{row.label}</span>
                <span className="chips">
                  <span className={`chip ${flag ? SEVERITY_CHIP[flag.severity] || st.chip : st.chip}`}>
                    {st.label}
                    {flag ? ` · ${flag.severity}` : ''}
                  </span>
                </span>
              </div>
              {row.range ? (
                <>
                  <dl className="bm-figures">
                    <div>
                      <dt>This project</dt>
                      <dd>
                        {f(row.value)}
                        <span className="bm-unit">{row.unit}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Market range</dt>
                      <dd>
                        {f(row.range.low)} to {f(row.range.high)}
                      </dd>
                    </div>
                    <div>
                      <dt>vs. median</dt>
                      <dd>{row.percentFromMedian === null ? 'n/a' : `${row.percentFromMedian > 0 ? '+' : ''}${(row.percentFromMedian * 100).toFixed(0)}%`}</dd>
                    </div>
                  </dl>
                  <RangeStrip row={row} />
                  <p className="bm-detail">
                    {row.basis}
                    {row.rangeBasis ? `; ${row.rangeBasis}` : ''}.{row.detail.includes('Note:') ? ` ${row.detail.slice(row.detail.indexOf('Note:'))}` : ''}
                  </p>
                </>
              ) : (
                <p className="bm-detail">{row.detail}</p>
              )}
              {flag && (row.status === 'above' || row.status === 'below') && <p className="bm-detail ask">Ask the sponsor: {flag.follow_up}</p>}
              {row.status !== 'within' && row.cells?.length > 0 && (
                <p className="bm-cells">
                  {row.cells.slice(0, 6).map((c) => (
                    <span className="chip cell" key={c}>
                      {c}
                    </span>
                  ))}
                  {row.cells.length > 6 && <span className="chip">+{row.cells.length - 6} more</span>}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
