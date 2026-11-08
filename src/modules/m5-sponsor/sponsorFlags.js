// M5-a review flags (layer 5). Turns the firm health score into flags a reviewer can act on.
//
// Follows the module interface (section 1d): run(project, context) -> { flags, notes }
//   project           the project being reviewed (it needs a stage, the same as every module)
//   context.firm      the firm record from M0 (required: without it the check cannot run)
//   context.projects  every project of the sponsor, for global coverage; the project under review is used if missing
//   context.settings  the lender's thresholds (section 1f); the defaults are used if missing
// M5 never calls another module.
//
// What raises a flag (decided with the team):
//   - a measure that scores Failing (below 35) raises a high flag, one that scores Weak (below 55) raises a medium flag
//   - the overall firm health score raises one more flag in the same way, so the reviewer sees the headline first
//   - a measure that cannot be worked out raises a low flag naming what is missing (never skipped silently)
// A project with no stage cannot be flagged (a flag always says which stage it ran under): the check says so and stops.

import { createFlagMaker, citeCells, flagFromUnavailable, missingDataFlag, guardModule, fmt } from '../shared/index.js'
import { firmHealth, labelFor } from './firmHealth.js'

export const MODULE_ID = 'M5'

const severityFor = (score) => (score < 35 ? 'high' : score < 55 ? 'medium' : null)

// What each measure's flag says. `ask` receives the measure and the stage the project was reviewed under.
const MEASURES = {
  liquidity: {
    id: 'M5-firm-liquidity',
    title: 'The sponsor firm has little cash against what it owes in the next year.',
    ask: (p, stage) =>
      `The firm holds ${fmt.usd(p.cash)} against ${fmt.usd(p.owing)} owed within a year. How will it pay these bills and fund its share of this project, and who is committed to cover a shortfall${stage === 'development' ? ' or cost overrun' : ''}?`,
  },
  globalDscr: {
    id: 'M5-firm-global-dscr',
    title: 'The sponsor’s income does not comfortably cover all of its loan payments.',
    ask: (p) => `Together, the firm and its projects cover all loan payments only ${fmt.times(p.value)}. What other income, reserve or guarantee supports the payments if a project falls short?`,
  },
  feeDependence: {
    id: 'M5-firm-fee-dependence',
    title: 'The sponsor’s income leans on one fee or is falling.',
    ask: () => 'The firm’s income is concentrated in one fee or has been falling (see the evidence). What new projects or recurring income will replace it, and is any of it committed?',
  },
  leverage: {
    id: 'M5-firm-leverage',
    title: 'The sponsor firm carries a lot of debt relative to its equity.',
    ask: (p) => `Firm debt is ${p.value === null || p.value === undefined ? 'above' : `${p.value.toFixed(2)}× `}its equity. What are the maturities and covenants on that debt, and has the firm given guarantees on other projects?`,
  },
}

// A measure's value in words, for the evidence.
function valueText(p) {
  if (p.text) return p.text
  if (p.id === 'feeDependence') return `developer fee is ${fmt.pct(p.value, 0)} of income`
  if (p.id === 'leverage') return `${p.value.toFixed(2)}× equity`
  return fmt.times(p.value)
}

const unique = (list) => [...new Set(list)]

export const runSponsorChecks = (project, context = {}) => {
  const stage = project?.data?.stage?.stage
  if (!stage) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: 'stage', checkTitle: 'The sponsor checks', missing: 'the stage chosen by the underwriter' })],
      notes: ['No stage chosen, so the sponsor checks did not run.'],
    }
  }
  const firm = context?.firm
  if (!firm?.data) {
    return {
      flags: [missingDataFlag({ module: MODULE_ID, stage_used: stage, check: 'firm', checkTitle: 'The sponsor firm health check', missing: 'the firm record (load the applicant workbook)' })],
      notes: ['No firm record was provided, so the sponsor checks did not run.'],
    }
  }

  const health = firmHealth(firm, context.projects?.length ? context.projects : [project], context.settings)
  const maker = createFlagMaker(MODULE_ID, project)
  const flags = []
  const notes = [`Stage used: ${stage}.`, ...health.notes]

  // Nothing could be worked out at all: one flag, not four.
  if (!health.ok) {
    flags.push(
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'firm',
        checkTitle: 'The sponsor firm health check',
        missing: health.parts.map((p) => p.reason),
      }),
    )
    return { flags, notes }
  }

  // Individual measures
  for (const part of health.parts) {
    if (!part.ok) {
      flags.push(flagFromUnavailable(part, { module: MODULE_ID, stage_used: stage, check: `firm-${part.id === 'globalDscr' ? 'global-dscr' : part.id === 'feeDependence' ? 'fee-dependence' : part.id}`, checkTitle: `The sponsor’s ${part.title.toLowerCase()}` }))
      continue
    }
    const severity = severityFor(part.score)
    if (!severity) continue
    const m = MEASURES[part.id]
    const band = labelFor(part.score).label
    flags.push(
      maker.flag({
        id: m.id,
        severity,
        title: m.title,
        evidence: `${part.title}: ${valueText(part)} (score ${Math.round(part.score)}/100, ${band}). ${part.detail.join('. ')}.`,
        cell_refs: citeCells(firm, part.paths ?? []).slice(0, 50),
        follow_up: m.ask(part, stage),
      }),
    )
  }

  // The headline
  const severity = severityFor(health.score)
  if (severity) {
    const failing = severity === 'high'
    const scored = health.parts.filter((p) => p.ok)
    flags.push(
      maker.flag({
        id: failing ? 'M5-firm-health-failing' : 'M5-firm-health-weak',
        severity,
        title: failing ? 'The sponsor firm’s finances show signs it could not cover its obligations.' : 'The sponsor firm’s finances are weak, with little room for a miss.',
        evidence: `Firm health ${health.score}/100 (${health.label}), from ${health.used} of ${health.total} measures: ${scored.map((p) => `${p.title.toLowerCase()} ${Math.round(p.score)}`).join(', ')}.`,
        cell_refs: unique(scored.flatMap((p) => citeCells(firm, p.paths ?? []))).slice(0, 50),
        follow_up: `The sponsor rates ${health.label} (${health.score}/100). What additional support (a co-sponsor, a guarantee or committed equity) is in place to ${stage === 'development' ? 'complete this project' : 'carry this project through a miss'}?`,
      }),
    )
  }

  return { flags, notes }
}

// The module as the review runs it: a crash here becomes one "check failed" flag instead of stopping the review.
export const run = guardModule(MODULE_ID, runSponsorChecks)
