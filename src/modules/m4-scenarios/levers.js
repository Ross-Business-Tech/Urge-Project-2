// The levers of the scenario engine (M4, layer 4): the things the underwriter can turn to stress a project.
//
// A lever is one "what if": rents fall 10%, the takeout loan costs 1.5 points more, construction runs 6 months late.
// Each case (downside, base, upside) has its own setting for every lever. The stage decides which levers are offered
// (section 2, M4 of the module spec). Percentages are decimals, like everywhere else (10% is 0.1).

export const CASES = [
  { id: 'downside', label: 'Downside', plain: 'Things go wrong' },
  { id: 'base', label: 'Base', plain: 'The project as the applicant entered it' },
  { id: 'upside', label: 'Upside', plain: 'Things go better than planned' },
]

// While a building fills up, it earns about this share of its stabilized income. It is used to cost the extra months of
// lease-up. A made-up round number, shown to the reviewer wherever it matters.
export const FILL_OCCUPANCY = 0.5

// The exit cap rate has no field in the applicant workbook, so the base case needs a starting point. This one is a
// made-up placeholder: the reviewer should change it to the market's.
export const DEFAULT_EXIT_CAP = 0.065

// Every lever the engine knows. `values` are the starting settings for each case. `stages` says where it is offered.
// `labels` and `plain` can differ by stage where the same mechanism has a different name.
const LEVER_LIST = [
  {
    id: 'costOverrun',
    label: 'Construction cost overrun',
    plain: 'Hard costs end up this much higher than budgeted. The contingency absorbs it first; anything beyond that is a funding gap.',
    unit: 'percent',
    min: 0,
    max: 0.5,
    step: 0.01,
    values: { downside: 0.1, base: 0, upside: 0 },
    stages: ['development'],
  },
  {
    id: 'delayMonths',
    label: 'Construction delay',
    plain: 'The building is finished this many months late. Nothing is earning, so the loan payments are paid out of reserves.',
    unit: 'months',
    min: 0,
    max: 24,
    step: 1,
    values: { downside: 6, base: 0, upside: 0 },
    stages: ['development'],
    stageOverrides: {
      lease_up: {
        label: 'Delay to stabilization',
        plain: 'The property takes this many extra months to reach stability. While it fills, loan payments and costs are paid from reserves.',
        values: { downside: 6, base: 0, upside: 0 },
      },
    },
  },
  {
    id: 'absorptionMonths',
    label: 'Slower absorption',
    plain: `Lease-up takes this many months longer than planned. A filling building earns only about ${FILL_OCCUPANCY * 100}% of its stabilized income.`,
    unit: 'months',
    min: 0,
    max: 24,
    step: 1,
    values: { downside: 6, base: 0, upside: 0 },
    stages: ['development'],
  },
  {
    id: 'rentChange',
    label: 'Rent change',
    plain: 'Every rent, residential and commercial, moves by this much. A negative number is a haircut.',
    unit: 'percent',
    min: -0.3,
    max: 0.15,
    step: 0.01,
    values: { downside: -0.1, base: 0, upside: 0.05 },
    stages: ['development', 'lease_up', 'completed'],
  },
  {
    id: 'vacancyChange',
    label: 'Extra vacancy',
    plain: 'Vacancy goes up (or down) by this many percentage points, on top of what the applicant assumed.',
    unit: 'percent',
    min: -0.05,
    max: 0.3,
    step: 0.01,
    values: { downside: 0.05, base: 0, upside: -0.02 },
    stages: ['lease_up', 'completed'],
  },
  {
    id: 'expenseGrowth',
    label: 'Expense growth',
    plain: 'Operating expenses end up this much higher (or lower) than the applicant assumed.',
    unit: 'percent',
    min: -0.1,
    max: 0.4,
    step: 0.01,
    values: { downside: 0.1, base: 0, upside: -0.03 },
    stages: ['lease_up', 'completed'],
  },
  {
    id: 'takeoutRate',
    label: 'Worse takeout rate',
    plain: 'The permanent loan costs this many percentage points more than the rate typed in.',
    unit: 'percent',
    min: -0.02,
    max: 0.04,
    step: 0.0025,
    values: { downside: 0.015, base: 0, upside: -0.005 },
    stages: ['development', 'lease_up'],
    stageOverrides: {
      completed: {
        label: 'Refinance rate',
        plain: 'When the loan is refinanced, the new rate is this many percentage points higher than the rate typed in.',
        values: { downside: 0.015, base: 0, upside: -0.005 },
      },
    },
  },
  {
    id: 'exitCapRate',
    label: 'Exit cap rate',
    plain: 'The cap rate a buyer or lender uses to value the property at takeout. A higher rate means a lower value. The starting point is a made-up placeholder: change it to the market rate.',
    unit: 'percent',
    min: 0.04,
    max: 0.1,
    step: 0.0025,
    values: { downside: 0.075, base: DEFAULT_EXIT_CAP, upside: 0.06 },
    stages: ['development'],
  },
]

// The levers offered for a stage, in display order, with the stage's own wording.
export function leversForStage(stage) {
  return LEVER_LIST.filter((l) => l.stages.includes(stage) || l.stageOverrides?.[stage]).map((l) => {
    const over = l.stageOverrides?.[stage] ?? {}
    const { stages: _stages, stageOverrides: _overrides, ...rest } = l
    return { ...rest, ...over }
  })
}

// Settings for one case, from what the reviewer asked for. Anything that is missing, not a number or outside the lever's
// range falls back to the starting value, and the reasons are returned so the screen can say so.
export function resolveLevers(stage, requested) {
  const defs = leversForStage(stage)
  const cases = {}
  const problems = []
  for (const c of CASES) {
    cases[c.id] = {}
    for (const lever of defs) {
      const given = requested?.[c.id]?.[lever.id]
      const start = lever.values[c.id]
      if (given === undefined || given === null) {
        cases[c.id][lever.id] = start
      } else if (typeof given === 'number' && Number.isFinite(given) && given >= lever.min && given <= lever.max) {
        cases[c.id][lever.id] = given
      } else {
        cases[c.id][lever.id] = start
        problems.push(`${c.label} case: "${lever.label}" must be a number from ${lever.min} to ${lever.max}, so the starting value was used.`)
      }
    }
  }
  return { defs, cases, problems }
}
