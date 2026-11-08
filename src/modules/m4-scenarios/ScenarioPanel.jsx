import { useMemo, useState } from 'react'
import './scenarios.css'
import { fmt, DEFAULT_SETTINGS, STAGES } from '../shared/index.js'
import { CASES, FILL_OCCUPANCY, resolveLevers } from './levers.js'
import { runScenarios } from './engine.js'
import { runScenarioChecks, basisSentence } from './index.js'
import { leverText } from './format.js'
import { Sensitivity } from './Sensitivity.jsx'

const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }

function dscrStatus(value, minimum) {
  if (value >= minimum) return { chip: 'good', label: 'meets the minimum' }
  if (value >= 1) return { chip: 'amber', label: 'below the minimum' }
  return { chip: 'warn', label: 'loan payments not covered' }
}

function Result({ label, value, hint, chip }) {
  return (
    <div className="sc-result">
      <dt>{label}</dt>
      <dd>
        {value}
        {chip && <span className={`chip ${chip.chip}`}>{chip.label}</span>}
      </dd>
      {hint && <dd className="sc-hint">{hint}</dd>}
    </div>
  )
}

function CaseResults({ result, settings, stage, onOpenGroup }) {
  if (!result.ok) {
    return (
      <div className="sc-na">
        <p className="ratio-value muted">Not available</p>
        <p className="ratio-detail">{result.reason}</p>
        {result.needs?.map((n) => (
          <button type="button" className="link needs" key={n.group} onClick={() => onOpenGroup?.(n.group)}>
            Fill in: {n.label}
          </button>
        ))}
      </div>
    )
  }
  const gap = result.oneTime
  return (
    <dl className="sc-results">
      <Result
        label="Loan payments covered (DSCR)"
        value={result.dscr === null ? 'Not available' : fmt.times(result.dscr)}
        chip={result.dscr === null ? null : dscrStatus(result.dscr, settings.minDscr)}
      />
      <Result label="Income after costs (NOI)" value={`${fmt.usd(result.noi)} a year`} />
      <Result label="Loan payments" value={`${fmt.usd(result.debtService)} a year`} />
      <Result
        label="Cash left after loan payments"
        value={`${fmt.usd(result.cashFlow)} a year`}
        hint={result.yearlyShortfall > 0 ? `Short by ${fmt.usd(result.yearlyShortfall)} a year` : null}
      />
      <Result label="Debt yield" value={result.debtYield === null ? 'Not available' : fmt.pct(result.debtYield)} hint="NOI as a share of the debt" />
      {stage !== 'completed' && gap && !gap.ok && <Result label="One-time costs from the stress" value="Not available" hint={gap.reason} />}
      {stage !== 'completed' && gap?.ok && (
        <>
          <Result
            label="Extra cost from overrun and delay"
            value={fmt.usd(gap.extraCost)}
            hint={[`Overrun ${fmt.usd(gap.overrunCost)}`, `carrying cost of delay and slow filling ${fmt.usd(gap.carry)}`].join(' · ')}
          />
          <Result
            label="Covered by contingency and reserves"
            value={fmt.usd(gap.covered)}
            hint={`${fmt.usd(gap.contingency)} contingency (for overruns) · ${fmt.usd(gap.reserves)} rent-up and operating reserves (for carrying costs)`}
          />
          <Result
            label="Funding gap"
            value={fmt.usd(gap.gap)}
            chip={gap.gap > 0 ? { chip: 'warn', label: 'needs new money' } : null}
            hint={gap.gap > 0 ? 'What is left after the contingency and reserves' : 'Nothing is left over'}
          />
          <Result
            label="Delay the reserves can absorb"
            value={gap.delayMonthsCovered === null ? 'Not available' : `${gap.delayMonthsCovered.toFixed(1)} months`}
            hint={gap.delayMonthsCovered === null ? null : `A month of delay costs about ${fmt.usd(gap.monthlyDelay)}${stage === 'development' ? ' in loan payments' : ''}`}
          />
          {gap.notes.map((n) => (
            <p className="ratio-detail" key={n}>
              {n}
            </p>
          ))}
        </>
      )}
      {result.exit && <Result label="Loan vs. value at takeout" value={fmt.pct(result.exit.loanToValue)} hint={`Worth ${fmt.usd(result.exit.value)} at a ${fmt.pct(result.exit.capRate, 2)} cap rate`} />}
      {result.notes.map((n) => (
        <p className="ratio-detail" key={n}>
          {n}
        </p>
      ))}
    </dl>
  )
}

// What the three cases start from, and (for a lease-up project) the T-12 beside it as a reference.
function Basis({ basis, stage, choice, onChoose }) {
  const ref = basis.reference
  return (
    <div className="sc-basis" role="status">
      <p>
        <strong>Starting from:</strong> {basisSentence(basis)}
      </p>
      {ref?.summary && (
        <p className="ratio-detail">
          For reference, the T-12 shows: {ref.summary}. It is not the starting point, because a building that is still filling earns less than it will when full.
        </p>
      )}
      {ref?.reason && <p className="ratio-detail">No T-12 reference: {ref.reason}</p>}
      {stage === 'completed' && basis.t12Usable && (
        <button type="button" className="button small" onClick={() => onChoose(choice === 'projection' ? 'auto' : 'projection')}>
          {choice === 'projection' ? 'Start from the T-12 actuals instead' : "Compare: start from the applicant's projection instead"}
        </button>
      )}
    </div>
  )
}

// The scenario screen for one project: three cases side by side (stacked on a phone), a slider for each lever in each
// case, and what the downside means for the review. The sliders only change this screen; they are not saved with the record.
export function ScenarioPanel({ record, settings = DEFAULT_SETTINGS, onOpenGroup }) {
  const stage = record.data.stage.stage
  const [levers, setLevers] = useState(null) // null until a slider is moved: the starting values are used
  const [basisChoice, setBasisChoice] = useState('auto') // 'projection' = compare with the applicant's numbers (completed projects)
  const setting = (caseId, leverId, value) =>
    setLevers((current) => {
      const all = current ?? resolveLevers(stage, null).cases
      return { ...all, [caseId]: { ...all[caseId], [leverId]: value } }
    })

  // Changing the stage changes which levers exist, so start over rather than carry settings across.
  const [forStage, setForStage] = useState(stage)
  if (forStage !== stage) {
    setForStage(stage)
    setLevers(null)
    setBasisChoice('auto')
  }

  const out = useMemo(() => (stage ? runScenarios(record, { settings, levers, basis: basisChoice }) : null), [record, settings, levers, basisChoice, stage])
  const review = useMemo(() => (stage ? runScenarioChecks(record, { settings, scenarios: levers ?? undefined, basis: basisChoice }) : null), [record, settings, levers, basisChoice, stage])

  if (!stage) {
    return (
      <>
        <p className="section-label">Scenarios: downside, base, upside</p>
        <p className="note">Choose a stage above to stress-test this project. The stage decides which levers apply.</p>
      </>
    )
  }

  const chosen = STAGES.find((s) => s.value === stage)
  const changed = levers !== null

  return (
    <section className="scenarios" aria-label="Scenarios">
      <p className="section-label">Scenarios: downside, base, upside</p>
      <p className="note">
        What happens to the loan if things go wrong? Move a slider to try your own numbers. The levers shown are the ones for a <strong>{chosen?.label.toLowerCase()}</strong> project. Sliders only change this
        screen.
      </p>

      {out.ok !== false && <Basis basis={out.basis} stage={stage} choice={basisChoice} onChoose={setBasisChoice} />}

      <div className="sc-cases">
        {CASES.map((c) => (
          <div className={`sc-case sc-${c.id}`} key={c.id}>
            <h3>{c.label}</h3>
            <p className="ratio-detail">{c.id === 'base' && out.basis.kind === 'actuals' ? 'The property as it has actually performed (T-12)' : c.plain}</p>

            <div className="sc-levers">
              {out.defs.map((def) => {
                const value = out.levers[c.id][def.id]
                return (
                  <label className="sc-lever" key={def.id}>
                    <span className="sc-lever-top">
                      <span className="edit-label">{def.label}</span>
                      <output className="sc-value">{leverText(def, value)}</output>
                    </span>
                    <input
                      type="range"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={value}
                      aria-label={`${c.label} case: ${def.label}`}
                      onChange={(e) => setting(c.id, def.id, Number(e.target.value))}
                    />
                  </label>
                )
              })}
            </div>

            <CaseResults result={out.cases[c.id]} settings={settings} stage={stage} onOpenGroup={onOpenGroup} />
          </div>
        ))}
      </div>

      <Sensitivity record={record} settings={settings} levers={levers} basis={basisChoice} />

      <div className="actions">
        <button type="button" className="button small" disabled={!changed} onClick={() => setLevers(null)}>
          Reset the sliders
        </button>
      </div>

      <p className="section-label">What the downside means for the review ({review.flags.length})</p>
      {review.flags.length === 0 ? (
        <p className="ok">The downside case holds up: coverage stays at or above the lender&apos;s minimum of {fmt.times(settings.minDscr)}, and the budget and reserves are enough.</p>
      ) : (
        <ul className="sc-flags">
          {review.flags.map((f) => (
            <li key={f.id}>
              <span className={`chip ${SEVERITY_CHIP[f.severity]}`}>{f.severity}</span> <strong>{f.title}</strong>
              <p className="ratio-detail">{f.evidence}</p>
              <p className="ratio-detail">Ask the sponsor: {f.follow_up}</p>
            </li>
          ))}
        </ul>
      )}

      <details className="sc-how">
        <summary>What each lever means, and how it is worked out</summary>
        <ul className="items">
          {out.defs.map((def) => (
            <li key={def.id}>
              <span>
                <strong>{def.label}</strong>: {def.plain}
              </span>
            </li>
          ))}
        </ul>
        <p className="note">
          Income, loan payments, coverage and debt yield come from the same calculators as the key ratios, run on a copy of the project with the levers applied. The base case is the project exactly as entered.
          For extra months of delay or lease-up, a half-full building ({fmt.pct(FILL_OCCUPANCY, 0)} of stabilized income) is assumed while it fills. Cost overruns draw on the contingency first; carrying costs draw
          on the budgeted rent-up and operating reserves. Both are simplifications for a first look, not a draw schedule.
        </p>
        {out.notes.map((n) => (
          <p className="note" key={n}>
            {n}
          </p>
        ))}
      </details>
    </section>
  )
}
