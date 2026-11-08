// M5: Sponsor and portfolio (layer 5, cross-project). "Does this sponsor have the track record and cash to deliver, and
// can they absorb a miss?"
//
//   run(project, context) -> { flags, notes }            the module interface every module shares (section 1d)
//   sponsorSummary(firm, projects, context)              the firm-level picture for the sponsor page (see metrics.js)
//
// context: { firm, projects, settings, trackRecord }. `firm` is the firm record and `projects` every project the sponsor
// owns (this one included; it is added if missing). A healthy project under a failing firm is still a risk, and it matters
// most at the development stage, when the sponsor must still fund overruns and carry the project until it earns.

import { createFlagMaker, guardModule, missingDataFlag, citeCells, dscr, fmt, sanitizeSettings } from '../shared/index.js'
import { sponsorSummary, LIQUIDITY_COMFORT, MEASURES } from './metrics.js'

export { sponsorSummary, LIQUIDITY_COMFORT, SCORE_BANDS, MEASURES, scoreBand, stageLabel } from './metrics.js'

export const MODULE_ID = 'M5'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)
const MAX_REFS = 50

// Cell references, only for values that are there, at most 50.
function cite(record, paths) {
  try {
    return citeCells(record, paths).slice(0, MAX_REFS)
  } catch {
    return []
  }
}

function projectIsSound(project, settings) {
  try {
    const r = dscr(project)
    return r.ok && r.value >= settings.minDscr
  } catch {
    return false
  }
}

// ---- Liquidity: the firm's cash against what it owes soon
function liquidityFlags({ flag, stage, summary, firm, sound, fees }) {
  const liq = summary.liquidity
  if (!liq.ok) {
    if (liq.nothingOwed) return []
    return [
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'liquidity',
        checkTitle: "The sponsor firm's cash against its obligations",
        missing: [liq.reason, 'fill in: Firm balance sheet (cash and current liabilities)'],
        cell_refs: cite(firm, liq.paths ?? []),
      }),
    ]
  }
  const early = stage === 'development' || stage === 'lease_up'
  const principalHelps = isNum(liq.withPrincipal) && liq.withPrincipal >= LIQUIDITY_COMFORT
  let severity = null
  if (liq.value < 1) severity = principalHelps ? 'medium' : 'high'
  else if (liq.value < LIQUIDITY_COMFORT) severity = early ? 'medium' : 'low'
  if (!severity) return []

  const short = liq.value < 1
  const title = sound
    ? `This project's own numbers hold up, but the sponsor firm ${short ? 'does not have the cash to cover what it owes soon' : 'has only a thin cash cushion'}.`
    : `The sponsor firm ${short ? 'does not have the cash to cover what it owes soon' : 'has only a thin cash cushion against what it owes soon'}.`
  const parts = [
    `Firm cash and liquid assets ${fmt.usd(liq.firmLiquid)} against ${fmt.usd(liq.shortTerm)} of short-term obligations: cover ${fmt.times(liq.value)} (comfortable is ${fmt.times(LIQUIDITY_COMFORT)} or more).`,
  ]
  if (isNum(liq.priorLiquid)) parts.push(`Cash was ${fmt.usd(liq.priorLiquid)} in the prior period.`)
  if (isNum(liq.longTermDebt)) parts.push(`Notes and mortgages owed by the firm: ${fmt.usd(liq.longTermDebt)}${isNum(liq.priorLongTermDebt) ? ` (prior period ${fmt.usd(liq.priorLongTermDebt)})` : ''}.`)
  if (isNum(liq.withPrincipal)) parts.push(`Adding the principal's personal cash and securities (${fmt.usd(liq.principalLiquid)}): cover ${fmt.times(liq.withPrincipal)}.`)
  if (fees?.year && fees.priorYear !== null && isNum(fees.peakFees) && fees.peakFees > fees.fees) parts.push(`Fee income fell from ${fmt.usd(fees.peakFees)} in ${fees.peakYear} to ${fmt.usd(fees.fees)} in ${fees.year}.`)
  if (sound) parts.push('The project itself covers its debt; the risk is a sponsor that cannot fund a shortfall or keep its guarantees.')
  if (early) parts.push('At this stage the sponsor must still fund overruns and carry the project until it earns, so this matters most now.')
  parts.push(liq.guarantees)

  return [
    flag({
      id: 'M5-firm-liquidity',
      severity,
      title,
      evidence: clip(parts.join(' '), 1000),
      cell_refs: cite(firm, liq.paths),
      follow_up: `Please send a current statement of the firm's cash and unused credit lines, list every guarantee the firm and principal have given, and explain how the firm will pay its ${fmt.usd(liq.shortTerm)} of short-term obligations.`,
    }),
  ]
}

// ---- Fee income: shrinking fees, or fees that no longer cover the firm's overhead
function feeFlags({ flag, stage, summary, firm }) {
  const fees = summary.feeDependence
  if (!fees.year) {
    return [
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'fee-income',
        checkTitle: "The sponsor firm's fee income and fee dependence",
        missing: [fees.reason, 'fill in: Firm earnings by year (fees and overhead)'],
      }),
    ]
  }
  const fell = isNum(fees.change) && fees.change <= -0.5
  const belowOverhead = isNum(fees.overhead) && fees.overhead > 0 && fees.fees < fees.overhead
  if (!fell && !belowOverhead) return []
  const severity = fell && belowOverhead ? 'high' : 'medium'
  const parts = [`Fee income ${fmt.usd(fees.fees)} in ${fees.year}`]
  if (fell) parts.push(`down from ${fmt.usd(fees.priorFees)} in ${fees.priorYear} (${fmt.pct(fees.change, 0)})`)
  let evidence = `${parts.join(', ')}.`
  if (isNum(fees.overhead)) evidence += ` Overhead (salaries, rent, insurance and the like) was ${fmt.usd(fees.overhead)}${isNum(fees.feeCoverOfOverhead) ? `, so fees cover ${fmt.pct(fees.feeCoverOfOverhead, 0)} of it` : ''}.`
  if (fees.ok) evidence += ` Fees are ${fmt.pct(fees.value, 0)} of the firm's income.`
  if (fees.projectionsLeftOut) evidence += ` ${fees.projectionsLeftOut} projected year${fees.projectionsLeftOut === 1 ? ' was' : 's were'} left out.`
  return [
    flag({
      id: 'M5-fee-income-weak',
      severity,
      title: belowOverhead ? "The sponsor firm's fee income no longer covers its overhead." : "The sponsor firm's fee income has fallen sharply.",
      evidence: clip(evidence, 1000),
      cell_refs: cite(firm, fees.paths ?? []),
      follow_up: 'Which projects will pay the firm fees over the next two years, when, and how will the firm cover its overhead until then?',
    }),
  ]
}

// ---- Global coverage across every project the sponsor owns
function globalFlags({ flag, stage, summary, settings, records }) {
  const g = summary.globalDscr
  const flags = []
  if (g.excluded?.length || !g.ok) {
    const missing = g.excluded?.length ? g.excluded.map((x) => `${x.name}: ${x.reason}`) : [g.reason]
    if (!g.ok && g.excluded?.length) missing.unshift(g.reason)
    flags.push(
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'global-dscr',
        checkTitle: g.ok ? `Coverage for ${g.excluded.length} of the sponsor's projects` : "Global coverage across the sponsor's projects",
        missing: clipList(missing, 900),
      }),
    )
  }
  // With only this project counted, global coverage is the project's own DSCR, which the stage modules already judge.
  const onlyThisOne = g.ok && g.count === 1 && records.length === 1
  if (g.ok && g.value < settings.minDscr && !onlyThisOne) {
    const severity = g.value < 1 ? 'high' : 'medium'
    let evidence = `Across ${g.count} project${g.count === 1 ? '' : 's'}: NOI ${fmt.usd(g.noi)} a year against ${fmt.usd(g.debtService)} of debt service, a global DSCR of ${fmt.times(g.value)} vs the lender's ${fmt.times(settings.minDscr)} minimum.`
    if (g.operating?.ok) evidence += ` Operating projects alone: ${fmt.times(g.operating.value)}.`
    if (g.excluded.length) evidence += ` Left out for missing data: ${g.excluded.map((x) => x.name).join(', ')}.`
    const refs = records.flatMap((r) =>
      cite(
        r,
        (r.data.sources?.rows ?? []).flatMap((row, i) => ['amount', 'interestRate', 'termMonths'].filter((k) => isNum(row?.[k])).map((k) => `sources.rows.${i}.${k}`)),
      ),
    )
    flags.push(
      flag({
        id: 'M5-global-dscr-low',
        severity,
        title: g.value < 1 ? "The sponsor's projects together do not earn enough to pay their loans." : "The sponsor's projects together cover their loans by less than the lender's minimum.",
        evidence: clip(evidence, 1000),
        cell_refs: refs.slice(0, MAX_REFS),
        follow_up: 'Which of your projects are short of covering their loan payments today, and how are those shortfalls being funded?',
      }),
    )
  }
  return flags
}

function clipList(list, max) {
  const out = []
  let used = 0
  for (const item of list) {
    if (used + item.length > max) {
      out.push(`and ${list.length - out.length} more`)
      break
    }
    out.push(item)
    used += item.length + 2
  }
  return out
}

// ---- Credibility: what the sponsor's completed projects delivered against what they projected
function credibilityFlags({ flag, stage, summary, project, records }) {
  if (stage === 'completed') return [] // a completed project is judged on its own actuals by M3C; the score is shown on the sponsor page
  const cred = summary.credibility
  if (!cred.ok) {
    return [
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: cred.noCompleted ? 'track-record' : 'credibility',
        checkTitle: "The sponsor's delivery record on finished projects",
        missing: cred.noCompleted
          ? ['The application has no completed projects by this sponsor', 'ask for the projected and actual budget, schedule, rents and stabilization of past projects']
          : [cred.reason, 'fill in: a T-12 and the underwritten rents for each completed project'],
      }),
    ]
  }
  const early = stage === 'development'
  let severity = null
  if (cred.band === 'weak') severity = early ? 'high' : 'medium'
  else if (cred.band === 'mixed') severity = early ? 'medium' : 'low'
  if (!severity) return []
  const misses = cred.rows.flatMap((r) => MEASURES.filter((m) => r.measures[m.id].ok && r.measures[m.id].status === 'missed').map((m) => `${r.name}: ${m.label.toLowerCase()} (projected ${r.measures[m.id].projected}, delivered ${r.measures[m.id].delivered})`))
  const evidence = `Credibility score ${cred.value} out of 100 from ${cred.counted} of ${cred.possible} projected-vs-delivered comparisons on ${cred.rows.length} completed project${cred.rows.length === 1 ? '' : 's'} (80 or more is strong).${misses.length ? ` Missed: ${misses.join('; ')}.` : ''} This project's projections should be read in that light.`
  const completed = records.filter((r) => r.data?.stage?.stage === 'completed')
  const refs = completed.flatMap((r) => cite(r, ['timeline.constructionCompletion', 'timeline.stabilization', ...(r.data.residentialIncome?.rows ?? []).map((_, i) => `residentialIncome.rows.${i}.monthlyRent`)]))
  return [
    flag({
      id: 'M5-credibility-low',
      severity,
      title: `The sponsor's finished projects ${cred.band === 'weak' ? 'mostly fell short of' : 'only partly met'} what they projected.`,
      evidence: clip(evidence, 1000),
      cell_refs: [...cite(project, ['residentialIncome.rows.0.monthlyRent', 'timeline.stabilization']), ...refs].slice(0, MAX_REFS),
      follow_up: 'For each finished project, what caused the gap between what you projected and what was delivered, and what is different about this project?',
    }),
  ]
}

function runChecks(project, context) {
  const ctx = context !== null && typeof context === 'object' ? context : {}
  if (!project?.data?.stage?.stage) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The sponsor checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the sponsor checks did not run.'],
    }
  }
  const { flag, stage } = createFlagMaker(MODULE_ID, project)
  const settings = sanitizeSettings(ctx.settings)
  const firm = ctx.firm ?? null
  const summary = sponsorSummary(firm, ctx.projects ?? [project], { ...ctx, project, settings })
  const records = (Array.isArray(ctx.projects) ? ctx.projects : [])
    .map((p) => (p?.data ? p : p?.record?.data ? p.record : null))
    .filter(Boolean)
  if (!records.includes(project)) records.push(project)

  const notes = [`Stage used: ${stage}.`, ...summary.notes]
  const flags = []
  const sound = projectIsSound(project, settings)

  if (!summary.firm.ok) {
    flags.push(
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'firm-record',
        checkTitle: "The sponsor firm's cash, earnings and debts",
        missing: ["the sponsor's firm record", 'fill in: Cover, Balance Sheet, Principal PFS, Consolidated Financials and Cap Table tabs'],
      }),
    )
    notes.push('No firm record, so only the project-based sponsor checks ran (global coverage and the delivery record).')
  } else {
    notes.push(`Sponsor: ${summary.firm.name}.`)
    flags.push(...liquidityFlags({ flag, stage, summary, firm, sound, fees: summary.feeDependence }))
    flags.push(...feeFlags({ flag, stage, summary, firm }))
  }
  flags.push(...globalFlags({ flag, stage, summary, settings, records }))
  flags.push(...credibilityFlags({ flag, stage, summary, project, records }))

  const { counts, globalDscr: g, liquidity: liq, feeDependence: fees, credibility: cred } = summary
  notes.push(`${counts.total} project${counts.total === 1 ? '' : 's'}: ${counts.development} development, ${counts.lease_up} lease-up, ${counts.completed} completed${counts.noStage ? `, ${counts.noStage} with no stage chosen` : ''}.`)
  notes.push(g.ok ? `Global DSCR ${fmt.times(g.value)} across ${g.count} project${g.count === 1 ? '' : 's'}.` : `Global DSCR not available: ${g.reason}`)
  if (summary.firm.ok) {
    notes.push(liq.ok ? `Liquidity cover ${fmt.times(liq.value)}.` : `Liquidity cover not available: ${liq.reason}`)
    notes.push(fees.ok ? `Fee dependence ${fmt.pct(fees.value, 0)} in ${fees.year}.` : `Fee dependence not available: ${fees.reason}`)
  }
  notes.push(cred.ok ? `Credibility score ${cred.value} (${cred.band}) from ${cred.counted} comparisons.` : `Credibility score not available: ${cred.reason}`)
  return { flags, notes }
}

// The guard turns any crash into a visible "check failed" flag instead of a lost review.
export const run = guardModule(MODULE_ID, runChecks)
