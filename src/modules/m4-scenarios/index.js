// M4: the scenario engine (layer 4). Shared mechanics, stage-specific levers.
//
// Answers: "What happens to the debt if things go wrong?"
// Follows the module interface (section 1d): run(project, context) returns { flags, notes }.
//   context.settings   the lender's thresholds (section 1f); the defaults are used if it is missing
//   context.scenarios  optional lever settings, { downside: { rentChange: -0.15 }, ... }; the starting values are used otherwise
// M4 never calls another module. Its flags come from the downside and base cases only; the upside is shown on screen.

import { createFlagMaker, citeCells, flagFromUnavailable, sanitizeSettings, totalDevelopmentCost, fmt, guardModule } from '../shared/index.js'
import { runScenarios } from './engine.js'

export { runScenarios, applyLevers, evaluateCase } from './engine.js'
export { CASES, FILL_OCCUPANCY, DEFAULT_EXIT_CAP, leversForStage, resolveLevers } from './levers.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// What the three cases start from, as a phrase that follows "Starting from".
export function basisSentence(basis) {
  if (basis.kind === 'actuals') return `the T-12 actuals (the average of ${basis.months} month${basis.months === 1 ? '' : 's'}, times 12).`
  return basis.reason ? `the applicant's projection. ${basis.reason}` : "the applicant's projection."
}

// The levers that are turned in a case, in words ("rents -10%, expenses +10%").
const describeLever = (def, value) => {
  if (value === 0 && def.id !== 'exitCapRate') return null
  if (def.unit === 'months') return `${def.label.toLowerCase()} ${value} month${value === 1 ? '' : 's'}`
  const pct = `${value > 0 && def.id !== 'exitCapRate' ? '+' : ''}${(value * 100).toFixed(def.step < 0.01 ? 2 : 0)}%`
  return `${def.label.toLowerCase()} ${pct}`
}
const describeCase = (defs, values) => defs.map((d) => describeLever(d, values[d.id])).filter(Boolean).join(', ') || 'no changes'

// Cells that feed the scenario results, named the way the applicant's workbook names them.
function inputPaths(record, extra = [], loansOnly = false) {
  const d = record.data
  const paths = []
  const rows = (group, keys) => d[group].rows.forEach((row, i) => keys.forEach((k) => isNum(row[k]) && paths.push(`${group}.rows.${i}.${k}`)))
  rows('sources', ['amount', 'termMonths', 'interestRate', 'paymentOverride'])
  if (loansOnly) return [...paths, ...extra] // the income and expenses come from the T-12, not from these cells
  rows('residentialIncome', ['units', 'monthlyRent'])
  rows('commercialIncome', ['sqft', 'rentPerSqft'])
  rows('otherIncome', ['monthlyIncome'])
  for (const g of ['residentialIncome', 'commercialIncome']) if (isNum(d[g].stabilizedVacancy)) paths.push(`${g}.stabilizedVacancy`)
  for (const [key, line] of Object.entries(d.operatingExpenses.lines)) if (isNum(line.amount)) paths.push(`operatingExpenses.lines.${key}.amount`)
  rows('otherExpenses', ['amount'])
  paths.push(...extra)
  return paths
}

const budgetPaths = (record, keys) => keys.filter((k) => isNum(record.data.budget.lines[k]?.amount)).map((k) => `budget.lines.${k}.amount`)

export const runScenarioChecks = (project, context = {}) => {
  const settings = sanitizeSettings(context?.settings)
  const notes = []
  const result = runScenarios(project, { settings, levers: context?.scenarios, basis: context?.basis })

  // No stage: the check cannot run. A flag needs a stage, so development is named and the note says why.
  if (!result.ok) {
    notes.push('The project has no stage yet, so no scenarios were run.')
    return {
      flags: [flagFromUnavailable(result, { module: 'M4', stage_used: 'development', check: 'scenarios', checkTitle: 'The downside, base and upside scenarios' })],
      notes,
    }
  }

  const { stage, defs, levers, cases } = result
  const maker = createFlagMaker('M4', project)
  const flags = []
  const { basis } = result
  notes.push(`Stage used: ${stage}.`, `Starting from ${basisSentence(basis)}`, ...result.notes)
  if (basis.reference?.summary) notes.push(`For reference, the T-12 shows: ${basis.reference.summary}.`)
  if (basis.reference?.reason) notes.push(`The T-12 could not be used as a reference: ${basis.reference.reason}`)
  for (const c of ['downside', 'base', 'upside']) notes.push(`${c[0].toUpperCase()}${c.slice(1)}: ${describeCase(defs, levers[c])}.`)

  const unavailable = ['base', 'downside', 'upside'].map((c) => cases[c]).find((r) => !r.ok)
  if (unavailable) {
    flags.push(flagFromUnavailable(unavailable, { module: 'M4', stage_used: stage, check: 'scenarios', checkTitle: 'The downside, base and upside scenarios' }))
    return { flags, notes }
  }

  const { downside, base } = cases
  const t12Paths = basis.kind === 'actuals' ? basis.rowIndexes.flatMap((i) => [`t12.rows.${i}.residentialRevenue`, `t12.rows.${i}.vacancyLoss`]) : []
  const refs = citeCells(project, [...t12Paths, ...inputPaths(project, [], basis.kind === 'actuals')]).slice(0, 50)
  const from = basis.kind === 'actuals' ? ` Starting from the last ${basis.months} month${basis.months === 1 ? '' : 's'} of actuals (T-12).` : ''
  const min = settings.minDscr
  const against = `against the lender's minimum of ${fmt.times(min)}`
  const baseText = isNum(base.dscr) ? `base case ${fmt.times(base.dscr)}` : 'base case not available'

  if (isNum(base.dscr) && base.dscr < min) {
    flags.push(
      maker.flag({
        id: 'M4-base-dscr-below-minimum',
        severity: 'high',
        title: 'Even before any stress, the income does not cover the loan payments by the lender’s minimum.',
        evidence: `Base case DSCR ${fmt.times(base.dscr)} ${against}. NOI ${fmt.usd(base.noi)} on yearly loan payments of ${fmt.usd(base.debtService)}.${from}`,
        cell_refs: refs,
        follow_up: 'The numbers already miss the lender’s coverage test as entered. What changes (more equity, lower rent assumptions, a smaller loan) would bring it to the minimum?',
      }),
    )
  }

  if (isNum(downside.dscr)) {
    if (downside.dscr < 1) {
      flags.push(
        maker.flag({
          id: 'M4-downside-dscr-shortfall',
          severity: 'high',
          title: 'In the downside case, the income no longer covers the loan payments.',
          evidence: `Downside DSCR ${fmt.times(downside.dscr)} (${baseText}). Short by ${fmt.usd(downside.yearlyShortfall)} a year. Stress: ${describeCase(defs, levers.downside)}.${from}`,
          cell_refs: refs,
          follow_up: `In the downside case (${describeCase(defs, levers.downside)}), who covers the ${fmt.usd(downside.yearlyShortfall)} a year gap, and for how long can they?`,
        }),
      )
    } else if (downside.dscr < min && !(isNum(base.dscr) && base.dscr < min)) {
      flags.push(
        maker.flag({
          id: 'M4-downside-dscr-thin',
          severity: 'medium',
          title: 'In the downside case, coverage falls below the lender’s minimum.',
          evidence: `Downside DSCR ${fmt.times(downside.dscr)} ${against} (${baseText}). Stress: ${describeCase(defs, levers.downside)}.${from}`,
          cell_refs: refs,
          follow_up: 'Is there a cure if coverage dips under the lender’s minimum, such as a guarantee, a reserve or a cash sweep?',
        }),
      )
    }
  }

  const gap = downside.oneTime
  if (gap?.ok && gap.gap > 0) {
    const cost = stage === 'development' ? totalDevelopmentCost(project) : null
    const large = cost?.ok && gap.gap / cost.value > 0.05
    const parts = []
    if (gap.overrunUncovered > 0) parts.push(`overrun ${fmt.usd(gap.overrunCost)} against ${fmt.usd(gap.contingency)} of contingency`)
    if (gap.carryUncovered > 0) parts.push(`carrying costs ${fmt.usd(gap.carry)} against ${fmt.usd(gap.reserves)} of rent-up and operating reserves`)
    flags.push(
      maker.flag({
        id: 'M4-downside-funding-gap',
        severity: large ? 'high' : 'medium',
        title: 'In the downside case, the budget and reserves run out before the project is paid for.',
        evidence: `Funding gap ${fmt.usd(gap.gap)}: ${parts.join('; ')}. Stress: ${describeCase(defs, levers.downside)}.`,
        cell_refs: citeCells(project, budgetPaths(project, ['constructionContingency', 'ownersContingency', 'rentUpReserve', 'operatingReserve', 'land'])),
        follow_up: `In the downside case (${describeCase(defs, levers.downside)}), where would the extra ${fmt.usd(gap.gap)} come from, and who is committed to provide it?`,
      }),
    )
  }

  return { flags, notes }
}

// The module as the review runs it: a crash here becomes one "check failed" flag instead of stopping the review.
export const run = guardModule('M4', runScenarioChecks)
