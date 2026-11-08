// M3D: Development risk (layer 3). "What can go wrong while this project is being built and filled?"
//
// Ten checks in four groups (budget, schedule, capital stack and takeout, team). Every check reads the project record and the
// shared calculators, benchmarks and settings from M0. Nothing here changes a record or works out the stage.
//
// Each check returns one checklist row:
//   { id, title, group, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, cells, flags }
// `run(project, context)` (index.js) collects the flags; the screen shows every row, so a check that could not run is
// visible instead of silently skipped.
//
// Development projects run every check. A lease-up project runs only the parts that are still projected: the rest of the
// schedule, the reserves and loans that must carry it to stabilization, and the team. The budget checks are skipped because
// the workbook holds the original budget, not what is left to spend.
//
// Rules of thumb that are NOT in the shared benchmark sets are listed in THRESHOLDS below. They are working assumptions for
// a first screen, not market data, and every flag that uses one says so.

import {
  projectSchema,
  keyRatios,
  totalDevelopmentCost,
  noi,
  dscr,
  annualDebtService,
  applyStageAndDate,
  ratioIdsForStage,
  loadBenchmarks,
  contingencyBenchmark,
  costBenchmark,
  missingDataFlag,
  flagFromUnavailable,
  citeCells,
  createFlagMaker,
  fmt,
  DEBT_SOURCE_TYPES,
  SOURCE_TYPES,
} from '../shared/index.js'

export const MODULE_ID = 'M3D'

export const THRESHOLDS = {
  softToHard: { low: 0.1, high: 0.4 }, // soft costs as a share of hard costs
  sponsorFeeShare: 0.15, // developer and related-party fees as a share of total cost
  debtToCost: { watch: 0.8, high: 0.9 },
  debtYieldMin: 0.08,
  constructionMonths: { min: 6, max: 36 },
  leaseUpMonths: { min: 3, max: 36 },
  averageDrawn: 0.5, // on average half of a construction loan is drawn while it is being built
  costHighFactor: 1.25, // cost this far above the top of the range is a high flag
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const amount = (v) => (isNum(v) && v >= 0 ? v : 0)
const usd = (n) => fmt.usd(n)
const share = (n) => `${Number((n * 100).toFixed(1))}%`
const range = (r, f) => `${f(r.low)} to ${f(r.high)}`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const keysWhere = (test) => BUDGET_ROWS.filter((r) => test(r.section)).map((r) => r.key)
const HARD = keysWhere((s) => s.startsWith('Hard costs'))
const SOFT = keysWhere((s) => s.startsWith('Soft costs'))
const FEES = keysWhere((s) => s === 'Soft costs: developer and consulting fees')
const budgetSum = (record, keys) => keys.reduce((t, k) => t + amount(record.data.budget.lines[k]?.amount), 0)
const linePaths = (keys) => keys.map((k) => `budget.lines.${k}.amount`)
const enteredPaths = (record, keys) => linePaths(keys).filter((p) => isNum(record.data.budget.lines[p.split('.')[2]]?.amount))
const typeLabel = (value) => SOURCE_TYPES.find((t) => t.value === value)?.label ?? 'no type'
const sourceName = (row, i) => row.name || `source ${i + 1}`

// ---------------------------------------------------------------------------------------------
// Dates. The workbook asks for years; a month may be added. A bare year counts as January and is treated as approximate.
// ---------------------------------------------------------------------------------------------

export function parseMonth(value) {
  if (isNum(value) && Number.isInteger(value) && value >= 1900 && value <= 2200) return { idx: value * 12, yearOnly: true, text: String(value) }
  if (typeof value !== 'string') return null
  const t = value.trim()
  let m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(t)
  if (m) return { idx: Number(m[1]) * 12 + Number(m[2]) - 1, yearOnly: false, text: t.slice(0, 7) }
  m = /^(\d{4})$/.exec(t)
  if (m) return { idx: Number(m[1]) * 12, yearOnly: true, text: t }
  return null
}

// ---------------------------------------------------------------------------------------------
// Building rows and flags
// ---------------------------------------------------------------------------------------------

const row = (id, title, group, status, detail, { cells = [], flags = [] } = {}) => ({ id, title, group, status, detail, cells, flags })

function notChecked(ctx, id, title, group, missing, cells = []) {
  const flag = missingDataFlag({ module: MODULE_ID, stage_used: 'development', check: id, checkTitle: title, missing, cell_refs: cells })
  return row(id, title, group, 'not_checked', Array.isArray(missing) ? missing.join(' ') : missing, { cells, flags: [flag] })
}

function unavailable(ctx, id, title, group, result, cells = []) {
  const flag = flagFromUnavailable(result, { module: MODULE_ID, stage_used: 'development', check: id, checkTitle: title })
  return row(id, title, group, 'not_checked', result.reason, { cells, flags: [flag] })
}

const notApplicable = (id, title, group, why) => row(id, title, group, 'not_applicable', why)

// Every flag from M3D ran under the development rules, even for a lease-up project's still-projected parts.
const raise = (ctx, fields) => ctx.flag({ ...fields, stage_used: 'development' })

// ---------------------------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------------------------

function timeline(record) {
  const t = record.data.timeline
  return {
    start: parseMonth(t.constructionStart),
    completion: parseMonth(t.constructionCompletion),
    stabilization: parseMonth(t.stabilization),
    paths: ['timeline.constructionStart', 'timeline.constructionCompletion', 'timeline.stabilization'],
  }
}

const debtRows = (record) =>
  record.data.sources.rows
    .map((r, i) => ({ r, i, name: sourceName(r, i) }))
    .filter(({ r }) => DEBT_SOURCE_TYPES.includes(r.type) && isNum(r.amount) && r.amount > 0)

const totalUnits = (record) => record.data.residentialIncome.rows.reduce((t, r) => t + amount(r.units), 0)
const rentableSqft = (record) =>
  record.data.residentialIncome.rows.reduce((t, r) => (isNum(r.units) && isNum(r.sqft) ? t + r.units * r.sqft : t), 0) +
  record.data.commercialIncome.rows.reduce((t, r) => t + amount(r.sqft), 0)

// Months from the "as of" date to the stabilization date (lease-up projects). Never negative.
function monthsRemaining(ctx, stabilization) {
  const asOf = parseMonth(ctx.record.data.stage.asOfDate)
  if (!asOf || !stabilization) return null
  return Math.max(0, stabilization.idx - asOf.idx)
}

// =============================================================================================
// 1. BUDGET
// =============================================================================================

function contingency(ctx) {
  const { record } = ctx
  const [id, title, group] = ['contingency', 'Contingency is big enough', 'Budget']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'The workbook holds the original budget, not what is left to spend, so contingency is not judged for a project already delivering.')
  const r = ctx.ratios.contingency
  const cells = citeCells(record, enteredPaths(record, ['constructionContingency', 'ownersContingency']))
  if (!r.ok) return unavailable(ctx, id, title, group, r, cells)
  if (!ctx.bench.ok) return notChecked(ctx, id, title, group, ctx.bench.reason, cells)
  const b = contingencyBenchmark(ctx.bench.set)
  if (!b.ok) return notApplicable(id, title, group, b.reason)
  const detail = `Contingency is ${share(r.value)} of hard cost; the benchmark is ${range(b.range, share)}.`
  // Only a contingency BELOW the range is a risk. A generous one is not flagged.
  if (r.value >= b.range.low) return row(id, title, group, 'pass', `${detail} ${r.value > b.range.high ? 'That is above the range, which is not a concern.' : 'Within the range.'}`, { cells })
  const severity = r.value < b.range.low / 2 ? 'high' : 'medium'
  const f = raise(ctx, {
    id: 'M3D-contingency-low',
    severity,
    title: `The construction contingency of ${share(r.value)} is below the usual range, so a cost overrun may not be covered.`,
    evidence: `Contingency ${share(r.value)} of hard cost vs. ${range(b.range, share)} benchmark (median ${share(b.range.median)}). ${(r.detail ?? [])[0] ?? ''}`.trim(),
    cell_refs: cells,
    follow_up: `What is the basis for a ${share(r.value)} contingency, and who pays if hard costs run over?`,
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

function costPerSqft(ctx) {
  const { record } = ctx
  const [id, title, group] = ['cost-per-sqft', 'Cost per square foot is in line with comparable projects', 'Budget']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'The workbook holds the original budget, not the cost still to come, so cost per square foot is not compared for a project already delivering.')
  const total = totalDevelopmentCost(record)
  const sqft = rentableSqft(record)
  const cells = citeCells(record, [...enteredPaths(record, [...HARD, ...SOFT]).slice(0, 6)])
  if (!total.ok) return unavailable(ctx, id, title, group, total, cells)
  if (sqft <= 0) return notChecked(ctx, id, title, group, ['square feet per unit and units (or commercial square feet)'], citeCells(record, ['residentialIncome.rows.0.sqft']))
  if (!ctx.bench.ok) return notChecked(ctx, id, title, group, ctx.bench.reason, cells)

  const metrics = [
    ['Hard cost', 'hard', budgetSum(record, HARD) / sqft],
    ['Soft cost', 'soft', budgetSum(record, SOFT) / sqft],
    ['Total cost', 'total', total.value / sqft],
  ]
  const above = []
  const below = []
  const lines = []
  let worstAbove = 1
  for (const [label, key, value] of metrics) {
    const b = costBenchmark(ctx.bench.set, key)
    if (!b.ok) return notApplicable(id, title, group, b.reason)
    lines.push(`${label.toLowerCase()} ${usd(value)}/sq ft vs. ${range(b.range, usd)}`)
    if (value > b.range.high) {
      above.push(`${label.toLowerCase()} ${usd(value)} per sq ft vs. ${range(b.range, usd)}`)
      worstAbove = Math.max(worstAbove, value / b.range.high)
    } else if (value < b.range.low) below.push(`${label.toLowerCase()} ${usd(value)} per sq ft vs. ${range(b.range, usd)}`)
  }
  const detail = `${lines.join('; ')} (on ${sqft.toLocaleString('en-US')} rentable sq ft).`
  const basis = `Measured on ${sqft.toLocaleString('en-US')} sq ft of rentable area from the unit mix and leases, which is smaller than gross building area.`
  const flags = []
  if (above.length) {
    flags.push(
      raise(ctx, {
        id: 'M3D-cost-per-sqft-high',
        severity: worstAbove > THRESHOLDS.costHighFactor ? 'high' : 'medium',
        title: 'The project costs more per square foot than comparable projects.',
        evidence: `${above.join('; ')}. ${basis}`,
        cell_refs: cells,
        follow_up: 'What drives the cost above comparable projects, and is the yield still enough at this cost?',
      }),
    )
  }
  if (below.length) {
    flags.push(
      raise(ctx, {
        id: 'M3D-cost-per-sqft-low',
        severity: 'low',
        title: 'The project costs less per square foot than comparable projects, so something may be missing from the budget.',
        evidence: `${below.join('; ')}. ${basis}`,
        cell_refs: cells,
        follow_up: 'What explains a cost below comparable projects, and is anything missing from the budget?',
      }),
    )
  }
  return row(id, title, group, flags.length ? 'fail' : 'pass', flags.length ? detail : `${detail} Within the benchmark ranges.`, { cells, flags })
}

function softToHard(ctx) {
  const { record } = ctx
  const [id, title, group] = ['soft-to-hard', 'Hard and soft costs are in a believable balance', 'Budget']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'The workbook holds the original budget, so the balance of hard and soft costs is not judged for a project already delivering.')
  const hard = budgetSum(record, HARD)
  const soft = budgetSum(record, SOFT)
  const cells = citeCells(record, enteredPaths(record, [...HARD, ...SOFT]).slice(0, 6))
  if (hard <= 0) return notChecked(ctx, id, title, group, ['hard costs in the development budget'], cells)
  const ratio = soft / hard
  const { low, high } = THRESHOLDS.softToHard
  const detail = `Soft costs are ${share(ratio)} of hard costs (${usd(soft)} on ${usd(hard)}). A working range is ${share(low)} to ${share(high)}.`
  if (ratio >= low && ratio <= high) return row(id, title, group, 'pass', detail, { cells })
  const heavy = ratio > high
  const f = raise(ctx, {
    id: heavy ? 'M3D-soft-cost-heavy' : 'M3D-soft-cost-thin',
    severity: heavy ? 'medium' : 'low',
    title: heavy ? 'Soft costs are a large share of what is being built, which can hide fees or financing cost.' : 'Soft costs are very small next to hard costs, so some may be missing.',
    evidence: `Soft costs ${usd(soft)} are ${share(ratio)} of hard costs ${usd(hard)}, vs. a ${share(low)} to ${share(high)} working range (an assumption, not market data).`,
    cell_refs: cells,
    follow_up: heavy ? 'What is in the soft costs, and how much of it is paid to the sponsor or related parties?' : 'Are architecture, legal, financing and reserve costs fully budgeted?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

const DEFER_NAME = /defer/i
function sponsorFees(ctx) {
  const { record } = ctx
  const [id, title, group] = ['sponsor-fees', 'Fees paid to the sponsor are reasonable, and how much is deferred', 'Budget']
  if (ctx.used === 'lease_up') return notApplicable(id, title, group, 'The workbook holds the original budget, so fees are not judged for a project already delivering.')
  const total = totalDevelopmentCost(record)
  const cells = citeCells(record, enteredPaths(record, FEES))
  if (!total.ok) return unavailable(ctx, id, title, group, total, cells)
  const fees = budgetSum(record, FEES)
  const deferredRows = record.data.sources.rows.map((r, i) => ({ r, i })).filter(({ r }) => isNum(r.amount) && r.amount > 0 && (r.type === 'other' || DEFER_NAME.test(r.name ?? '')))
  const deferred = deferredRows.reduce((t, { r }) => t + r.amount, 0)
  const deferredCells = citeCells(record, deferredRows.map(({ i }) => `sources.rows.${i}.amount`))
  const feeShare = fees / total.value
  const flags = []
  let detail = fees > 0 ? `Developer and related-party fees are ${usd(fees)}, ${share(feeShare)} of total cost.` : 'No developer or related-party fee is entered in the budget.'
  if (deferred > 0) detail += ` ${usd(deferred)} of the sources is typed as Other or named as deferred.`
  if (feeShare > THRESHOLDS.sponsorFeeShare) {
    flags.push(
      raise(ctx, {
        id: 'M3D-sponsor-fees-high',
        severity: 'medium',
        title: 'A large share of the project cost is paid to the sponsor and related parties as fees.',
        evidence: `Fees ${usd(fees)} are ${share(feeShare)} of total cost ${usd(total.value)}, above the ${share(THRESHOLDS.sponsorFeeShare)} working limit (an assumption, not market data).${deferred > 0 ? ` ${usd(deferred)} is deferred.` : ''}`,
        cell_refs: [...cells, ...deferredCells],
        follow_up: 'What fees go to the sponsor and related parties, when are they paid, and how much is deferred until after the loan is repaid?',
      }),
    )
  }
  if (fees > 0 && deferred > fees) {
    flags.push(
      raise(ctx, {
        id: 'M3D-deferred-exceeds-fees',
        severity: 'low',
        title: 'More money is shown as deferred than the fees in the budget, so some may be counted as equity by mistake.',
        evidence: `Deferred or "Other" sources ${usd(deferred)} vs. ${usd(fees)} of developer and related-party fees in the budget.`,
        cell_refs: [...cells, ...deferredCells],
        follow_up: 'What exactly is deferred, and does it rank behind the loan?',
      }),
    )
  }
  return row(id, title, group, flags.length ? 'fail' : 'pass', detail, { cells: [...cells, ...deferredCells], flags })
}

// =============================================================================================
// 2. SCHEDULE
// =============================================================================================

function schedule(ctx) {
  const { record } = ctx
  const [id, title, group] = ['schedule', 'Start, completion and stabilization dates agree with each other', 'Schedule']
  const t = timeline(record)
  const needed = ctx.used === 'development' ? [['start', 'construction start'], ['completion', 'construction completion'], ['stabilization', 'stabilization']] : [['completion', 'construction completion'], ['stabilization', 'stabilization']]
  const cells = citeCells(record, t.paths)
  const missing = needed.filter(([k]) => !t[k]).map(([, label]) => label)
  if (missing.length) return notChecked(ctx, id, title, group, [`the ${missing.join(', ')} date`], cells)

  const flags = []
  const out = (a, b) => b.idx < a.idx || (!a.yearOnly && !b.yearOnly && b.idx === a.idx)
  const facts = []
  if (ctx.used === 'development') facts.push(`construction ${t.start.text} to ${t.completion.text}`)
  facts.push(`completion ${t.completion.text}, stabilization ${t.stabilization.text}`)
  const detail = `${facts.join('; ')}.`

  const wrong = []
  if (ctx.used === 'development' && out(t.start, t.completion)) wrong.push(`construction completes (${t.completion.text}) no later than it starts (${t.start.text})`)
  if (out(t.completion, t.stabilization)) wrong.push(`stabilization (${t.stabilization.text}) is no later than completion (${t.completion.text})`)
  if (wrong.length) {
    flags.push(
      raise(ctx, {
        id: 'M3D-schedule-inconsistent',
        severity: 'high',
        title: 'The construction and stabilization dates do not run in a sensible order.',
        evidence: `${wrong.join('; ')}.`,
        cell_refs: cells,
        follow_up: 'Please confirm the construction start, completion and stabilization dates.',
      }),
    )
    return row(id, title, group, 'fail', `${detail} ${wrong.join('; ')}.`, { cells, flags })
  }

  const notes = []
  if (ctx.used === 'development') {
    if (t.start.yearOnly || t.completion.yearOnly) notes.push('Construction length not judged: a date is a year only.')
    else {
      const months = t.completion.idx - t.start.idx
      const { min, max } = THRESHOLDS.constructionMonths
      notes.push(`Construction ${plural(months, 'month')}.`)
      if (months < min || months > max) {
        flags.push(
          raise(ctx, {
            id: 'M3D-construction-length',
            severity: 'medium',
            title: months < min ? 'The construction schedule is shorter than is realistic.' : 'The construction schedule is unusually long.',
            evidence: `Construction runs ${plural(months, 'month')} (${t.start.text} to ${t.completion.text}) vs. a ${min} to ${max} month working range (an assumption, not market data).`,
            cell_refs: cells,
            follow_up: months < min ? 'What supports completing construction this quickly?' : 'Why does construction take this long, and how does it affect the interest reserve?',
          }),
        )
      }
    }
  }
  if (t.completion.yearOnly || t.stabilization.yearOnly) notes.push('Lease-up length not judged: a date is a year only.')
  else {
    const months = t.stabilization.idx - t.completion.idx
    const { min, max } = THRESHOLDS.leaseUpMonths
    notes.push(`Lease-up ${plural(months, 'month')}${isNum(totalUnits(record)) && totalUnits(record) > 0 && months > 0 ? ` (about ${Number((totalUnits(record) / months).toFixed(1))} units a month)` : ''}.`)
    if (months < min || months > max) {
      flags.push(
        raise(ctx, {
          id: 'M3D-leaseup-length',
          severity: 'medium',
          title: months < min ? 'The lease-up period is shorter than is realistic.' : 'The lease-up period is unusually long.',
          evidence: `Lease-up runs ${plural(months, 'month')} (${t.completion.text} to ${t.stabilization.text}) vs. a ${min} to ${max} month working range (an assumption, not market data).`,
          cell_refs: cells,
          follow_up: months < min ? 'What supports filling the building this quickly?' : 'Why does lease-up take this long, and do the reserves last?',
        }),
      )
    }
  }
  return row(id, title, group, flags.length ? 'fail' : 'pass', `${detail} ${notes.join(' ')}`.trim(), { cells, flags })
}

// =============================================================================================
// 3. CAPITAL STACK AND TAKEOUT
// =============================================================================================

function debtCoverage(ctx) {
  const { record, settings } = ctx
  const [id, title, group] = ['dscr', 'Income covers the loan payments', 'Capital stack and takeout']
  const d = dscr(record)
  const cells = citeCells(record, debtRows(record).flatMap(({ i }) => [`sources.rows.${i}.amount`, `sources.rows.${i}.interestRate`]))
  if (!d.ok) return unavailable(ctx, id, title, group, d, cells)
  const n = noi(record)
  const ds = annualDebtService(record)
  const announced = (ds.notes ?? []).join(' ')
  const detail = `DSCR is ${fmt.times(d.value)} against the lender's minimum of ${fmt.times(settings.minDscr)} (stabilized NOI ${usd(n.value)}, loan payments ${usd(ds.value)} a year).`
  if (d.value >= settings.minDscr) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3D-dscr-under-minimum',
    severity: 'high',
    title: `Income at stabilization covers the loan payments ${fmt.times(d.value)}, below the lender's minimum.`,
    evidence: `DSCR ${fmt.times(d.value)} vs. ${fmt.times(settings.minDscr)} minimum. Stabilized NOI ${usd(n.value)} on yearly loan payments of ${usd(ds.value)}.${announced ? ` ${announced}` : ''}`,
    cell_refs: cells,
    follow_up: `How will the loan be repaid if DSCR stays at ${fmt.times(d.value)}? Can the loan be resized or income raised?`,
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

// How much carrying cost the reserves have to absorb before the building can pay for itself.
function interestReserve(ctx) {
  const { record } = ctx
  const [id, title, group] = ['interest-reserve', 'Reserves cover loan interest until the project stabilizes', 'Capital stack and takeout']
  const lines = ctx.used === 'development' ? ['constructionInterest', 'rentUpReserve', 'operatingReserve'] : ['rentUpReserve', 'operatingReserve']
  const cells = citeCells(record, linePaths(lines))
  const t = timeline(record)
  const ds = annualDebtService(record)
  if (!ds.ok) return unavailable(ctx, id, title, group, ds, cells)

  let constructionInterest = 0
  let leaseMonths
  const parts = []
  if (ctx.used === 'development') {
    if (!t.start || !t.completion || !t.stabilization) return notChecked(ctx, id, title, group, ['the construction start, completion and stabilization dates'], citeCells(record, t.paths))
    const buildMonths = Math.max(0, t.completion.idx - t.start.idx)
    leaseMonths = Math.max(0, t.stabilization.idx - t.completion.idx)
    for (const { r } of debtRows(record)) {
      if (isNum(r.interestRate) && r.interestRate >= 0 && r.interestRate <= 1) constructionInterest += r.amount * r.interestRate * THRESHOLDS.averageDrawn * (buildMonths / 12)
    }
    parts.push(`interest while building about ${usd(constructionInterest)} (loans about half drawn on average for ${plural(buildMonths, 'month')})`)
  } else {
    leaseMonths = monthsRemaining(ctx, t.stabilization)
    if (leaseMonths === null) return notChecked(ctx, id, title, group, ['the stabilization date and the "as of" date'], citeCells(record, t.paths))
  }
  const carry = (ds.value * leaseMonths) / 12
  parts.push(`loan payments during ${plural(leaseMonths, 'month')} of lease-up about ${usd(carry)} (assuming no income, the cautious case)`)
  const required = constructionInterest + carry
  const funded = lines.reduce((total, k) => total + amount(record.data.budget.lines[k]?.amount), 0)
  if (required <= 0) return row(id, title, group, 'pass', 'There is no interest or loan payment to carry before stabilization.', { cells })
  const coverage = funded / required
  const detail = `Reserves of ${usd(funded)} against about ${usd(required)} to carry (${parts.join(' plus ')}). ${share(coverage)} covered.`
  if (coverage >= 1) return row(id, title, group, 'pass', detail, { cells })
  const f = raise(ctx, {
    id: 'M3D-interest-reserve-short',
    severity: coverage < 0.5 ? 'high' : 'medium',
    title: 'The interest and rent-up reserves may run out before the project can pay its own way.',
    evidence: `Reserves ${usd(funded)} (${lines.map((k) => BUDGET_ROWS.find((r) => r.key === k).label.toLowerCase()).join(', ')}) vs. about ${usd(required)} needed: ${parts.join('; ')}. ${share(coverage)} covered. A simple estimate, not a draw schedule.`,
    cell_refs: cells,
    follow_up: 'Please share the draw schedule and interest carry. Who funds the gap if the reserves run out?',
  })
  return row(id, title, group, 'fail', detail, { cells, flags: [f] })
}

function takeout(ctx) {
  const { record } = ctx
  const [id, title, group] = ['takeout', 'The loans can be repaid or refinanced when the project stabilizes', 'Capital stack and takeout']
  const loans = debtRows(record)
  const cells = citeCells(record, loans.flatMap(({ i }) => [`sources.rows.${i}.amount`, `sources.rows.${i}.termMonths`]))
  if (loans.length === 0) return notChecked(ctx, id, title, group, ['a loan in the sources of money'], citeCells(record, ['sources.rows.0.type']))
  const t = timeline(record)
  const flags = []
  const facts = []

  // 1. A loan that matures before the project is expected to stabilize.
  const horizon = ctx.used === 'development' ? (t.start && t.stabilization ? t.stabilization.idx - t.start.idx : null) : monthsRemaining(ctx, t.stabilization)
  if (horizon !== null) {
    const early = loans.filter(({ r }) => isNum(r.termMonths) && r.termMonths > 0 && r.termMonths < horizon)
    facts.push(`Stabilization is ${plural(horizon, 'month')} ${ctx.used === 'development' ? 'after construction starts' : 'from the "as of" date'}.`)
    if (early.length) {
      flags.push(
        raise(ctx, {
          id: 'M3D-loan-matures-early',
          severity: 'high',
          title: 'A loan comes due before the project is expected to stabilize.',
          evidence: `${early.map(({ r, name }) => `"${name}" term ${plural(r.termMonths, 'month')}`).join('; ')} vs. ${plural(horizon, 'month')} to stabilization. The loan must be extended or refinanced before income is proven.`,
          cell_refs: citeCells(record, [...early.map(({ i }) => `sources.rows.${i}.termMonths`), ...t.paths]),
          follow_up: 'What happens if stabilization slips past the loan maturity? Are there extension options, and on what terms?',
        }),
      )
    }
  } else facts.push('Loan maturity vs. stabilization not checked: a date is missing.')

  // 2. How much of the cost is borrowed (development only: a delivered project has no cost to compare with).
  const dtc = ctx.ratios.debtToCost
  if (ctx.used === 'development' && dtc.ok) {
    facts.push(`Debt is ${share(dtc.value)} of cost.`)
    if (dtc.value > THRESHOLDS.debtToCost.watch) {
      flags.push(
        raise(ctx, {
          id: 'M3D-debt-to-cost-high',
          severity: dtc.value > THRESHOLDS.debtToCost.high ? 'high' : 'medium',
          title: `Debt pays for ${share(dtc.value)} of the project, leaving little sponsor money at risk.`,
          evidence: `Debt-to-cost ${share(dtc.value)} vs. a ${share(THRESHOLDS.debtToCost.watch)} working limit (an assumption, not market data). ${(dtc.detail ?? [])[0] ?? ''}`.trim(),
          cell_refs: cells,
          follow_up: 'How much of their own money is the sponsor putting in, and is any of it borrowed or deferred?',
        }),
      )
    }
  }

  // 3. Whether income is large enough, against the debt, for a lender to refinance it.
  const dy = ctx.ratios.debtYield
  if (dy.ok) {
    facts.push(`Debt yield is ${share(dy.value)}.`)
    if (dy.value < THRESHOLDS.debtYieldMin) {
      flags.push(
        raise(ctx, {
          id: 'M3D-debt-yield-low',
          severity: 'medium',
          title: 'Income is small compared with the debt, so a lender may not refinance it.',
          evidence: `Debt yield ${share(dy.value)} vs. a ${share(THRESHOLDS.debtYieldMin)} working minimum (an assumption, not market data). ${(dy.detail ?? [])[0] ?? ''}`.trim(),
          cell_refs: cells,
          follow_up: 'What debt yield does the permanent lender require, and does this project meet it?',
        }),
      )
    }
  } else facts.push(`Debt yield not available: ${dy.reason}`)

  return row(id, title, group, flags.length ? 'fail' : 'pass', facts.join(' '), { cells, flags })
}

function lienPriority(ctx) {
  const { record } = ctx
  const [id, title, group] = ['lien-priority', 'The order of the loans is clear', 'Capital stack and takeout']
  const loans = debtRows(record)
  const cells = citeCells(record, loans.map(({ i }) => `sources.rows.${i}.lienPriority`))
  if (loans.length === 0) return notChecked(ctx, id, title, group, ['a loan in the sources of money'], citeCells(record, ['sources.rows.0.type']))
  if (loans.length === 1) return row(id, title, group, 'pass', `One loan ("${loans[0].name}"), so there is no ranking to question.`, { cells })

  const unranked = loans.filter(({ r }) => !isNum(r.lienPriority))
  const counts = new Map()
  for (const { r } of loans) if (isNum(r.lienPriority)) counts.set(r.lienPriority, (counts.get(r.lienPriority) ?? 0) + 1)
  const tied = [...counts].filter(([, n]) => n > 1).map(([p]) => p)
  const problems = []
  if (unranked.length) problems.push(`no lien priority for ${unranked.map(({ name }) => `"${name}"`).join(', ')}`)
  if (tied.length) problems.push(`more than one loan ranked ${tied.join(', ')}`)
  const flags = []
  if (problems.length) {
    flags.push(
      raise(ctx, {
        id: 'M3D-lien-priority-unclear',
        severity: 'low',
        title: 'The order in which the loans are repaid is not clear.',
        evidence: `${problems.join('; ')}. With ${plural(loans.length, 'loan')}, who is paid first matters in a shortfall.`,
        cell_refs: cells,
        follow_up: 'Please give the lien priority of every loan.',
      }),
    )
  }
  const ranked = loans.filter(({ r }) => isNum(r.lienPriority))
  const seniorHard = Math.min(...ranked.filter(({ r }) => r.type === 'hard_debt').map(({ r }) => r.lienPriority))
  const mezzAhead = ranked.filter(({ r }) => r.type === 'mezzanine_debt' && r.lienPriority < seniorHard)
  if (mezzAhead.length) {
    flags.push(
      raise(ctx, {
        id: 'M3D-mezzanine-ahead-of-senior',
        severity: 'medium',
        title: 'A mezzanine loan is ranked ahead of the hard debt, which is unusual.',
        evidence: `${mezzAhead.map(({ r, name }) => `"${name}" (${typeLabel(r.type)}, priority ${r.lienPriority})`).join('; ')} ranks ahead of hard debt at priority ${seniorHard}.`,
        cell_refs: citeCells(record, mezzAhead.map(({ i }) => `sources.rows.${i}.lienPriority`)),
        follow_up: 'Is the ranking right? Mezzanine debt normally sits behind the senior loan.',
      }),
    )
  }
  const detail = `${plural(loans.length, 'loan')}, ranked ${ranked.map(({ r, name }) => `${r.lienPriority} ${name}`).join(', ') || 'none'}.`
  return row(id, title, group, flags.length ? 'fail' : 'pass', flags.length ? `${detail} ${problems.join('; ')}.` : detail, { cells, flags })
}

// =============================================================================================
// 4. TEAM
// =============================================================================================

const named = (line) => Boolean(line && [line.firmName, line.principal].some((v) => typeof v === 'string' && v.trim() !== ''))

function team(ctx) {
  const { record, firm } = ctx
  const [id, title, group] = ['team', 'The development team is named', 'Team']
  const lines = record.data.team.lines
  const others = ['other1', 'other2'].map((k) => lines[k]).filter(named)
  const otherText = others.map((l) => `${l.firmName ?? ''} ${l.principal ?? ''}`).join(' ')
  const roles = [
    ['General contractor', named(lines.generalContractor), 'team.lines.generalContractor.firmName'],
    ['Architect', named(lines.architect), 'team.lines.architect.firmName'],
    ['Developer or development partner', ['devPartner1', 'devPartner2', 'devPartner3'].some((k) => named(lines[k])), 'team.lines.devPartner1.firmName'],
    ['Property manager', /manag/i.test(otherText), 'team.lines.other1.firmName'],
    ['Guarantor', /guarant/i.test(otherText), 'team.lines.other2.firmName'],
  ]
  const missing = roles.filter(([, ok]) => !ok).map(([label]) => label)
  const cells = citeCells(record, roles.filter(([, ok]) => !ok).map(([, , path]) => path))
  const completed = firm?.data?.identity?.completedProjectCount
  const noTrack = completed === 0
  if (missing.length === 0 && !noTrack) return row(id, title, group, 'pass', 'A developer, general contractor, architect, property manager and guarantor are all named.', { cells })

  const parts = []
  if (missing.length) parts.push(`Not named: ${missing.join(', ')}. The workbook's team table has no row for a property manager or guarantor, so they count only when named under "Other".`)
  if (noTrack) parts.push('The firm reports no completed projects, so there is no track record of delivering one.')
  const f = raise(ctx, {
    id: 'M3D-team-incomplete',
    severity: 'low',
    title: noTrack && !missing.length ? 'The sponsor has no completed projects to show.' : 'Some of the development team is not named.',
    evidence: parts.join(' '),
    cell_refs: cells,
    follow_up: 'Please name the missing members of the team and their experience on similar projects, and say who is guaranteeing the loan.',
  })
  return row(id, title, group, 'fail', parts.join(' '), { cells, flags: [f] })
}

// =============================================================================================
// The list, in the order they appear on screen
// =============================================================================================

export const CHECKS = [contingency, costPerSqft, softToHard, sponsorFees, schedule, debtCoverage, interestReserve, takeout, lienPriority, team]

// Everything one run of the checks needs, worked out once.
export function prepare(project, context = {}, settings) {
  const maker = createFlagMaker(MODULE_ID, project)
  const used = maker.stage
  // A lease-up project's still-projected parts run under the development rules, so its ratios are read as development.
  const devRecord = used === 'development' ? project : applyStageAndDate(project, { stage: 'development' })
  // Matched by position, not by the id on the result: M0's contingency, equity-share and runway ratios return a result with no
  // id when an input is refused (a negative or absurd amount), and reading them by id would then find nothing. (Reported to M0.)
  const results = keyRatios(devRecord, settings)
  const ratios = Object.fromEntries(ratioIdsForStage('development').map((id, i) => [id, results[i]]))
  return {
    record: project,
    used,
    stage: used,
    flag: maker.flag,
    settings,
    firm: context.firm ?? null,
    ratios,
    bench: used === 'development' ? loadBenchmarks('development', context.benchmarkSets) : { ok: false, reason: 'No benchmark is used for a lease-up project.' },
  }
}
