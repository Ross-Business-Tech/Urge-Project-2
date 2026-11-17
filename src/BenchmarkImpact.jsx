import { useMemo } from 'react'
import { benchmarkEffects } from './benchmarkEffects.js'
import { useBenchmarks } from './useBenchmarks.js'
import './modules/m2-benchmarks/benchmarks.css'

const STATUS = {
  within: { label: 'Within range', chip: 'good' },
  better: { label: 'Better than range', chip: 'good' },
  above: { label: 'Above range', chip: 'amber' },
  below: { label: 'Below range', chip: 'amber' },
  not_available: { label: 'Not available', chip: '' },
  unused: { label: 'Not used', chip: '' },
}
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }
const SCREEN = { keynumbers: 'Key numbers', devrisk: 'Development risk' }

// "What your benchmarks found": for the project on screen, where it stands against every range the team entered, and which parts of
// it no range covers. The detail for each finding is on the screen named beside it.
export default function BenchmarkImpact({ record, firm, settings, onGo }) {
  const { entries } = useBenchmarks()
  const effects = useMemo(() => {
    try {
      return benchmarkEffects(record, entries ?? [], { settings, firm })
    } catch {
      return null
    }
  }, [record, entries, settings, firm])

  if (!effects) return <p className="note">What your benchmarks found could not be worked out for this project.</p>
  if (!record.data.stage.stage) return <p className="note">Choose a stage above to see what your benchmarks find in this project.</p>
  if (effects.items.length === 0) return <p className="note">Add a range below, and this section will show what it finds in this project.</p>

  const outside = effects.items.filter((i) => i.status === 'above' || i.status === 'below').length
  const better = effects.items.filter((i) => i.status === 'better').length
  const compared = effects.items.filter((i) => i.status === 'within' || i.status === 'above' || i.status === 'below' || i.status === 'better').length
  return (
    <section className="benchmark-impact" aria-label="What your benchmarks found">
      <h2 className="details-heading">What your benchmarks found</h2>
      <p className={outside ? 'banner warn' : 'ok'} role="status">
        {compared === 0
          ? 'None of your ranges could be compared with this project yet.'
          : outside
            ? `${outside} of ${compared} compared ${compared === 1 ? 'figure is' : 'figures are'} outside your range${better ? `; ${better} more ${better === 1 ? 'is' : 'are'} better than it` : ''}.`
            : better
              ? `All ${compared} compared ${compared === 1 ? 'figure is' : 'figures are'} within your range or better than it (${better} better).`
              : `All ${compared} compared ${compared === 1 ? 'figure is' : 'figures are'} within your range.`}
      </p>
      <ul className="bm-list">
        {effects.items.map((item) => {
          const st = STATUS[item.status]
          const out = item.status === 'above' || item.status === 'below'
          return (
            <li key={item.id} className={`bm-row ${item.status === 'unused' ? 'not_applicable' : item.status}`}>
              <div className="bm-top">
                <span className="bm-label">{item.label}</span>
                <span className="chips">
                  <span className={`chip ${out && item.severity ? SEVERITY_CHIP[item.severity] : st.chip}`}>
                    {item.status === 'better' ? '✓ ' : ''}
                    {st.label}
                    {out && item.severity ? ` · ${item.severity}` : ''}
                  </span>
                </span>
              </div>
              <p className="bm-detail">Your range: {item.wanted}</p>
              <p className="bm-detail">{item.text}</p>
              {onGo && item.status !== 'unused' && (
                <p className="bm-detail">
                  <button type="button" className="link-button" onClick={() => onGo(item.screen)}>
                    See it on {SCREEN[item.screen]}
                  </button>
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {effects.notCompared.length > 0 && (
        <>
          <p className="section-label">Not compared</p>
          <ul className="bm-notes">
            {effects.notCompared.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="note">Add a range for these, with the same unit type and income level, to compare them.</p>
        </>
      )}
    </section>
  )
}
