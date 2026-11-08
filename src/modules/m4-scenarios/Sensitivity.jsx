import { useMemo } from 'react'
import { fmt } from '../shared/index.js'
import { runBreakEvens, runImpacts } from './sensitivity.js'
import { leverText } from './format.js'

const pct = (n, digits = 1) => `${(n * 100).toFixed(digits)}%`
const signedUsd = (n) => `${n > 0 ? '+' : ''}${fmt.usd(n)}`
const signedTimes = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}×`

// How far a lever can move, in the words a reviewer would use.
const AMOUNT = {
  rentChange: (h) => `down ${pct(h)}`,
  vacancyChange: (h) => `up ${(h * 100).toFixed(1)} points`,
  expenseGrowth: (h) => `up ${pct(h, 0)}`,
  takeoutRate: (h) => `up ${(h * 100).toFixed(2)} points`,
  costOverrun: (h) => `${pct(h)} over budget`,
  delayMonths: months,
  absorptionMonths: months,
}
const months = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)} months`
const NAME = { rentChange: 'Rents', vacancyChange: 'Vacancy', expenseGrowth: 'Operating expenses', takeoutRate: 'Loan rate' }

function room(id, r) {
  if (r.status === 'already') return { text: 'Already below', tone: 'warn' }
  if (r.status === 'noeffect') return { text: id === 'takeoutRate' ? 'No effect: a yearly payment was typed in' : 'No effect on this project', tone: '' }
  if (r.status === 'never') return { text: `Holds up even at ${AMOUNT[id](Math.abs(r.limit))}`, tone: 'good' }
  return { text: AMOUNT[id](r.headroom), tone: '' }
}

function BreakEven({ data, minDscr }) {
  if (!data.ok) return <p className="note">{data.reason}</p>
  const [min, one] = data.targets
  return (
    <>
      <p className="note">
        Each line moves one thing on its own, in the bad direction, from where the Base case sits, and finds the point where the loan breaks. Everything else stays at its Base setting.
      </p>
      <p className="section-label">How far before coverage (DSCR) drops</p>
      <table className="sc-table">
        <thead>
          <tr>
            <th scope="col">What moves</th>
            <th scope="col">Below the lender&apos;s {fmt.times(min)}</th>
            <th scope="col">Below {fmt.times(one)}</th>
          </tr>
        </thead>
        <tbody>
          {data.coverage.map((row) => (
            <tr key={row.def.id}>
              <th scope="row">{NAME[row.def.id]} can go</th>
              {row.results.map((r) => {
                const cell = room(row.def.id, r)
                return (
                  <td key={r.target} className={cell.tone}>
                    {cell.text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {minDscr !== min && <p className="note">The lender&apos;s minimum is {fmt.times(min)}.</p>}

      {data.money.length > 0 && (
        <>
          <p className="section-label">How far before new money is needed</p>
          <table className="sc-table">
            <tbody>
              {data.money.map((row) => {
                const cell = room(row.def.id, row)
                return (
                  <tr key={row.def.id}>
                    <th scope="row">{row.def.label} can reach</th>
                    <td className={cell.tone}>{cell.text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="note">Overruns are absorbed by the contingency. Delays and slow lease-up are paid from the rent-up and operating reserves.</p>
        </>
      )}
    </>
  )
}

function Bar({ value, max }) {
  const width = max > 0 ? Math.max(3, Math.round((Math.abs(value) / max) * 100)) : 0
  return (
    <div className="sc-bar" aria-hidden="true">
      <div className="sc-bar-fill" style={{ width: `${width}%` }} />
    </div>
  )
}

function Impacts({ data }) {
  if (!data.ok) return <p className="note">{data.reason}</p>
  const maxDscr = Math.max(0, ...data.coverage.map((r) => Math.abs(r.dscr.change ?? 0)))
  const maxCost = Math.max(0, ...data.money.map((r) => r.extraCost.change))
  const t = data.together
  return (
    <>
      <p className="note">
        Each lever turned alone, to the Downside case&apos;s setting, compared with the Base case. Worst first. This shows which assumption deserves the question to the sponsor.
      </p>

      {data.coverage.length > 0 && (
        <>
          <p className="section-label">What hurts the yearly coverage</p>
          <ol className="sc-impacts">
            {data.coverage.map((r) => (
              <li key={r.def.id}>
                <div className="sc-impact-top">
                  <strong>
                    {r.def.label} {leverText(r.def, r.setting)}
                  </strong>
                  <span>{r.dscr.to === null ? 'DSCR not available' : `DSCR ${fmt.times(r.dscr.from)} → ${fmt.times(r.dscr.to)} (${signedTimes(r.dscr.change)})`}</span>
                </div>
                <Bar value={r.dscr.change ?? 0} max={maxDscr} />
                <p className="ratio-detail">
                  {r.noEffect
                    ? r.def.id === 'takeoutRate'
                      ? 'No effect on this project: a yearly loan payment was typed in, so it does not move with the rate. That also means the rate risk is not being tested.'
                      : 'No effect on this project.'
                    : `Cash left after loan payments ${signedUsd(r.cashFlow.change)} a year`}
                </p>
              </li>
            ))}
          </ol>
          {t.dscr !== null && data.coverage.length > 1 && (
            <p className="note">
              All the Downside levers together: DSCR {fmt.times(data.base.dscr)} → {fmt.times(t.dscr)} ({signedTimes(t.dscrChange)}). Added up one at a time: {signedTimes(t.sumOfDscrChanges)}. They are not
              identical because the levers act on each other.
            </p>
          )}
        </>
      )}

      {data.money.length > 0 && (
        <>
          <p className="section-label">What costs one-time money</p>
          <ol className="sc-impacts">
            {data.money.map((r) => (
              <li key={r.def.id}>
                <div className="sc-impact-top">
                  <strong>
                    {r.def.label} {leverText(r.def, r.setting)}
                  </strong>
                  <span>{signedUsd(r.extraCost.change)} extra cost</span>
                </div>
                <Bar value={r.extraCost.change} max={maxCost} />
                <p className="ratio-detail">{r.gap.change > 0 ? `Needs ${fmt.usd(r.gap.change)} of new money on its own` : 'Absorbed by the contingency or reserves on its own'}</p>
              </li>
            ))}
          </ol>
        </>
      )}

      {data.value.length > 0 && (
        <>
          <p className="section-label">What it does to the value at takeout</p>
          <ol className="sc-impacts">
            {data.value.map((r) => (
              <li key={r.def.id}>
                <div className="sc-impact-top">
                  <strong>
                    {r.def.label} {leverText(r.def, r.setting)}
                  </strong>
                  <span>{r.loanToValue.to === null ? 'Not available' : `Loan vs. value ${pct(r.loanToValue.from)} → ${pct(r.loanToValue.to)}`}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {data.quiet.length > 0 && <p className="note">Not turned in the Downside case, so nothing to compare: {data.quiet.map((d) => d.label.toLowerCase()).join(', ')}.</p>}
    </>
  )
}

// Break-even and one-lever-at-a-time, under the three cases. Break-even only depends on the Base sliders, so it is not
// worked out again while the Downside or Upside sliders move.
export function Sensitivity({ record, settings, levers, basis }) {
  const baseKey = JSON.stringify(levers?.base ?? null)
  const breakEven = useMemo(() => runBreakEvens(record, { settings, levers: levers ? { base: levers.base } : undefined, basis }), [record, settings, basis, baseKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const impacts = useMemo(() => runImpacts(record, { settings, levers: levers ?? undefined, basis }), [record, settings, levers, basis])
  return (
    <>
      <p className="section-label">How far can it go before it breaks?</p>
      <BreakEven data={breakEven} minDscr={settings.minDscr} />
      <p className="section-label">What hurts most? One lever at a time</p>
      <Impacts data={impacts} />
    </>
  )
}
