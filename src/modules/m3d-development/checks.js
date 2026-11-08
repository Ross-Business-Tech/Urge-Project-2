// M3D: Development risk (layer 3). "What can go wrong while the project is being built and leased up?"
//
// Four checks, each returning one checklist row:
//
//   { id, title, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, items, cells, flags }
//
// `items` are the smaller questions inside a check (for example "contingency size" inside "budget realism"), each with
// its own status and a plain sentence, so the screen can show what was looked at. `flags` are the findings for M6.
//
// Every number comes from the shared calculators (M0) where one exists. Two figures have no shared calculator yet and are
// added up here from the budget lines: the hard-cost and soft-cost totals (by the schema's budget sections), and the
// building's square feet (units x square feet per unit, plus commercial square feet).

import {
  projectSchema,
  dscr,
  annualDebtService,
  totalDevelopmentCost,
  contingencyBenchmark,
  costBenchmark,
  compareToRange,
  citeCells,
  missingDataFlag,
  flagFromUnavailable,
  fmt,
  DEBT_SOURCE_TYPES,
  SOURCE_TYPES,
} from '../shared/index.js'

const MODULE = 'M3D'
const STAGE_USED = 'development' // a lease-up project runs these development checks for what is still projected

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const usd = (n) => fmt.usd(n)
const pct = (n, digits = 1) => fmt.pct(n, digits)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const sourceName = (row, i) => (typeof row?.name === 'string' && row.name.trim()) || `source ${i + 1}`
const typeLabel = (value) => SOURCE_TYPES.find((t) => t.value === value)?.label ?? 'no type'

// ---------------------------------------------------------------------------------------------
// Thresholds (rules of thumb for a first screen; each finding says which one it used)
// ---------------------------------------------------------------------------------------------

export const LIMITS = Object.freeze({
  sponsorFeeShare: 0.15, // developer and related-party fees above this share of total cost
  deferredFeeShare: 0.5, // more than half of the fee deferred
  minConstructionMonths: 6, // building faster than this is unusual
  maxConstructionMonths: 48, // building longer than this is unusual
  maxUnitsLeasedPerMonth: 25, // a lease-up faster than this many units a month is optimistic
  maxLeaseUpMonths: 24, // a lease-up longer than this is slow
  averageLoanDrawn: 0.5, // during construction and lease-up, assume about half of the loan payment is being carried
  minDebtYield: 0.08, // a lender's typical floor for NOI / debt at takeout
  maturityCushionMonths: 6, // a loan should run at least this long past stabilization
})

// ---------------------------------------------------------------------------------------------
// Budget lines
// ---------------------------------------------------------------------------------------------

const BUDGET_ROWS = projectSchema.find((g) => g.id === 'budget').rows
const HARD_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Hard costs')).map((r) => r.key)
const SOFT_KEYS = BUDGET_ROWS.filter((r) => r.section.startsWith('Soft costs')).map((r) => r.key)
const CONTINGENCY_KEYS = ['constructionContingency', 'ownersContingency']
export const FEE_KEYS = ['developerFee', 'projectManagementFees', 'constructionManagementFees', 'consultingFees', 'relatedPartyFees']
const RESERVE_KEYS = ['constructionInterest', 'rentUpReserve', 'operatingReserve']
const LABEL = Object.fromEntries(BUDGET_ROWS.map((r) => [r.key, r.label]))

// A budget amount as a usable number, or null for blank or not believable (the calculators report those).
const amount = (record, key) => {
  const v = record.data.budget?.lines?.[key]?.amount
  return isNum(v) && v >= 0 && v <= 1e12 ? v : null
}
const budgetPaths = (keys) => keys.map((k) => `budget.lines.${k}.amount`)

// ---------------------------------------------------------------------------------------------
// Dates. The timeline holds years ("2027" or 2027) or months ("2027-06").
// A year is a range of months (January to December), so a check only fires when it is clearly true.
// ---------------------------------------------------------------------------------------------

export function period(value) {
  if (isNum(value) && Number.isInteger(value) && value >= 1900 && value <= 2200) return { lo: value * 12, hi: value * 12 + 11, text: String(value) }
  if (typeof value !== 'string') return null
  const t = value.trim()
  let m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(t)
  if (m) {
    const i = Number(m[1]) * 12 + Number(m[2]) - 1
    return { lo: i, hi: i, text: t }
  }
  m = /^(\d{4})$/.exec(t)
  if (m) return period(Number(m[1]))
  return null
}
const monthText = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
const between = (a, b) => ({ min: b.lo - a.hi, max: b.hi - a.lo, mid: (b.lo + b.hi) / 2 - (a.lo + a.hi) / 2 })
const spanText = ({ min, max }) => (min === max ? plural(min, 'month') : `${Math.max(min, 0)} to ${max} months`)

const TIMELINE = [
  ['constructionStart', 'construction start'],
  ['constructionCompletion', 'construction completion'],
  ['stabilization', 'stabilization'],
]

function readTimeline(record) {
  const t = record.data.timeline ?? {}
  const out = { missing: [], unreadable: [] }
  for (const [key, label] of TIMELINE) {
    const raw = t[key]
    const p = period(raw)
    out[key] = p
    if (!p) (raw === null || raw === undefined || raw === '' ? out.missing : out.unreadable).push(label)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Rows and flags
// ---------------------------------------------------------------------------------------------

const item = (label, status, text) => ({ label, status, text })

// A row's status follows its findings: a real finding fails it; only "could not check" flags leave it unchecked.
function finish(id, title, items, flags, cells, passDetail) {
  const findings = flags.filter((f) => !f.id.endsWith('-missing'))
  const status = findings.length ? 'fail' : flags.length ? 'not_checked' : 'pass'
  const detail =
    status === 'pass'
      ? passDetail
      : status === 'fail'
        ? findings.map((f) => f.title).join(' ')
        : 'Some parts could not be checked: ' + flags.map((f) => f.evidence.replace(/^Missing: /, '')).join('; ')
  return { id, title, status, detail, items, cells: [...new Set(cells)].slice(0, 50), flags }
}

const notApplicable = (id, title, why) => ({ id, title, status: 'not_applicable', detail: why, items: [], cells: [], flags: [] })

const missing = (ctx, check, checkTitle, what, cell_refs = []) =>
  missingDataFlag({ module: MODULE, stage_used: STAGE_USED, check, checkTitle, missing: what, cell_refs: cell_refs.slice(0, 50) })

const unavailable = (result, check, checkTitle) => flagFromUnavailable(result, { module: MODULE, stage_used: STAGE_USED, check, checkTitle })

// ---------------------------------------------------------------------------------------------
// 1. Budget realism
// ---------------------------------------------------------------------------------------------

export const BUDGET_TITLE = 'Budget realism'

export function budgetRealism(ctx) {
  const id = 'budget'
  if (ctx.stage === 'lease_up') {
    return notApplicable(id, BUDGET_TITLE, 'The building is finished, so the construction budget is spent rather than projected. The reserves still to be used are checked under the capital stack.')
  }
  const { record, flag, set } = ctx
  const items = []
  const flags = []
  const cells = []

  // 1a. Contingency size. Only a contingency BELOW its range is a concern; more cushion than usual is fine.
  const cont = ctx.ratio('contingency')
  const contCells = citeCells(record, budgetPaths(CONTINGENCY_KEYS))
  const contBench = set.ok ? contingencyBenchmark(set.set) : { ok: false, reason: set.reason }
  if (!cont.ok) {
    flags.push(unavailable(cont, 'contingency', 'Contingency size'))
    items.push(item('Contingency size', 'not_checked', cont.reason))
  } else if (!contBench.ok) {
    flags.push(missing(ctx, 'contingency', 'Contingency size', `a contingency benchmark (${contBench.reason})`, contCells))
    items.push(item('Contingency size', 'not_checked', `Contingency is ${pct(cont.value)} of hard costs, but there is no benchmark to compare it with.`))
  } else {
    const range = contBench.range
    const held = sum(CONTINGENCY_KEYS.map((k) => amount(record, k)))
    const hardBase = sum(HARD_KEYS.map((k) => amount(record, k))) - held
    const compared = compareToRange(cont.value, range)
    const vs = `${pct(range.low, 0)} to ${pct(range.high, 0)} benchmark${set.set.madeUp ? ' (made-up sample)' : ''}`
    cells.push(...contCells)
    if (compared.ok && compared.position === 'below') {
      flags.push(
        flag({
          id: 'M3D-contingency-low',
          severity: cont.value < range.low / 2 ? 'high' : 'medium',
          title: 'The construction contingency is thin for a project still being built.',
          evidence: `Contingency ${pct(cont.value)} of hard cost vs. a ${vs}: ${usd(held)} of construction and owner's contingency on ${usd(hardBase)} of hard costs.`,
          cell_refs: contCells,
          follow_up: `The contingency is ${pct(cont.value)} of hard costs. How would a cost overrun be paid for, and can the contingency be raised to at least ${pct(range.low, 0)}?`,
          transition: 'T1',
        }),
      )
      items.push(item('Contingency size', 'fail', `${pct(cont.value)} of hard costs, below the ${vs}.`))
    } else {
      const above = compared.ok && compared.position === 'above' ? ', above the range, which only means more cushion' : ', within the range'
      items.push(item('Contingency size', 'pass', `${pct(cont.value)} of hard costs vs. a ${vs}${above}.`))
    }
  }

  // 1b. Hard-cost to soft-cost ratio, against the ratio the cost benchmarks imply.
  const hard = sum(HARD_KEYS.map((k) => amount(record, k)))
  const soft = sum(SOFT_KEYS.map((k) => amount(record, k)))
  const hardBench = set.ok ? costBenchmark(set.set, 'hard') : { ok: false, reason: set.reason }
  const softBench = set.ok ? costBenchmark(set.set, 'soft') : { ok: false, reason: set.reason }
  if (hard <= 0) {
    if (cont.ok) flags.push(missing(ctx, 'hard-soft', 'The hard-cost to soft-cost ratio', 'hard cost lines in the development budget'))
    items.push(item('Hard vs. soft costs', 'not_checked', 'No hard costs entered.'))
  } else if (!hardBench.ok || !softBench.ok) {
    flags.push(missing(ctx, 'hard-soft', 'The hard-cost to soft-cost ratio', `cost benchmarks (${(hardBench.ok ? softBench : hardBench).reason})`))
    items.push(item('Hard vs. soft costs', 'not_checked', 'There is no cost benchmark to compare with.'))
  } else {
    const ratio = soft / hard
    const range = { low: softBench.range.low / hardBench.range.high, high: softBench.range.high / hardBench.range.low }
    const text = `Soft costs ${usd(soft)} are ${pct(ratio)} of hard costs ${usd(hard)} vs. about ${pct(range.low, 0)} to ${pct(range.high, 0)} implied by the cost benchmarks`
    if (ratio < range.low || ratio > range.high) {
      const low = ratio < range.low
      const softCells = citeCells(record, budgetPaths(SOFT_KEYS.filter((k) => amount(record, k) !== null)))
      cells.push(...softCells)
      flags.push(
        flag({
          id: 'M3D-hard-soft-ratio',
          severity: 'medium',
          title: low ? 'Soft costs look light next to the hard costs, so some costs may be missing from the budget.' : 'Soft costs are heavy next to the hard costs.',
          evidence: `${text}.`,
          cell_refs: softCells,
          follow_up: low
            ? 'Soft costs (design, financing, legal, fees, reserves) look low for this much construction. Are any of them paid outside this budget or missing?'
            : 'Soft costs are high for this much construction. What drives them, and are any of them fees paid to the sponsor or related parties?',
        }),
      )
      items.push(item('Hard vs. soft costs', 'fail', `${text}.`))
    } else items.push(item('Hard vs. soft costs', 'pass', `${text}.`))
  }

  // 1c. Cost per square foot (hard and total) against the cost benchmarks. M2 compares with the market in more detail.
  const res = record.data.residentialIncome?.rows ?? []
  const com = record.data.commercialIncome?.rows ?? []
  const resSqft = sum(res.map((r) => (isNum(r?.units) && isNum(r?.sqft) && r.units >= 0 && r.sqft >= 0 ? r.units * r.sqft : null)))
  const comSqft = sum(com.map((r) => (isNum(r?.sqft) && r.sqft >= 0 ? r.sqft : null)))
  const sqft = resSqft + comSqft
  const tdc = totalDevelopmentCost(record)
  const totalBench = set.ok ? costBenchmark(set.set, 'total') : { ok: false, reason: set.reason }
  const sqftPaths = [...res.flatMap((_, i) => [`residentialIncome.rows.${i}.units`, `residentialIncome.rows.${i}.sqft`]), ...com.map((_, i) => `commercialIncome.rows.${i}.sqft`)]
  if (!tdc.ok) {
    if (cont.ok) flags.push(unavailable(tdc, 'cost-per-sqft', 'Cost per square foot'))
    items.push(item('Cost per square foot', 'not_checked', tdc.reason))
  } else if (sqft <= 0) {
    flags.push(missing(ctx, 'cost-per-sqft', 'Cost per square foot', 'square feet per unit (residential income) or commercial square feet'))
    items.push(item('Cost per square foot', 'not_checked', 'No square feet entered.'))
  } else if (!hardBench.ok || !totalBench.ok) {
    items.push(item('Cost per square foot', 'not_checked', `Hard cost ${usd(hard / sqft)} and total cost ${usd(tdc.value / sqft)} a square foot; there is no benchmark to compare with.`))
  } else {
    const hardPsf = hard / sqft
    const totalPsf = tdc.value / sqft
    const hp = compareToRange(hardPsf, hardBench.range)
    const tp = compareToRange(totalPsf, totalBench.range)
    const text = `Hard cost ${usd(hardPsf)} a sq ft (benchmark ${usd(hardBench.range.low)} to ${usd(hardBench.range.high)}) and total cost ${usd(totalPsf)} a sq ft (benchmark ${usd(totalBench.range.low)} to ${usd(totalBench.range.high)}), over ${Math.round(sqft).toLocaleString('en-US')} sq ft`
    const below = hp.position === 'below' || tp.position === 'below'
    const above = hp.position === 'above' || tp.position === 'above'
    if (below || above) {
      const refs = citeCells(record, sqftPaths).slice(0, 40)
      cells.push(...refs)
      flags.push(
        flag({
          id: below ? 'M3D-cost-per-sqft-low' : 'M3D-cost-per-sqft-high',
          severity: 'low',
          title: below ? 'The budget is cheap per square foot, so it may not cover the full cost to build.' : 'The budget is expensive per square foot.',
          evidence: `${text}.${set.set.madeUp ? ' The benchmark is made-up sample data.' : ''}`,
          cell_refs: refs,
          follow_up: below
            ? 'The cost per square foot is below comparable projects. Is the price backed by a signed contract or a recent bid, and what is left out?'
            : 'The cost per square foot is above comparable projects. What drives the higher cost, and do the rents support it?',
        }),
      )
      items.push(item('Cost per square foot', 'fail', `${text}.`))
    } else items.push(item('Cost per square foot', 'pass', `${text}.`))
  }

  // 1d. Fees to the sponsor and related parties, and how much of them is deferred (a deferred fee is a source of money).
  const fees = sum(FEE_KEYS.map((k) => amount(record, k)))
  const feeCells = citeCells(record, budgetPaths(FEE_KEYS.filter((k) => amount(record, k) !== null)))
  const sources = record.data.sources?.rows ?? []
  const deferredRows = sources.map((r, i) => ({ r, i })).filter(({ r }) => typeof r?.name === 'string' && /defer/i.test(r.name) && isNum(r.amount) && r.amount > 0)
  const deferred = sum(deferredRows.map(({ r }) => r.amount))
  const deferredCells = citeCells(record, deferredRows.map(({ i }) => `sources.rows.${i}.amount`))
  if (!tdc.ok) {
    items.push(item('Sponsor and related-party fees', 'not_checked', tdc.reason))
  } else {
    const share = fees / tdc.value
    const feeText = `Developer and related-party fees ${usd(fees)} (${pct(share)} of the ${usd(tdc.value)} total cost); ${usd(deferred)} shown as a deferred fee in the sources`
    const found = []
    if (share > LIMITS.sponsorFeeShare) {
      found.push(
        flag({
          id: 'M3D-sponsor-fees-high',
          severity: 'medium',
          title: 'A large share of the budget is paid to the sponsor and related parties as fees.',
          evidence: `${feeText}. Fees above ${pct(LIMITS.sponsorFeeShare, 0)} of cost leave less of the budget for building the project.`,
          cell_refs: feeCells,
          follow_up: 'Which fees go to the sponsor or its affiliates, when are they paid, and would any be deferred or cut if costs run over?',
        }),
      )
    }
    if (deferred > fees + 1) {
      found.push(
        flag({
          id: 'M3D-deferred-fee-unmatched',
          severity: 'low',
          title: 'The sources count on a deferred fee that is larger than the fees in the budget.',
          evidence: `${feeText}. A deferred fee can only be as large as the fee it defers.`,
          cell_refs: [...deferredCells, ...feeCells],
          follow_up: `The sources include ${usd(deferred)} of deferred fee, but the budget shows ${usd(fees)} of developer and related-party fees. Which fee is being deferred, and where does it appear in the budget?`,
        }),
      )
    } else if (fees > 0 && deferred / fees > LIMITS.deferredFeeShare) {
      found.push(
        flag({
          id: 'M3D-fee-mostly-deferred',
          severity: 'low',
          title: 'Most of the developer fee is deferred, so the budget leans on the sponsor waiting to be paid.',
          evidence: `${feeText}: ${pct(deferred / fees)} of the fee is deferred (more than ${pct(LIMITS.deferredFeeShare, 0)}).`,
          cell_refs: [...deferredCells, ...feeCells],
          follow_up: 'When and from what cash flow will the deferred fee be paid, and can the sponsor afford to wait if the lease-up is slow?',
        }),
      )
    }
    if (found.length) {
      cells.push(...feeCells, ...deferredCells)
      flags.push(...found)
      items.push(item('Sponsor and related-party fees', 'fail', `${feeText}.`))
    } else items.push(item('Sponsor and related-party fees', 'pass', `${feeText}.`))
  }

  return finish(id, BUDGET_TITLE, items, flags, cells, 'Contingency, the hard-to-soft cost split, cost per square foot and fees all look reasonable.')
}

// ---------------------------------------------------------------------------------------------
// 2. Schedule
// ---------------------------------------------------------------------------------------------

export const SCHEDULE_TITLE = 'Schedule'

export function schedule(ctx) {
  const id = 'schedule'
  const { record, flag, stage, asOf } = ctx
  const leaseUp = stage === 'lease_up'
  const tl = readTimeline(record)
  const items = []
  const flags = []
  const timelineCells = citeCells(record, TIMELINE.map(([k]) => `timeline.${k}`))
  const cells = [...timelineCells]
  const { constructionStart: start, constructionCompletion: done, stabilization: stab } = tl

  // For a lease-up project the build is over; only completion and stabilization still matter.
  const needed = leaseUp ? ['construction completion', 'stabilization'] : TIMELINE.map(([, l]) => l)
  const gaps = [...tl.missing.filter((l) => needed.includes(l)), ...tl.unreadable.filter((l) => needed.includes(l)).map((l) => `${l} (could not be read as a year or month)`)]
  if (gaps.length) {
    flags.push(missing(ctx, 'schedule', 'The schedule', gaps.map((g) => `the ${g} date`), timelineCells))
    items.push(item('Dates entered', 'not_checked', `Missing: ${gaps.join(', ')}.`))
  }

  // Order: start, then completion, then stabilization.
  const order = []
  if (!leaseUp && start && done && done.hi <= start.lo) order.push(`completion (${done.text}) is not after the start (${start.text})`)
  if (done && stab && stab.hi <= done.lo) order.push(`stabilization (${stab.text}) is not after completion (${done.text})`)
  if (order.length) {
    flags.push(
      flag({
        id: 'M3D-schedule-out-of-order',
        severity: 'high',
        title: 'The project dates are in the wrong order, so the schedule cannot be relied on.',
        evidence: `In the timeline, ${order.join('; and ')}.`,
        cell_refs: timelineCells,
        follow_up: 'Please confirm the construction start, completion and stabilization dates; as entered they do not follow one another.',
        transition: 'T1',
      }),
    )
    items.push(item('Dates in order', 'fail', `${order.join('; ')}.`))
  } else if ((leaseUp || start) && done && stab) items.push(item('Dates in order', 'pass', `${leaseUp ? '' : `Start ${start.text}, `}completion ${done.text}, stabilization ${stab.text}.`))

  // Construction length.
  if (!leaseUp && start && done && !order.length) {
    const len = between(start, done)
    const text = `Construction takes ${spanText(len)} (${start.text} to ${done.text})`
    if (len.max < LIMITS.minConstructionMonths) {
      flags.push(
        flag({
          id: 'M3D-construction-short',
          severity: 'medium',
          title: 'The construction period looks too short to be realistic.',
          evidence: `${text}, under the ${LIMITS.minConstructionMonths} months a project of this kind usually needs.`,
          cell_refs: timelineCells,
          follow_up: "What does the general contractor's schedule show for construction, and what happens to the interest reserve if it runs longer?",
          transition: 'T1',
        }),
      )
      items.push(item('Construction length', 'fail', `${text}.`))
    } else if (len.min > LIMITS.maxConstructionMonths) {
      flags.push(
        flag({
          id: 'M3D-construction-long',
          severity: 'low',
          title: 'The construction period is unusually long, which adds carrying cost and delivery risk.',
          evidence: `${text}, over ${LIMITS.maxConstructionMonths} months.`,
          cell_refs: timelineCells,
          follow_up: 'Why is construction expected to take this long, and is the interest and carrying cost for the whole period in the budget?',
          transition: 'T1',
        }),
      )
      items.push(item('Construction length', 'fail', `${text}.`))
    } else items.push(item('Construction length', 'pass', `${text}.`))
  }

  // Lease-up length and pace.
  if (done && stab && !order.some((o) => o.startsWith('stabilization'))) {
    const len = between(done, stab)
    const units = sum((record.data.residentialIncome?.rows ?? []).map((r) => (isNum(r?.units) && r.units >= 0 ? r.units : null)))
    const pace = units > 0 && len.max > 0 ? units / len.max : null
    const text = `Lease-up takes ${spanText(len)} (${done.text} to ${stab.text})${units > 0 ? ` for ${plural(units, 'unit')}` : ''}${pace !== null ? `, at least ${pace.toFixed(1)} units a month` : ''}`
    const unitCells = citeCells(record, (record.data.residentialIncome?.rows ?? []).map((_, i) => `residentialIncome.rows.${i}.units`))
    if (pace !== null && pace > LIMITS.maxUnitsLeasedPerMonth) {
      flags.push(
        flag({
          id: 'M3D-lease-up-fast',
          severity: 'medium',
          title: 'The lease-up assumes units fill faster than is usual.',
          evidence: `${text}, above the ${LIMITS.maxUnitsLeasedPerMonth} units a month that is a reasonable pace.`,
          cell_refs: [...timelineCells, ...unitCells],
          follow_up: 'What leasing pace do comparable new buildings nearby achieve, and how long do the reserves last if the lease-up takes twice as long?',
          transition: 'T2',
        }),
      )
      items.push(item('Lease-up length', 'fail', `${text}.`))
    } else if (len.min > LIMITS.maxLeaseUpMonths) {
      flags.push(
        flag({
          id: 'M3D-lease-up-long',
          severity: 'low',
          title: 'The lease-up period is long, which adds carrying cost before the property is stable.',
          evidence: `${text}, over ${LIMITS.maxLeaseUpMonths} months.`,
          cell_refs: timelineCells,
          follow_up: 'Why is the lease-up expected to take this long, and are the loan payments in that period covered by reserves?',
          transition: 'T2',
        }),
      )
      items.push(item('Lease-up length', 'fail', `${text}.`))
    } else items.push(item('Lease-up length', 'pass', `${text}.`))
  }

  // Dates against the "as of" date: a milestone that should already have happened.
  if (asOf !== null) {
    const asOfText = monthText(asOf)
    if (!leaseUp && done && done.hi < asOf) {
      flags.push(
        flag({
          id: 'M3D-completion-passed',
          severity: 'medium',
          title: 'Construction was due to be finished by now, but the project is still in development.',
          evidence: `Completion ${done.text} is before the "as of" date ${asOfText}, and the stage chosen is development.`,
          cell_refs: timelineCells,
          follow_up: 'Has construction finished? If not, what is the new completion date, and how is the extra interest being paid?',
          transition: 'T1',
        }),
      )
      items.push(item('Dates vs. the "as of" date', 'fail', `Completion ${done.text} is already past (as of ${asOfText}).`))
    } else if (leaseUp && stab && stab.hi < asOf) {
      flags.push(
        flag({
          id: 'M3D-stabilization-passed',
          severity: 'medium',
          title: 'The project was due to be stable by now, but it is still leasing up.',
          evidence: `Stabilization ${stab.text} is before the "as of" date ${asOfText}, and the stage chosen is lease-up.`,
          cell_refs: timelineCells,
          follow_up: 'What is the new stabilization date, and does the loan still work (reserves, maturity, takeout) with the delay?',
          transition: 'T2',
        }),
      )
      items.push(item('Dates vs. the "as of" date', 'fail', `Stabilization ${stab.text} is already past (as of ${asOfText}).`))
    } else if (done || stab) items.push(item('Dates vs. the "as of" date', 'pass', `The next milestone is still ahead of the "as of" date ${asOfText}.`))
  } else items.push(item('Dates vs. the "as of" date', 'not_checked', 'No "as of" date chosen.'))

  return finish(id, SCHEDULE_TITLE, items, flags, cells, 'The dates follow one another and the construction and lease-up periods are realistic.')
}

// ---------------------------------------------------------------------------------------------
// 3. Capital stack and takeout risk
// ---------------------------------------------------------------------------------------------

export const CAPITAL_TITLE = 'Capital stack and takeout risk'

export function capitalStack(ctx) {
  const id = 'capital'
  const { record, flag, stage, settings, asOf } = ctx
  const leaseUp = stage === 'lease_up'
  const items = []
  const flags = []
  const cells = []
  const rows = (record.data.sources?.rows ?? []).map((r, i) => ({ r, i, name: sourceName(r, i) })).filter(({ r }) => isNum(r?.amount) && r.amount > 0)
  const isDebt = (r) => DEBT_SOURCE_TYPES.includes(r.type)

  // 3a. Lien priority: every loan has a place, no two share one, and loans sit ahead of equity, grants and deferred fees.
  if (rows.length === 0) {
    flags.push(missing(ctx, 'lien-priority', 'Lien priority', 'the sources of money (lender, amount and lien priority)'))
    items.push(item('Lien priority', 'not_checked', 'No sources of money entered.'))
  } else {
    const lienCells = citeCells(record, rows.map(({ i }) => `sources.rows.${i}.lienPriority`))
    const debts = rows.filter(({ r }) => isDebt(r))
    const unranked = debts.filter(({ r }) => !(isNum(r.lienPriority) && r.lienPriority >= 1))
    const ranked = rows.filter(({ r }) => isNum(r.lienPriority) && r.lienPriority >= 1)
    const problems = []
    const byRank = new Map()
    for (const x of ranked) byRank.set(x.r.lienPriority, [...(byRank.get(x.r.lienPriority) ?? []), x])
    for (const [rank, list] of byRank) {
      if (list.length > 1 && list.some(({ r }) => isDebt(r))) problems.push(`${list.map((x) => `"${x.name}"`).join(' and ')} share lien position ${rank}`)
    }
    const rankedDebt = ranked.filter(({ r }) => isDebt(r))
    const worstDebt = rankedDebt.length ? Math.max(...rankedDebt.map(({ r }) => r.lienPriority)) : null
    for (const x of ranked) {
      if (!isDebt(x.r) && worstDebt !== null && x.r.lienPriority < worstDebt) problems.push(`"${x.name}" (${typeLabel(x.r.type).toLowerCase()}) is ranked ahead of a loan`)
    }
    const hardRanks = rankedDebt.filter(({ r }) => r.type === 'hard_debt').map(({ r }) => r.lienPriority)
    for (const x of rankedDebt) {
      if (x.r.type === 'mezzanine_debt' && hardRanks.some((h) => h > x.r.lienPriority)) problems.push(`the mezzanine loan "${x.name}" is ranked ahead of a senior loan`)
    }
    const stack = [...ranked].sort((a, b) => a.r.lienPriority - b.r.lienPriority).map((x) => `${x.r.lienPriority}. ${x.name} (${typeLabel(x.r.type).toLowerCase()}, ${usd(x.r.amount)})`).join('; ')
    if (problems.length) {
      cells.push(...lienCells)
      flags.push(
        flag({
          id: 'M3D-lien-priority-unclear',
          severity: 'medium',
          title: 'The order in which lenders get repaid is unclear or unusual.',
          evidence: `${problems.join('; ')}. Stack as entered: ${stack}.`.slice(0, 1000),
          cell_refs: lienCells,
          follow_up: 'Please confirm the lien position of each loan and whether the lenders have agreed it in an intercreditor agreement.',
        }),
      )
      items.push(item('Lien priority', 'fail', `${problems.join('; ')}.`))
    }
    if (unranked.length) {
      flags.push(missing(ctx, 'lien-priority', 'Lien priority', unranked.map((x) => `the lien priority of the loan "${x.name}"`), lienCells))
      if (!problems.length) items.push(item('Lien priority', 'not_checked', `${unranked.map((x) => `"${x.name}"`).join(', ')} has no lien priority.`))
    } else if (!problems.length) items.push(item('Lien priority', 'pass', debts.length ? `Loans come first. ${stack}.` : `No loans; ${stack}.`))
  }

  // 3b. Interest reserve adequacy (the Construction Interest, Rent-Up Reserve and Operating Reserve lines) against the loan
  // payments that must be carried before the property's income covers them.
  const ds = annualDebtService(record)
  const tl = readTimeline(record)
  const reserveKeys = leaseUp ? ['rentUpReserve', 'operatingReserve'] : RESERVE_KEYS
  const reserveCells = citeCells(record, budgetPaths(reserveKeys))
  const transition = leaseUp ? 'T2' : 'T1'
  const reserveTitle = 'Interest reserve'
  if (!ds.ok) {
    flags.push(unavailable(ds, 'interest-reserve', 'Interest reserve adequacy'))
    items.push(item(reserveTitle, 'not_checked', ds.reason))
  } else if (ds.value <= 0) {
    items.push(item(reserveTitle, 'pass', 'There are no loan payments to carry.'))
  } else {
    const { constructionStart: start, constructionCompletion: done, stabilization: stab } = tl
    let months = null
    let monthsText = ''
    if (!leaseUp && start && done && stab) {
      const build = Math.max(between(start, done).mid, 0)
      const lease = Math.max(between(done, stab).mid, 0)
      months = build + lease
      monthsText = `${Math.round(build)} months of construction and ${Math.round(lease)} months of lease-up`
    } else if (leaseUp && done && stab) {
      const from = Math.max(asOf ?? -Infinity, (done.lo + done.hi) / 2)
      months = Math.max((stab.lo + stab.hi) / 2 - from, 0)
      monthsText = `${Math.round(months)} months left until stabilization`
    }
    if (months === null) {
      flags.push(missing(ctx, 'interest-reserve', 'Interest reserve adequacy', leaseUp ? 'the construction completion and stabilization dates' : 'the construction start, completion and stabilization dates', citeCells(record, TIMELINE.map(([k]) => `timeline.${k}`))))
      items.push(item(reserveTitle, 'not_checked', 'The timeline is needed to estimate how long loan payments must be carried.'))
    } else {
      const monthly = ds.value / 12
      const need = monthly * LIMITS.averageLoanDrawn * months
      const lines = reserveKeys.map((k) => ({ k, v: amount(record, k) }))
      const held = sum(lines.map((l) => l.v))
      const lineText = lines.map((l) => `${LABEL[l.k].toLowerCase()} ${l.v === null ? 'blank' : usd(l.v)}`).join(', ')
      const estimate = `about ${usd(need)} of loan payments to carry (half of ${usd(monthly)} a month over ${monthsText})`
      if (need <= 0) items.push(item(reserveTitle, 'pass', `No months left to carry; ${lineText}.`))
      else if (held < need) {
        cells.push(...reserveCells)
        const none = held <= 0
        flags.push(
          flag({
            id: none ? 'M3D-interest-reserve-none' : 'M3D-interest-reserve-short',
            severity: none || held < need / 2 ? 'high' : 'medium',
            title: none ? 'The budget has no reserve to pay the loan before the property earns enough.' : 'The interest and lease-up reserves may run out before the property earns enough to pay the loan.',
            evidence: `Reserves ${usd(held)} (${lineText}) vs. ${estimate}: covers ${pct(held / need, 0)}.`,
            cell_refs: reserveCells,
            follow_up: leaseUp
              ? 'How will loan payments be met until the property is stable, and who funds the gap if leasing is slower than planned?'
              : 'How will interest be paid during construction and lease-up? Is there an interest reserve in the construction loan, or a guarantee to cover it?',
            transition,
          }),
        )
        items.push(item(reserveTitle, 'fail', `${usd(held)} held vs. ${estimate}.`))
      } else items.push(item(reserveTitle, 'pass', `${usd(held)} held (${lineText}) vs. ${estimate}.`))
    }
  }

  // 3c. Refinance or takeout risk: will the stabilized property support its loan?
  const takeoutTitle = 'Takeout at stabilization'
  const d = dscr(record)
  const sourceCells = citeCells(record, rows.flatMap(({ i }) => [`sources.rows.${i}.amount`, `sources.rows.${i}.interestRate`, `sources.rows.${i}.termMonths`])).slice(0, 30)
  if (!d.ok) {
    flags.push(unavailable(d, 'takeout', 'Refinance and takeout risk'))
    items.push(item(takeoutTitle, 'not_checked', d.reason))
  } else {
    const found = []
    if (d.value < settings.minDscr) {
      found.push(
        flag({
          id: 'M3D-dscr-under-minimum',
          severity: 'high',
          title: "At stabilization, the income does not cover the loan payments by the lender's minimum, so the takeout loan is at risk.",
          evidence: `DSCR ${fmt.times(d.value)} vs. a ${fmt.times(settings.minDscr)} minimum (stabilized NOI over ${usd(ds.ok ? ds.value : 0)} of yearly loan payments).`,
          cell_refs: sourceCells,
          follow_up: "The projected income misses the lender's coverage test. How will the permanent loan be sized or the gap filled (more equity, a smaller loan, a lower rate)?",
          transition: 'T2',
        }),
      )
    }
    const dy = ctx.ratio('debtYield')
    if (dy.ok && dy.value < LIMITS.minDebtYield) {
      found.push(
        flag({
          id: 'M3D-debt-yield-low',
          severity: 'medium',
          title: 'The income is low for the amount of debt, which makes refinancing harder.',
          evidence: `Debt yield ${pct(dy.value)} vs. a typical ${pct(LIMITS.minDebtYield, 0)} lender floor (${dy.detail?.[0] ?? ''}).`,
          cell_refs: sourceCells,
          follow_up: 'Which lender is expected to provide the takeout loan, and has it confirmed the loan amount at this level of income?',
          transition: 'T2',
        }),
      )
    }
    // A loan that comes due before the project is stable (plus a cushion) must be refinanced before it can qualify.
    const start = tl.constructionStart
    const stab = tl.stabilization
    if (start && stab) {
      const early = rows.filter(({ r }) => isDebt(r) && Number.isInteger(r.termMonths) && r.termMonths > 0 && start.lo + r.termMonths < stab.hi + LIMITS.maturityCushionMonths)
      if (early.length) {
        found.push(
          flag({
            id: 'M3D-loan-matures-early',
            severity: 'high',
            title: 'A loan comes due before the project is expected to be stable, so it would have to be refinanced too early.',
            evidence: early
              .map(({ r, name }) => `"${name}" runs ${plural(r.termMonths, 'month')} from the ${start.text} start, to about ${monthText(start.lo + r.termMonths)}, but stabilization is ${stab.text}`)
              .join('; ')
              .concat(` (a cushion of ${LIMITS.maturityCushionMonths} months is expected).`),
            cell_refs: citeCells(record, [...early.map(({ i }) => `sources.rows.${i}.termMonths`), 'timeline.constructionStart', 'timeline.stabilization']),
            follow_up: 'Does the loan have extension options, and on what conditions? What is the plan if the property is not stable when it matures?',
            transition: 'T2',
          }),
        )
      }
    }
    const text = `DSCR ${fmt.times(d.value)} (minimum ${fmt.times(settings.minDscr)})${ctx.ratio('debtYield').ok ? `, debt yield ${pct(ctx.ratio('debtYield').value)}` : ''}`
    if (found.length) {
      cells.push(...found.flatMap((f) => f.cell_refs))
      flags.push(...found)
      items.push(item(takeoutTitle, 'fail', `${text}. ${found.map((f) => f.title).join(' ')}`))
    } else items.push(item(takeoutTitle, 'pass', `${text}; no loan matures before stabilization.`))
  }

  return finish(id, CAPITAL_TITLE, items, flags, cells, 'Lien order is clear, the reserves cover the loan payments until the property earns enough, and the takeout tests pass.')
}

// ---------------------------------------------------------------------------------------------
// 4. Team completeness
// ---------------------------------------------------------------------------------------------

export const TEAM_TITLE = 'Team completeness'
const DEV_ROWS = ['devPartner1', 'devPartner2', 'devPartner3']
const OTHER_ROWS = ['other1', 'other2']

const named = (line) => [line?.firmName, line?.principal].find((v) => typeof v === 'string' && v.trim() !== '')?.trim() ?? null

export function teamCompleteness(ctx) {
  const id = 'team'
  if (ctx.stage === 'lease_up') {
    return notApplicable(id, TEAM_TITLE, 'The building is finished, so the construction team is no longer a delivery risk. The property manager is reviewed with the operating checks.')
  }
  const { record, flag, firm } = ctx
  const lines = record.data.team?.lines ?? {}
  const teamCells = citeCells(record, [...['generalContractor', 'architect', ...DEV_ROWS, ...OTHER_ROWS].map((k) => `team.lines.${k}.firmName`)])
  const anyTeam = Object.values(lines).some((l) => named(l))

  const developer = DEV_ROWS.map((k) => named(lines[k])).find(Boolean) ?? null
  const firmName = typeof firm?.data?.identity?.name === 'string' && firm.data.identity.name.trim() ? firm.data.identity.name.trim() : null
  const others = OTHER_ROWS.map((k) => named(lines[k])).filter(Boolean)
  const roles = [
    { role: 'developer', who: developer ?? (firmName ? `${firmName} (the applicant firm)` : null) },
    { role: 'general contractor', who: named(lines.generalContractor) },
    { role: 'architect', who: named(lines.architect) },
    // The applicant form has no line for these two; an "Other" row whose name says so counts.
    { role: 'property manager', who: others.find((n) => /manag/i.test(n)) ?? null, offForm: true },
    { role: 'guarantor', who: others.find((n) => /guarant/i.test(n)) ?? null, offForm: true },
  ]
  const items = roles.map((r) => item(r.role[0].toUpperCase() + r.role.slice(1), r.who ? 'pass' : r.offForm ? 'not_checked' : 'fail', r.who ? `Named: ${r.who}.` : r.offForm ? 'The applicant form has no line for this; ask the sponsor.' : 'Not named.'))
  const absent = roles.filter((r) => !r.who)
  const experience = 'and what similar projects has each completed?'

  if (!anyTeam) {
    for (const it of items) if (it.status === 'fail') it.status = 'not_checked'
    const flag0 = missing(ctx, 'team', 'Team completeness', `the development team (${absent.map((r) => r.role).join(', ')})`, teamCells)
    return finish(id, TEAM_TITLE, items, [flag0], teamCells, '')
  }
  const core = absent.filter((r) => !r.offForm)
  const flags = []
  if (core.length) {
    flags.push(
      flag({
        id: 'M3D-team-incomplete',
        severity: 'medium',
        title: 'Key members of the development team are not named.',
        evidence: `Not named: ${core.map((r) => r.role).join(', ')}. Named: ${roles.filter((r) => r.who).map((r) => `${r.role} ${r.who}`).join('; ') || 'nobody'}.`,
        cell_refs: teamCells,
        follow_up: `Who is the ${core.map((r) => r.role).join(', ')}${absent.some((r) => r.offForm) ? `, and who are the ${absent.filter((r) => r.offForm).map((r) => r.role).join(' and ')}` : ''}, ${experience}`,
      }),
    )
  } else if (absent.length) {
    flags.push(missing(ctx, 'team-roles', 'Whether a property manager and guarantor are named', absent.map((r) => `the ${r.role} and their experience (the applicant form has no line for it)`), teamCells))
  }
  return finish(id, TEAM_TITLE, items, flags, teamCells, `Developer, general contractor, architect, property manager and guarantor are all named. Ask about their experience with similar projects.`)
}

export const CHECKS = [budgetRealism, schedule, capitalStack, teamCompleteness]
export const CHECK_TITLES = { budget: BUDGET_TITLE, schedule: SCHEDULE_TITLE, capital: CAPITAL_TITLE, team: TEAM_TITLE }
