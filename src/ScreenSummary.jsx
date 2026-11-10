import { useMemo } from 'react'
import { fmt, keyRatios, compareSeverity } from './modules/shared/index.js'
import { checklist as integrityChecklist } from './modules/m1-integrity/index.js'
import { run as benchmarkRun } from './modules/m2-benchmarks/index.js'
import { checklist as devChecklist, appliesTo as devApplies } from './modules/m3d-development/index.js'
import { checklist as completedChecklist } from './modules/m3c-completed/index.js'
import { summary as transitionSummary } from './modules/m3t-transitions/index.js'
import { runScenarios, run as scenarioRun } from './modules/m4-scenarios/index.js'

// The summary at the top of each analysis screen: one verdict sentence, the headline numbers, and the findings to look at
// first. The full detail stays below it. Everything here is worked out from what the modules already report, so it never
// disagrees with the details underneath.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }
const MAX_FLAGS = 3

function Summary({ tone = 'neutral', headline, sub, tiles = [], flags = [], flagsTitle = 'Look at these first' }) {
  const ranked = [...flags].sort((a, b) => compareSeverity(a.severity, b.severity))
  const shown = ranked.slice(0, MAX_FLAGS)
  return (
    <section className={`screen-summary ${tone}`} aria-label="Summary">
      <p className="eyebrow">Summary</p>
      <p className="verdict">{headline}</p>
      {sub && <p className="verdict-sub">{sub}</p>}
      {tiles.length > 0 && (
        <ul className="stats tiles">
          {tiles.map((t) => (
            <li key={t.label} className={t.tone ? `tone-${t.tone}` : undefined}>
              <span className="stat-value">{t.value}</span>
              <span className="stat-label">{t.label}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <>
          <p className="section-label">{flagsTitle}</p>
          <ol className="top-flags">
            {shown.map((f) => (
              <li key={f.id}>
                <span className={`chip ${SEVERITY_CHIP[f.severity] ?? ''}`}>{f.severity}</span>
                <div>
                  <p className="top-flag-title">{f.title}</p>
                  {f.follow_up && <p className="top-flag-ask">Ask the sponsor: {f.follow_up}</p>}
                </div>
              </li>
            ))}
          </ol>
          {ranked.length > shown.length && <p className="note">+{plural(ranked.length - shown.length, 'more finding')}, listed below.</p>}
        </>
      )}
    </section>
  )
}

const display = (r) => (r.unit === 'times' ? fmt.times(r.value) : r.unit === 'percent' ? fmt.pct(r.value) : r.unit === 'months' ? `${r.value.toFixed(1)} months` : String(r.value))

// ---- one builder per screen: returns the props for <Summary />, or null when there is nothing to summarize ----

function keyNumbers({ record, settings }) {
  if (!record.data.stage.stage) return null
  const ratios = keyRatios(record, settings).filter((r) => r.ok)
  if (ratios.length === 0) return null
  const count = (s) => ratios.filter((r) => r.status === s).length
  const concern = count('concern')
  const watch = count('watch')
  const market = benchmarkRun(record, { settings })
  const flags = market.flags.filter((f) => f.severity !== 'low')
  const tone = concern ? 'bad' : watch || flags.length ? 'amber' : 'good'
  const headline = concern
    ? `${plural(concern, 'key ratio')} ${concern === 1 ? 'is' : 'are'} a concern.`
    : watch
      ? `${plural(watch, 'key ratio')} need${watch === 1 ? 's' : ''} watching.`
      : `All ${ratios.filter((r) => r.status).length || ratios.length} key ratios meet your settings.`
  const tiles = ratios.slice(0, 3).map((r) => ({ label: r.title, value: display(r), tone: r.status === 'concern' ? 'bad' : r.status === 'watch' ? 'amber' : r.status === 'ok' ? 'good' : undefined }))
  return {
    tone,
    headline,
    sub: flags.length ? `${plural(flags.length, 'figure')} also sit outside the market range.` : 'Rents, expenses and costs are in line with the market comparison.',
    tiles,
    flags,
    flagsTitle: 'Market figures to question',
  }
}

function checkList(rows, { noun, allGood }) {
  const counted = rows.filter((r) => r.status !== 'not_applicable')
  if (counted.length === 0) return null
  const failed = rows.filter((r) => r.status === 'fail')
  const unchecked = rows.filter((r) => r.status === 'not_checked').length
  const passed = counted.filter((r) => r.status === 'pass').length
  const flags = failed.flatMap((r) => r.flags)
  const worst = flags.reduce((w, f) => (compareSeverity(f.severity, w) < 0 ? f.severity : w), 'low')
  const tone = failed.length === 0 ? 'good' : worst === 'high' ? 'bad' : 'amber'
  return {
    tone,
    headline: failed.length ? `${plural(failed.length, noun)} need${failed.length === 1 ? 's' : ''} a look.` : allGood,
    sub: `${passed} of ${counted.length} checks pass${unchecked ? `, ${unchecked} could not be checked for lack of data` : ''}.`,
    tiles: [
      { label: 'Passed', value: passed, tone: 'good' },
      { label: 'Need a look', value: failed.length, tone: failed.length ? (tone === 'bad' ? 'bad' : 'amber') : undefined },
      { label: 'Could not check', value: unchecked },
    ],
    flags,
  }
}

function dataChecks({ record, firm, result }) {
  if (!record.data.stage.stage || !record.data.stage.asOfDate) return null
  return checkList(integrityChecklist(record, { firm, facts: result.facts, report: result.report }), { noun: 'check', allGood: 'The numbers agree with each other.' })
}

function devRisk({ record, firm, settings }) {
  if (!devApplies(record)) return null
  return checkList(devChecklist(record, { firm, settings }), { noun: 'risk', allGood: 'No development risks raised.' })
}

function completedRisk({ record, firm, settings }) {
  return checkList(completedChecklist(record, { firm, settings }), { noun: 'risk', allGood: 'The property is performing as promised.' })
}

function scenarios({ record, settings }) {
  const res = runScenarios(record, { settings })
  if (!res.ok || !['downside', 'base', 'upside'].every((c) => res.cases[c]?.ok && isNum(res.cases[c].dscr))) return null
  const min = settings.minDscr
  const toneOf = (d) => (d < 1 ? 'bad' : d < min ? 'amber' : 'good')
  const { downside, base, upside } = res.cases
  const flags = scenarioRun(record, { settings }).flags.filter((f) => f.severity !== 'low')
  const headline =
    downside.dscr < 1
      ? 'In the downside case, income no longer covers the loan payments.'
      : downside.dscr < min
        ? 'In the downside case, coverage falls below the lender’s minimum.'
        : 'The loan holds up even in the downside case.'
  return {
    tone: toneOf(downside.dscr),
    headline,
    sub: `Loan coverage (DSCR) against the lender’s minimum of ${fmt.times(min)}. Move the sliders below to try your own numbers.`,
    tiles: [
      { label: 'Downside coverage', value: fmt.times(downside.dscr), tone: toneOf(downside.dscr) },
      { label: 'Base coverage', value: fmt.times(base.dscr), tone: toneOf(base.dscr) },
      { label: 'Upside coverage', value: fmt.times(upside.dscr), tone: toneOf(upside.dscr) },
    ],
    flags,
  }
}

const NEXT_TONE = { on_track: 'good', watch: 'amber', at_risk: 'bad', unknown: 'neutral' }
const NEXT_TEXT = { on_track: 'is on track', watch: 'is worth watching', at_risk: 'is at risk', unknown: 'cannot be judged yet' }

function stageChanges({ record, firm, settings }) {
  if (!record.data.stage.stage || !record.data.stage.asOfDate) return null
  const s = transitionSummary(record, { firm, settings })
  if (!s?.next) return null
  const { next, rows } = s
  const failed = rows.filter((r) => r.status === 'fail')
  const when = next.when?.text
  return {
    tone: NEXT_TONE[next.status] ?? 'neutral',
    headline: `The next stage change ${NEXT_TEXT[next.status] ?? 'needs a look'}.`,
    sub: [String(next.title).replace(/^./, (c) => c.toUpperCase()), when ? `expected ${when}` : null].filter(Boolean).join(', ') + '.',
    tiles: [
      { label: 'Looks fine', value: rows.filter((r) => r.status === 'pass').length, tone: 'good' },
      { label: 'Look closer', value: failed.length, tone: failed.length ? 'amber' : undefined },
      { label: 'Could not check', value: rows.filter((r) => r.status === 'not_checked').length },
    ],
    flags: failed.flatMap((r) => r.flags),
  }
}

const BUILDERS = { keynumbers: keyNumbers, datachecks: dataChecks, scenarios, devrisk: devRisk, completedrisk: completedRisk, transitions: stageChanges }

// The summary for one screen, then a heading that introduces the detail below it. Draws nothing if the screen has no summary
// yet (for example no stage chosen) or if working it out fails: the details underneath still show.
export default function ScreenSummary({ kind, record, firm, settings, result }) {
  const props = useMemo(() => {
    try {
      return BUILDERS[kind]?.({ record, firm, settings, result }) ?? null
    } catch {
      return null
    }
  }, [kind, record, firm, settings, result])
  if (!props) return null
  return (
    <>
      <Summary {...props} />
      <h2 className="details-heading">The details</h2>
    </>
  )
}
