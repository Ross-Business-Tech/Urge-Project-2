import { useMemo } from 'react'
import { fmt } from '../shared/index.js'
import { sponsorSummary, run, MEASURES, LIQUIDITY_COMFORT, SCORE_BANDS } from './index.js'
import './sponsor.css'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const BAND_TEXT = {
  strong: 'Strong: their finished projects delivered what they promised.',
  mixed: 'Mixed: their finished projects partly delivered what they promised.',
  weak: 'Weak: their finished projects mostly fell short of what they promised.',
}
const STATUS_TEXT = { delivered: 'Delivered', close: 'Close', missed: 'Missed' }

function Figure({ label, result, show, good, children }) {
  return (
    <div className={`sponsor-card ${result.ok ? (good ? 'good' : 'concern') : 'na'}`}>
      <p className="sponsor-card-label">{label}</p>
      {result.ok ? <p className="sponsor-card-value">{show(result.value)}</p> : <p className="sponsor-card-value na">Not available</p>}
      {!result.ok && <p className="note">{result.reason}</p>}
      {children}
    </div>
  )
}

// M5's sponsor page: the sponsor's projects, global coverage, liquidity, fee dependence and the credibility score with the
// projected-vs-delivered table behind it.
// Props: firm (firm record), projects (every project record the sponsor owns), context ({ settings, project, trackRecord }).
export default function SponsorPanel({ firm, projects, context }) {
  const ctx = useMemo(() => (context && typeof context === 'object' ? context : {}), [context])
  const view = useMemo(() => {
    try {
      const summary = sponsorSummary(firm, projects, ctx)
      const list = Array.isArray(projects) ? projects : []
      const subject = ctx.project ?? list.map((p) => p?.record ?? p).find((p) => p?.data?.stage?.stage) ?? null
      const result = subject ? run(subject, { ...ctx, firm, projects: list }) : null
      return { summary, result }
    } catch {
      return 'error'
    }
  }, [firm, projects, ctx])

  if (view === 'error') {
    return (
      <section className="sponsor">
        <p className="section-label">Sponsor and portfolio</p>
        <p className="banner warn">The sponsor page could not be shown for this review. Check the firm record by hand for now.</p>
      </section>
    )
  }

  const { summary: s, result } = view
  const minDscr = s.settings.minDscr
  const g = s.globalDscr
  const liq = s.liquidity
  const fees = s.feeDependence
  const cred = s.credibility
  const flags = result?.flags ?? []

  return (
    <section className="sponsor">
      <p className="section-label">Sponsor and portfolio: can they deliver, and can they absorb a miss?</p>
      <h2 className="sponsor-name">{s.firm.ok ? s.firm.name : 'No firm record'}</h2>
      {s.firm.ok ? s.firm.principal && <p className="note">Principal: {s.firm.principal}</p> : <p className="banner warn">{s.firm.reason}</p>}

      {flags.length > 0 && (
        <div className="sponsor-flags">
          <p className="sponsor-sub">What needs a look</p>
          <ul>
            {flags.map((f) => (
              <li key={f.id} className={`sponsor-flag ${f.severity}`}>
                <span className="sponsor-sev">{f.severity}</span>
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.evidence}</p>
                  <p className="note">Ask the sponsor: {f.follow_up}</p>
                  {f.cell_refs.length > 0 && <p className="note mono">Cells: {f.cell_refs.join(', ')}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sponsor-grid">
        <Figure label="Global coverage (all projects)" result={g} show={fmt.times} good={g.ok && g.value >= minDscr}>
          {g.ok && (
            <p className="note">
              NOI {fmt.usd(g.noi)} a year against {fmt.usd(g.debtService)} of loan payments, across {g.count} project{g.count === 1 ? '' : 's'}. Lender&apos;s minimum: {fmt.times(minDscr)}.
            </p>
          )}
          {g.operating?.ok && <p className="note">Operating projects only: {fmt.times(g.operating.value)}.</p>}
          {g.excluded?.length > 0 && (
            <p className="note">
              Left out: {g.excluded.map((x) => `${x.name} (${x.reason})`).join('; ')}
            </p>
          )}
        </Figure>

        <Figure label="Liquidity cover" result={liq} show={fmt.times} good={liq.ok && liq.value >= LIQUIDITY_COMFORT}>
          {liq.ok && (
            <>
              <p className="note">
                Firm cash {fmt.usd(liq.firmLiquid)} against {fmt.usd(liq.shortTerm)} owed in the short term. Comfortable is {fmt.times(LIQUIDITY_COMFORT)} or more.
              </p>
              {isNum(liq.withPrincipal) && <p className="note">With the principal&apos;s personal cash and securities: {fmt.times(liq.withPrincipal)}.</p>}
            </>
          )}
          {liq.guarantees && <p className="note">{liq.guarantees}</p>}
        </Figure>

        <Figure label="Fee dependence" result={fees} show={(v) => fmt.pct(v, 0)} good={fees.ok && !(isNum(fees.feeCoverOfOverhead) && fees.feeCoverOfOverhead < 1)}>
          {fees.year && (
            <p className="note">
              {fees.year}: fees {fmt.usd(fees.fees)}
              {isNum(fees.overhead) ? `, overhead ${fmt.usd(fees.overhead)}` : ''}
              {isNum(fees.priorFees) ? ` (fees in ${fees.priorYear}: ${fmt.usd(fees.priorFees)})` : ''}. The big number is the share of the firm&apos;s income that comes from fees.
            </p>
          )}
        </Figure>

        <Figure label="Credibility score" result={cred} show={(v) => `${v} / 100`} good={cred.ok && cred.band === 'strong'}>
          {cred.ok && <p className="note">{BAND_TEXT[cred.band]}</p>}
          <p className="note">
            From {cred.counted ?? 0} of {cred.possible ?? 0} comparisons on completed projects. {SCORE_BANDS.strong} or more is strong.
          </p>
        </Figure>
      </div>

      <p className="sponsor-sub">The sponsor&apos;s projects</p>
      {s.projects.length === 0 ? (
        <p className="note">No projects loaded.</p>
      ) : (
        <div className="sponsor-table-wrap">
          <table className="sponsor-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Stage</th>
                <th>Firm&apos;s share</th>
                <th>NOI a year</th>
                <th>Loan payments a year</th>
                <th>DSCR</th>
              </tr>
            </thead>
            <tbody>
              {s.trackRecord.map((p, i) => (
                <tr key={`${p.projectId ?? p.name}-${i}`}>
                  <td>{p.name}</td>
                  <td>{p.stageLabel}</td>
                  <td>{isNum(p.ownership) ? fmt.pct(p.ownership, 0) : 'Not entered'}</td>
                  <td>{isNum(p.noi) ? fmt.usd(p.noi) : '–'}</td>
                  <td>{isNum(p.debtService) ? fmt.usd(p.debtService) : '–'}</td>
                  <td>{p.usable ? (isNum(p.dscr) ? fmt.times(p.dscr) : 'No loans') : <span className="note">Left out: {p.reason}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="sponsor-sub">Projected vs. delivered on completed projects</p>
      {cred.rows?.length ? (
        <div className="sponsor-table-wrap">
          <table className="sponsor-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>What</th>
                <th>Projected</th>
                <th>Delivered</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {cred.rows.flatMap((r) =>
                MEASURES.map((m, j) => {
                  const x = r.measures[m.id]
                  return (
                    <tr key={`${r.name}-${m.id}`}>
                      <td>{j === 0 ? r.name : ''}</td>
                      <td>{m.label}</td>
                      <td>{x.projected ?? '–'}</td>
                      <td>{x.ok ? x.delivered : x.delivered ?? '–'}</td>
                      <td className={x.ok ? `result ${x.status}` : 'result na'}>{x.ok ? STATUS_TEXT[x.status] : `Not available: ${x.reason}`}</td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="note">{cred.reason}</p>
      )}
    </section>
  )
}
