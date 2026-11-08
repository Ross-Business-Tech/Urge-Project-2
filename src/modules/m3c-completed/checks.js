// M3C: Completed risk (layer 3, stage-specific). "What can go wrong with a property that is already operating?"
//
// Four checks, each returning one checklist row:
//
//   { id, title, question, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, cells, flags }
//
//   1. actuals   T-12 NOI and the rent roll against what was underwritten
//   2. expenses  property tax reassessment, replacement reserves, missing expense lines, total expenses vs. the T-12
//   3. vacancy   is the vacancy assumption supported by the T-12 occupancy history?
//   4. debt      when does each loan mature, and on what terms?
//
// Runs in full for `completed`. For `lease_up` only the parts that are already actual run (the rent roll to date and the
// expenses to date); the NOI comparison, vacancy and debt checks belong to the stabilized property (M3T and M3D cover them
// while the project is still filling).
//
// Uses the shared calculators (NOI, DSCR, debt service, the "T-12 vs. underwritten" ratio) and never recomputes them. The
// monthly T-12 lines themselves are read with M0's month rules: 2026-06 and 2026-06-30 are the same month, a month
// entered twice counts once (the later row wins), and a row without a real month is left out and reported.

import {
  annualDebtService,
  citeCells,
  dscr,
  fmt,
  isValidDate,
  keyRatios,
  missingDataFlag,
  flagFromUnavailable,
  noi,
  projectSchema,
  DEBT_SOURCE_TYPES,
} from '../shared/index.js'

export const MODULE_ID = 'M3C'

// Thresholds this module uses on top of the shared settings (section 1f). Made explicit so the screen can name them.
export const LIMITS = Object.freeze({
  noiHigh: 0.85, // T-12 NOI under 85% of the required share of underwritten NOI is high
  noiMedium: 0.95, // under 95% is medium; anything else under the setting is low
  rentRollMedium: 0.95, // billed rent under 95% of the underwritten rent roll
  rentRollHigh: 0.9,
  expenseMedium: 1.1, // T-12 expenses 10% above the underwriting
  expenseHigh: 1.25,
  taxAbove: 1.1, // T-12 property taxes 10% above the underwritten line, or the recent months 10% above the early ones
  recentCompletionMonths: 24, // completed this recently: taxes may not yet reflect the reassessed value
  reservePerUnit: 250, // replacement reserves below $250 a unit a year are thin
  vacancyMedium: 0.02, // actual vacancy 2 points above the assumption
  vacancyHigh: 0.05,
  maturityHigh: 12, // a loan maturing within 12 months (or already past maturity)
  maturityMedium: 36,
})

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const money = (v) => (isNum(v) && v >= 0 && v <= 1e12 ? v : null)
const share = (v) => (isNum(v) && v >= 0 && v <= 1 ? v : null)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const avg = (list) => (list.length ? sum(list) / list.length : null)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const usd = (n) => fmt.usd(n)
const pct = (n, d = 1) => fmt.pct(n, d)
const SEVERITY_ORDER = ['high', 'medium', 'low']
const worst = (list) => SEVERITY_ORDER.find((s) => list.includes(s)) ?? 'low'
const sourceName = (row, i) => row?.name || `source ${i + 1}`

const OPEX_ROWS = projectSchema.find((g) => g.id === 'operatingExpenses').rows
const OPEX_KEYS = OPEX_ROWS.map((r) => r.key)
const OPEX_LABEL = Object.fromEntries(OPEX_ROWS.map((r) => [r.key, r.label]))
// Lines nearly every operating property pays. Taxes and reserves have their own checks below.
const ESSENTIAL_LINES = ['propertyManagement', 'propertyLiabilityInsurance']

// ---------------------------------------------------------------------------------------------
// Dates and the T-12
// ---------------------------------------------------------------------------------------------

// A month as months since year 0 (2026-06 and 2026-06-30 are the same month), so "a year later" is +12.
export const monthIndex = (text) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof text === 'string' ? text.trim() : '')
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}
export const monthLabel = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`

// A timeline date: "2026-03", "2026-03-15", or a year alone ("2026" or 2026, as the workbook asks for). A year alone counts
// as January, the earliest month it could mean, so a loan term counted from it never looks longer than it is.
export function timelineMonth(value) {
  if (isNum(value) && Number.isInteger(value) && value >= 1900 && value <= 2200) return { idx: value * 12, yearOnly: true }
  if (typeof value !== 'string') return null
  const idx = monthIndex(value)
  if (idx !== null) return { idx, yearOnly: false }
  const y = /^(\d{4})$/.exec(value.trim())
  return y ? { idx: Number(y[1]) * 12, yearOnly: true } : null
}

// The T-12 months in date order, one per calendar month (a later row for the same month replaces an earlier one).
export function readT12(record) {
  const rows = Array.isArray(record?.data?.t12?.rows) ? record.data.t12.rows : []
  const byMonth = new Map()
  let undated = 0
  let duplicates = 0
  rows.forEach((row, index) => {
    const idx = row && typeof row === 'object' ? monthIndex(row.month) : null
    if (idx === null) {
      undated++
      return
    }
    if (byMonth.has(idx)) duplicates++
    byMonth.set(idx, { idx, index, row })
  })
  return { entered: rows.length, months: [...byMonth.values()].sort((a, b) => a.idx - b.idx), undated, duplicates }
}

// Months that have a believable value for `key`, with that value.
const monthsWith = (months, key, read = money) => months.map((m) => ({ ...m, value: read(m.row[key]) })).filter((m) => m.value !== null)

// Cell references for one T-12 column: its first and last month (enough to find the column without listing twelve cells).
const t12Cells = (record, months, keys) => {
  const ends = months.length > 1 ? [months[0], months.at(-1)] : months
  return citeCells(record, keys.flatMap((k) => ends.map((m) => `t12.rows.${m.index}.${k}`)))
}

const cells = (record, paths) => citeCells(record, paths).slice(0, 50)
const mergeCells = (...lists) => [...new Set(lists.flat())].slice(0, 50)

// ---------------------------------------------------------------------------------------------
// Shared preparation
// ---------------------------------------------------------------------------------------------

export const APPLIES = { completed: 'full', lease_up: 'partial' }

export function prepare(record, settings, flag) {
  const stage = record.data.stage.stage
  const t12 = readT12(record)
  const ratios = keyRatios(record, settings)
  const trailing = ratios.find((r) => r.id === 'trailing') ?? null
  const dscrRatio = ratios.find((r) => r.id === 'dscr') ?? null
  const asOfText = record.data.stage.asOfDate
  return {
    record,
    stage,
    settings,
    flag,
    t12,
    hasT12: t12.months.length > 0,
    trailing,
    dscrRatio,
    underwritten: noi(record),
    debtService: annualDebtService(record),
    asOf: isValidDate(asOfText) ? monthIndex(asOfText) : null,
    asOfText,
  }
}

// The one "no T-12" flag. The answer key names it M3C-missing-data. It is raised once and shown on the first check.
export function missingT12Flag(ctx) {
  const { t12, stage } = ctx
  const why = t12.entered === 0 ? 'No T-12 is loaded for this project.' : `The T-12 has ${plural(t12.entered, 'row')} but none has a real month, so none can be used.`
  const runs = stage === 'completed' ? 'actuals vs. underwriting, vacancy realism and the T-12 side of expense normalization' : 'the rent roll and expenses to date'
  return ctx.flag({
    id: 'M3C-missing-data',
    severity: 'low',
    title: `The ${stage === 'completed' ? 'completed' : 'lease-up'} risk checks on actual results could not run without a T-12.`,
    evidence: `${why} Without monthly actuals, ${runs} cannot be checked. The checks on the underwriting alone (reserves, property tax line${stage === 'completed' ? ', loan maturity' : ''}) still ran.`,
    cell_refs: t12.entered ? cells(ctx.record, ['t12.rows.0.month']) : [],
    follow_up: 'Please send the trailing 12 months of operating statements (income, expenses and occupancy by month) on the T-12 template.',
  })
}

const row = (id, title, question, status, detail, extra = {}) => ({ id, title, question, status, detail, cells: extra.cells ?? [], flags: extra.flags ?? [] })

// ---------------------------------------------------------------------------------------------
// 1. Actuals vs. underwriting
// ---------------------------------------------------------------------------------------------

const ACTUALS = ['actuals', 'Actuals vs. underwriting', 'Is the property earning what it was underwritten to earn?']

// The T-12 DSCR as M0's DSCR card reports it ("T-12 actual: 2.75×"), which uses each month's own debt service when typed.
function t12Dscr(ctx) {
  for (const line of ctx.dscrRatio?.detail ?? []) {
    const m = /^T-12 actual: (-?[\d.]+)×$/.exec(line)
    if (m && isNum(Number(m[1]))) return Number(m[1])
  }
  return null
}

function rentRollCompare(ctx) {
  const { record, t12 } = ctx
  const rows = Array.isArray(record.data.residentialIncome.rows) ? record.data.residentialIncome.rows : []
  const used = rows
    .map((r, i) => ({ i, units: money(r?.units), rent: money(r?.monthlyRent) }))
    .filter((r) => r.units !== null && r.rent !== null && r.units * r.rent > 0)
  const underwritten = sum(used.map((r) => r.units * r.rent))
  const billed = monthsWith(t12.months, 'residentialRevenue')
  if (underwritten <= 0) return { text: 'No residential rent roll was underwritten, so billed rent could not be compared.' }
  if (billed.length === 0) return { text: 'The T-12 has no residential revenue, so billed rent could not be compared with the rent roll.' }
  const actual = avg(billed.map((m) => m.value))
  const ratio = actual / underwritten
  const text = `Billed residential rent averages ${usd(actual)} a month over ${plural(billed.length, 'month')}, ${pct(ratio)} of the underwritten rent roll of ${usd(underwritten)} a month.`
  const roll = cells(record, used.flatMap((r) => [`residentialIncome.rows.${r.i}.units`, `residentialIncome.rows.${r.i}.monthlyRent`]))
  const refs = mergeCells(roll, t12Cells(record, billed, ['residentialRevenue']))
  if (ratio >= LIMITS.rentRollMedium) return { text, refs }
  const flag = ctx.flag({
    id: 'M3C-rent-roll-below-underwriting',
    severity: ratio < LIMITS.rentRollHigh ? 'high' : 'medium',
    title: 'The rent actually billed is below the rent roll that was underwritten.',
    evidence: `${text} The check looks for at least ${pct(LIMITS.rentRollMedium, 0)}.`,
    cell_refs: refs,
    follow_up: 'Please send the current rent roll by unit. Which units rent below the underwritten rent, and why (concessions, affordability limits, older leases)?',
  })
  return { text, refs, flag }
}

export function checkActuals(ctx) {
  const [id, title, question] = ACTUALS
  if (!ctx.hasT12) return row(id, title, question, 'not_checked', 'No usable T-12 is loaded, so actual results cannot be compared with the underwriting.', { flags: [missingT12Flag(ctx)] })

  const flags = []
  const parts = []
  let refs = []
  if (ctx.stage === 'completed') {
    const t = ctx.trailing
    if (!t || !t.ok) {
      const f = flagFromUnavailable(t ?? { ok: false, reason: 'The T-12 could not be compared with the underwriting.', needs: [] }, {
        module: MODULE_ID,
        stage_used: ctx.stage,
        check: 'actuals',
        checkTitle: 'Actual NOI against the underwritten NOI',
      })
      const roll = rentRollCompare(ctx)
      if (roll.flag) flags.push(roll.flag)
      return row(id, title, question, roll.flag ? 'fail' : 'not_checked', `NOI comparison not available: ${t?.reason ?? 'unknown reason'} ${roll.text}`, {
        cells: roll.refs ?? [],
        flags: [f, ...flags],
      })
    }
    const ratio = t.value
    const needed = ctx.settings.noiVsUnderwritten
    const coverage = t12Dscr(ctx)
    const sentence = t.detail?.[0] ?? `T-12 NOI is ${pct(ratio)} of underwritten NOI`
    const noiText = `${sentence}: ${pct(ratio)} of underwriting (the setting asks for ${pct(needed, 0)}).`
    const dscrText = coverage !== null ? ` Actual DSCR ${fmt.times(coverage)} vs. the ${fmt.times(ctx.settings.minDscr)} minimum.` : ''
    const partial = ctx.t12.months.length < 12 ? ` Only ${plural(ctx.t12.months.length, 'month')} of actuals, annualized, so seasonal swings may not show.` : ''
    parts.push(noiText + dscrText + partial)
    const noiPaths = [
      ...ctx.record.data.residentialIncome.rows.flatMap((_, i) => [`residentialIncome.rows.${i}.units`, `residentialIncome.rows.${i}.monthlyRent`]),
      'residentialIncome.stabilizedVacancy',
      ...OPEX_KEYS.filter((k) => isNum(ctx.record.data.operatingExpenses.lines[k]?.amount)).map((k) => `operatingExpenses.lines.${k}.amount`),
    ]
    refs = mergeCells(t12Cells(ctx.record, ctx.t12.months, ['residentialRevenue', 'noiReported']), cells(ctx.record, noiPaths))
    const dscrShort = coverage !== null && coverage < ctx.settings.minDscr
    if (ratio < needed || dscrShort) {
      const share = ratio / needed
      const severity = dscrShort || share < LIMITS.noiHigh ? 'high' : share < LIMITS.noiMedium ? 'medium' : 'low'
      flags.push(
        ctx.flag({
          id: 'M3C-actuals-vs-underwriting',
          severity,
          title: dscrShort ? 'Actual income does not cover the loan payments by the lender\'s minimum.' : 'The property is earning less than it was underwritten to earn.',
          evidence: `${noiText}${dscrText}${partial}`,
          cell_refs: refs,
          follow_up: 'What explains the gap between actual NOI and the underwriting (lower rents, higher vacancy, higher expenses), and what is the plan and timing to close it?',
        }),
      )
    }
  } else {
    parts.push('The NOI comparison waits until the property is stabilized (it is still filling); only the rent roll to date is checked.')
  }
  const roll = rentRollCompare(ctx)
  parts.push(roll.text)
  if (roll.flag) flags.push(roll.flag)
  refs = mergeCells(refs, roll.refs ?? [])
  return row(id, title, question, flags.length ? 'fail' : 'pass', parts.join(' '), { cells: refs, flags })
}

// ---------------------------------------------------------------------------------------------
// 2. Expense normalization
// ---------------------------------------------------------------------------------------------

const EXPENSES = ['expenses', 'Expense normalization', 'Are the operating expenses complete and at a level the property can sustain?']

function taxCheck(ctx) {
  const { record, t12, asOf } = ctx
  const uwTax = money(record.data.operatingExpenses.lines.propertyTaxes?.amount)
  const taxPath = cells(record, ['operatingExpenses.lines.propertyTaxes.amount'])
  if (!(uwTax > 0)) {
    return {
      text: 'No property taxes are underwritten.',
      flag: ctx.flag({
        id: 'M3C-property-tax-missing',
        severity: 'medium',
        title: 'The underwriting has no property tax expense.',
        evidence: `Property taxes underwritten: ${uwTax === 0 ? usd(0) : 'blank'}. A taxable property usually pays property tax, and taxes are often the largest single expense.`,
        cell_refs: taxPath,
        follow_up: 'Is the property exempt from property tax (and until when), or should a property tax expense be added? Please send the latest tax bill or the exemption letter.',
      }),
    }
  }
  const reasons = []
  const sev = []
  let refs = taxPath
  const taxed = monthsWith(t12.months, 'propertyTaxes')
  if (taxed.length) {
    const annual = avg(taxed.map((m) => m.value)) * 12
    refs = mergeCells(refs, t12Cells(record, taxed, ['propertyTaxes']))
    if (annual > uwTax * LIMITS.taxAbove) {
      reasons.push(`T-12 property taxes run at ${usd(annual)} a year, ${pct(annual / uwTax - 1)} above the ${usd(uwTax)} underwritten.`)
      sev.push('medium')
    }
    if (taxed.length >= 6) {
      const early = avg(taxed.slice(0, 3).map((m) => m.value))
      const recent = avg(taxed.slice(-3).map((m) => m.value))
      if (early > 0 && recent > early * LIMITS.taxAbove) {
        reasons.push(`Monthly property taxes rose from ${usd(early)} (first 3 months) to ${usd(recent)} (last 3 months), up ${pct(recent / early - 1)}: this looks like a reassessment taking effect.`)
        sev.push('medium')
      }
    }
  }
  const done = timelineMonth(record.data.timeline.constructionCompletion)
  if (done && asOf !== null && done.idx <= asOf && asOf - done.idx < LIMITS.recentCompletionMonths && !reasons.length) {
    reasons.push(`Construction finished in ${done.yearOnly ? Math.floor(done.idx / 12) : monthLabel(done.idx)}, ${plural(asOf - done.idx, 'month')} before the as-of date. The tax bill may still reflect the land or partly built value, before the finished building is reassessed.`)
    sev.push('low')
    refs = mergeCells(refs, cells(record, ['timeline.constructionCompletion', 'stage.asOfDate']))
  }
  const base = `Property taxes underwritten at ${usd(uwTax)} a year${taxed.length ? `; the T-12 shows ${usd(avg(taxed.map((m) => m.value)) * 12)} a year` : ''}.`
  if (!reasons.length) return { text: base, refs }
  return {
    text: `${base} ${reasons.join(' ')}`,
    refs,
    flag: ctx.flag({
      id: 'M3C-property-tax-reassessment',
      severity: worst(sev),
      title: 'Property taxes may rise above the underwriting once the property is reassessed.',
      evidence: `${base} ${reasons.join(' ')}`,
      cell_refs: refs,
      follow_up: 'When was the property last assessed, and at what value? Please send the latest tax bill and an estimate of the tax at the full completed value.',
    }),
  }
}

function reserveCheck(ctx) {
  const { record } = ctx
  const reserves = money(record.data.operatingExpenses.lines.replacementReserves?.amount)
  const units = sum((record.data.residentialIncome.rows ?? []).map((r) => money(r?.units)))
  const refs = cells(record, ['operatingExpenses.lines.replacementReserves.amount', ...(record.data.residentialIncome.rows ?? []).map((_, i) => `residentialIncome.rows.${i}.units`)])
  if (!(reserves > 0)) {
    return {
      text: 'No replacement reserves are underwritten.',
      flag: ctx.flag({
        id: 'M3C-reserves-missing',
        severity: 'medium',
        title: 'The underwriting sets nothing aside for replacing roofs, appliances and other building parts.',
        evidence: `Replacement reserves underwritten: ${reserves === 0 ? usd(0) : 'blank'}. Lenders usually expect at least ${usd(LIMITS.reservePerUnit)} a unit a year.`,
        cell_refs: refs,
        follow_up: 'How will capital repairs be paid for? Please add a replacement reserve and say how much is in the reserve account today.',
      }),
    }
  }
  if (units > 0) {
    const perUnit = reserves / units
    const text = `Replacement reserves ${usd(reserves)} a year on ${plural(units, 'unit')}: ${usd(perUnit)} a unit.`
    if (perUnit >= LIMITS.reservePerUnit) return { text, refs }
    return {
      text,
      refs,
      flag: ctx.flag({
        id: 'M3C-reserves-low',
        severity: 'low',
        title: 'Replacement reserves are thin for the number of units.',
        evidence: `${text} The usual lender minimum is ${usd(LIMITS.reservePerUnit)} a unit a year.`,
        cell_refs: refs,
        follow_up: 'Is there a recent property condition report? Please explain why reserves below the usual minimum are enough.',
      }),
    }
  }
  return { text: `Replacement reserves ${usd(reserves)} a year.`, refs }
}

function linesCheck(ctx) {
  const { record, t12 } = ctx
  const lines = record.data.operatingExpenses.lines
  const missingUw = ESSENTIAL_LINES.filter((k) => !(money(lines[k]?.amount) > 0))
  // Lines the property actually pays (per the T-12) that the underwriting leaves out. Taxes and reserves are checked above.
  const paidNotUw = OPEX_KEYS.filter((k) => !['propertyTaxes', 'replacementReserves'].includes(k))
    .filter((k) => !(money(lines[k]?.amount) > 0))
    .map((k) => ({ k, paid: monthsWith(t12.months, k) }))
    .filter((x) => sum(x.paid.map((m) => m.value)) > 0)
  if (!missingUw.length && !paidNotUw.length) {
    return { text: `Management and insurance are underwritten${ctx.hasT12 ? ', and no expense paid in the T-12 is missing from the underwriting' : ''}.` }
  }
  const parts = []
  if (paidNotUw.length) {
    parts.push(`Paid in the T-12 but not underwritten: ${paidNotUw.map((x) => `${OPEX_LABEL[x.k].toLowerCase()} (${usd(avg(x.paid.map((m) => m.value)) * 12)} a year)`).join(', ')}.`)
  }
  const stillMissing = missingUw.filter((k) => !paidNotUw.some((x) => x.k === k))
  if (stillMissing.length) parts.push(`${ctx.hasT12 ? 'Not underwritten and not in the T-12' : 'Not underwritten'}: ${stillMissing.map((k) => OPEX_LABEL[k].toLowerCase()).join(', ')}.`)
  const refs = mergeCells(
    cells(record, [...new Set([...missingUw, ...paidNotUw.map((x) => x.k)])].map((k) => `operatingExpenses.lines.${k}.amount`)),
    ...paidNotUw.map((x) => t12Cells(record, x.paid, [x.k])),
  )
  return {
    text: parts.join(' '),
    refs,
    flag: ctx.flag({
      id: 'M3C-expense-lines-missing',
      severity: paidNotUw.length ? 'medium' : 'low',
      title: 'Some expenses an operating property normally pays are missing from the underwriting.',
      evidence: parts.join(' '),
      cell_refs: refs,
      follow_up: 'Please confirm who pays each missing expense (owner, tenant or a related party) and add the yearly cost to the operating budget if the owner pays it.',
    }),
  }
}

function totalExpenseCheck(ctx) {
  const { record, t12, underwritten } = ctx
  const withExpenses = t12.months.filter((m) => [...OPEX_KEYS, 'otherExpenses'].some((k) => money(m.row[k]) !== null))
  if (!withExpenses.length) return { text: 'The T-12 has no expense lines, so total expenses could not be compared.' }
  if (!underwritten.ok || !(underwritten.expenses > 0)) return { text: 'Underwritten expenses are not available, so the T-12 expenses could not be compared.' }
  const actual = avg(withExpenses.map((m) => sum([...OPEX_KEYS, 'otherExpenses'].map((k) => money(m.row[k]))))) * 12
  const ratio = actual / underwritten.expenses
  const text = `T-12 expenses run at ${usd(actual)} a year over ${plural(withExpenses.length, 'month')}, ${pct(ratio)} of the ${usd(underwritten.expenses)} underwritten.`
  const refs = mergeCells(
    t12Cells(record, withExpenses, OPEX_KEYS.filter((k) => withExpenses.some((m) => money(m.row[k]) !== null)).slice(0, 6)),
    cells(record, OPEX_KEYS.filter((k) => isNum(record.data.operatingExpenses.lines[k]?.amount)).map((k) => `operatingExpenses.lines.${k}.amount`)),
  )
  if (ratio <= LIMITS.expenseMedium) return { text, refs }
  return {
    text,
    refs,
    flag: ctx.flag({
      id: 'M3C-expenses-above-underwriting',
      severity: ratio > LIMITS.expenseHigh ? 'high' : 'medium',
      title: 'The property is spending more to operate than the underwriting assumes.',
      evidence: `${text} The check allows up to ${pct(LIMITS.expenseMedium - 1, 0)} above.`,
      cell_refs: refs,
      follow_up: 'Which expense lines are running above budget, are they one-time or recurring, and what budget should be used going forward?',
    }),
  }
}

export function checkExpenses(ctx) {
  const [id, title, question] = EXPENSES
  const results = [taxCheck(ctx), reserveCheck(ctx), linesCheck(ctx)]
  if (ctx.hasT12) results.push(totalExpenseCheck(ctx))
  const flags = results.map((r) => r.flag).filter(Boolean)
  let detail = results.map((r) => r.text).join(' ')
  if (!ctx.hasT12) detail += ' No T-12 is loaded, so actual expenses could not be compared with the underwriting.'
  if (ctx.stage === 'lease_up' && ctx.hasT12) detail = `Expenses to date (the property is still filling). ${detail}`
  return row(id, title, question, flags.length ? 'fail' : 'pass', detail, { cells: mergeCells(...results.map((r) => r.refs ?? [])), flags })
}

// ---------------------------------------------------------------------------------------------
// 3. Vacancy realism
// ---------------------------------------------------------------------------------------------

const VACANCY = ['vacancy', 'Vacancy realism', 'Is the vacancy assumption supported by the occupancy the property has actually had?']

export function checkVacancy(ctx) {
  const [id, title, question] = VACANCY
  const { record, t12, stage, settings } = ctx
  if (stage !== 'completed') {
    return row(id, title, question, 'not_applicable', 'The property is still filling, so its occupancy today does not test the stabilized vacancy assumption. The lease-up checks (M3T) follow the occupancy trend; this check runs once the project is completed.')
  }
  const resRows = record.data.residentialIncome.rows ?? []
  const hasResidential = resRows.some((r) => money(r?.units) > 0 && money(r?.monthlyRent) > 0)
  if (!hasResidential) return row(id, title, question, 'not_applicable', 'No residential units are underwritten, so there is no residential vacancy assumption to test.')
  const assumedRaw = record.data.residentialIncome.stabilizedVacancy
  const assumed = share(assumedRaw)
  const vacancyCell = cells(record, ['residentialIncome.stabilizedVacancy'])
  if (assumed === null) {
    const f = missingDataFlag({
      module: MODULE_ID,
      stage_used: stage,
      check: 'vacancy',
      checkTitle: 'Vacancy realism',
      missing: isNum(assumedRaw) ? `a believable residential vacancy (it is ${assumedRaw}; type it like 5%)` : 'the residential vacancy assumption',
      cell_refs: vacancyCell,
    })
    return row(id, title, question, 'not_checked', 'The residential vacancy assumption is blank or not believable.', { cells: vacancyCell, flags: [f] })
  }
  if (!ctx.hasT12) return row(id, title, question, 'not_checked', `Vacancy is assumed at ${pct(assumed)}, but no T-12 is loaded to test it against.`, { cells: vacancyCell })

  const occ = monthsWith(t12.months, 'occupancy', share)
  let actual
  let basis
  let refs
  if (occ.length) {
    actual = 1 - avg(occ.map((m) => m.value))
    basis = `average occupancy ${pct(1 - actual)} over ${plural(occ.length, 'month')} (${monthLabel(occ[0].idx)} to ${monthLabel(occ.at(-1).idx)})`
    refs = mergeCells(vacancyCell, t12Cells(record, occ, ['occupancy']))
  } else {
    // No occupancy column: fall back to the rent lost to vacancy as a share of residential rent billed.
    const both = t12.months.filter((m) => money(m.row.residentialRevenue) > 0 && isNum(m.row.vacancyLoss))
    if (!both.length) {
      const f = missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'vacancy',
        checkTitle: 'Vacancy realism',
        missing: 'monthly occupancy (or vacancy loss with residential revenue) in the T-12',
        cell_refs: vacancyCell,
      })
      return row(id, title, question, 'not_checked', `Vacancy is assumed at ${pct(assumed)}, but the T-12 has no occupancy or vacancy loss to test it against.`, { cells: vacancyCell, flags: [f] })
    }
    actual = Math.min(1, sum(both.map((m) => Math.abs(m.row.vacancyLoss))) / sum(both.map((m) => m.row.residentialRevenue)))
    basis = `rent lost to vacancy of ${pct(actual)} over ${plural(both.length, 'month')} (no occupancy column, so vacancy loss was used)`
    refs = mergeCells(vacancyCell, t12Cells(record, both, ['vacancyLoss', 'residentialRevenue']))
  }
  const latest = occ.at(-1)
  const belowFloor = latest && latest.value < settings.occupancyFloor
  const gap = actual - assumed
  const short = t12.months.length < 12 ? ` Only ${plural(t12.months.length, 'month')} of history, so a full year of seasons is not covered.` : ''
  const floorText = latest ? ` Latest occupancy ${pct(latest.value, 0)} in ${monthLabel(latest.idx)} (floor ${pct(settings.occupancyFloor, 0)}).` : ''
  const text = `Vacancy assumed at ${pct(assumed)}; actual vacancy ${pct(actual)} from ${basis}.${floorText}${short}`
  if (gap <= LIMITS.vacancyMedium && !belowFloor) return row(id, title, question, 'pass', text, { cells: refs })
  const severity = gap > LIMITS.vacancyHigh ? 'high' : 'medium'
  const f = ctx.flag({
    id: 'M3C-vacancy-unsupported',
    severity,
    title: gap > LIMITS.vacancyMedium ? 'The vacancy assumption is lower than the vacancy the property has actually had.' : 'Occupancy has fallen below the floor, even though the vacancy assumption is in line on average.',
    evidence: `${text} The check allows actual vacancy up to ${pct(LIMITS.vacancyMedium, 0)} points above the assumption.`,
    cell_refs: refs,
    follow_up: 'Why has occupancy been below the underwritten level, and what supports the vacancy assumption going forward (current leasing, waitlist, market vacancy)?',
  })
  return row(id, title, question, 'fail', text, { cells: refs, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 4. Debt maturity or reset
// ---------------------------------------------------------------------------------------------

const DEBT = ['debt', 'Debt maturity or reset', 'When does each loan mature or reset, and could it be refinanced on today\'s numbers?']
const RESET_NOTE = 'The applicant form records one fixed rate per loan and no reset date, so a rate reset cannot be seen here.'

export function checkDebt(ctx) {
  const [id, title, question] = DEBT
  const { record, stage, asOf, settings } = ctx
  if (stage !== 'completed') {
    return row(id, title, question, 'not_applicable', 'While the property is still filling, the construction loan and its takeout are checked by the development and lease-up checks (M3D and M3T). This check runs once the project is completed.')
  }
  const rows = Array.isArray(record.data.sources.rows) ? record.data.sources.rows : []
  const loans = rows.map((r, i) => ({ r, i, name: sourceName(r, i) })).filter(({ r }) => r && DEBT_SOURCE_TYPES.includes(r.type) && money(r.amount) > 0)
  if (!loans.length) return row(id, title, question, 'not_applicable', `No loans (hard, government or mezzanine debt) are in the sources table, so there is nothing to mature. ${RESET_NOTE}`)

  const missing = []
  if (asOf === null) missing.push('the "as of" date of the review')
  const startBy = [
    ['stabilization', 'timeline.stabilization'],
    ['construction completion', 'timeline.constructionCompletion'],
  ]
    .map(([label, path]) => ({ label, path, when: timelineMonth(record.data.timeline[path.split('.')[1]]) }))
    .find((s) => s.when)
  if (!startBy) missing.push('the stabilization or construction completion date (the loan term is counted from it)')

  const dated = []
  for (const loan of loans) {
    const term = loan.r.termMonths
    const rate = loan.r.interestRate
    const termOk = isNum(term) && Number.isInteger(term) && term >= 1 && term <= 1200
    if (!termOk) missing.push(`the term in months of "${loan.name}"`)
    if (share(rate) === null) missing.push(`the interest rate of "${loan.name}"`)
    if (termOk && startBy && asOf !== null) dated.push({ ...loan, term, rate: share(rate), maturity: startBy.when.idx + term, left: startBy.when.idx + term - asOf })
  }

  const flags = []
  const baseCells = cells(record, ['stage.asOfDate', ...(startBy ? [startBy.path] : [])])
  const loanCells = (list) => cells(record, list.flatMap((l) => [`sources.rows.${l.i}.amount`, `sources.rows.${l.i}.termMonths`, `sources.rows.${l.i}.interestRate`]))
  if (missing.length) {
    flags.push(
      missingDataFlag({
        module: MODULE_ID,
        stage_used: stage,
        check: 'debt-maturity',
        checkTitle: 'Loan maturity',
        missing,
        cell_refs: mergeCells(baseCells, loanCells(loans)),
      }),
    )
  }

  const coverage = dscr(record)
  const coverageText = coverage.ok ? `DSCR today ${fmt.times(coverage.value)} vs. the ${fmt.times(settings.minDscr)} minimum.` : `DSCR today is not available (${coverage.reason})`
  const describe = (l) => {
    const when = l.left <= 0 ? `matured ${plural(-l.left, 'month')} before the as-of date` : `${plural(l.left, 'month')} after the as-of date`
    return `"${l.name}" ${usd(l.r.amount)}${l.rate !== null ? ` at ${pct(l.rate, 2)}` : ''} over ${l.term} months, counted from ${startBy.label} ${monthLabel(startBy.when.idx)}${startBy.when.yearOnly ? ' (year only, so January was used)' : ''}: matures ${monthLabel(l.maturity)}, ${when}`
  }
  const soon = dated.filter((l) => l.left <= LIMITS.maturityMedium).sort((a, b) => a.left - b.left)
  const summary = dated.length ? `${dated.map(describe).join('; ')}.` : ''
  if (soon.length) {
    const nearest = soon[0].left
    const weak = coverage.ok && coverage.value < settings.minDscr
    const severity = nearest <= LIMITS.maturityHigh || weak ? 'high' : 'medium'
    flags.push(
      ctx.flag({
        id: 'M3C-debt-maturity',
        severity,
        title: nearest <= 0 ? 'A loan on this property is already past its maturity date.' : `A loan on this property matures within ${nearest <= LIMITS.maturityHigh ? 'a year' : 'three years'} and will need to be refinanced or paid off.`,
        evidence: `${soon.map(describe).join('; ')}. ${coverageText} ${RESET_NOTE}`,
        cell_refs: mergeCells(baseCells, loanCells(soon)),
        follow_up: 'What is the plan to refinance or repay this loan at maturity: lender, expected rate and loan amount? Does the rate reset or float before then, and has a lender confirmed the property meets its refinance tests at today\'s rates?',
        transition: 'T3',
      }),
    )
  }
  const detail = [summary, dated.length ? coverageText : '', RESET_NOTE].filter(Boolean).join(' ')
  const status = soon.length ? 'fail' : missing.length ? 'not_checked' : 'pass'
  return row(id, title, question, status, detail || 'Loan maturity could not be worked out.', {
    cells: mergeCells(baseCells, loanCells(loans)),
    flags,
  })
}

export const CHECKS = [checkActuals, checkExpenses, checkVacancy, checkDebt]
export const CHECK_INFO = [ACTUALS, EXPENSES, VACANCY, DEBT].map(([id, title, question]) => ({ id, title, question }))
