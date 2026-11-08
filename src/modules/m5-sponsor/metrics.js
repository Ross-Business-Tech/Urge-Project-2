// M5: the firm-level figures (layer 5). "Does this sponsor have the track record and cash to deliver, and can they absorb
// a miss?"
//
// sponsorSummary(firm, projects, context) builds the whole sponsor picture:
//   globalDscr     sum of NOI over sum of yearly debt service across the sponsor's projects that have usable numbers,
//                  with the projects left out and why
//   liquidity      the firm's cash and liquid assets against what it owes in the short term (and with the principal's
//                  personal cash added)
//   feeDependence  how much of the firm's income is fees, and whether fees still cover overhead
//   trackRecord    every project, its stage, the firm's share and its coverage
//   credibility    projected vs. delivered (budget, schedule, rents, stabilization) for the sponsor's COMPLETED projects,
//                  scored 0 to 100
// Every figure is either { ok: true, value, ... } or { ok: false, reason }. A missing input is never counted as zero.
//
// context (all optional):
//   settings      the lender's thresholds (section 1f)
//   project       the project under review (its "as of" date decides which fiscal years are history)
//   asOfDate      overrides the project's "as of" date
//   trackRecord   { [projectId or project name]: { finalCost, plannedCompletion, plannedStabilization } }
//                 The applicant workbook has no place for a finished project's ORIGINAL budget and dates, so the budget
//                 and schedule comparisons are "not available" unless these are supplied.

import { noi, annualDebtService, totalDevelopmentCost, keyRatios, sanitizeSettings, fmt, STAGES } from '../shared/index.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const na = (reason, extra = {}) => ({ ok: false, reason, ...extra })
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.value, s.label]))
export const stageLabel = (stage) => STAGE_LABEL[stage] ?? 'Stage not chosen'

// Liquidity cover the underwriter would be comfortable with, and the bands of the credibility score.
export const LIQUIDITY_COMFORT = 1.5
export const SCORE_BANDS = { strong: 80, mixed: 50 }

// A money amount from the firm record. Blank gives null; a value that is not believable is refused with its name.
class Refused extends Error {}
function money(value, label) {
  if (value === null || value === undefined || value === '') return null
  if (!isNum(value) || value < 0 || value > 1e12) throw new Refused(`${label} is ${String(value)}, which is not a believable amount.`)
  return value
}

// Runs one section; a refused input or a broken record becomes "not available" instead of a crash.
function section(fn, what) {
  try {
    return fn()
  } catch (e) {
    if (e instanceof Refused) return na(e.message)
    return na(`The ${what} could not be worked out because part of the record could not be read.`)
  }
}

const firmData = (firm) => (isObject(firm) && isObject(firm.data) ? firm.data : null)

// ---------------------------------------------------------------------------------------------
// Liquidity: cash and liquid assets against obligations
// ---------------------------------------------------------------------------------------------

const FIRM_LIQUID = [
  ['cash', 'Cash'],
  ['pettyCash', 'Petty cash'],
  ['temporaryInvestments', 'Temporary investments'],
]
const FIRM_SHORT_TERM = [
  ['accountsPayable', 'Accounts payable'],
  ['businessCreditCards', 'Business credit cards'],
  ['salesTaxPayable', 'Sales tax payable'],
  ['payrollLiabilities', 'Payroll liabilities'],
  ['otherLiabilities', 'Other liabilities'],
  ['currentPortionLongTermDebt', 'Current portion of long-term debt'],
]
const FIRM_LONG_TERM = [
  ['notesPayable', 'Notes payable'],
  ['mortgagePayable', 'Mortgage payable'],
]
const PRINCIPAL_LIQUID = [
  ['cashChecking', 'Cash: checking accounts'],
  ['cashSavings', 'Cash: savings accounts'],
  ['certificatesOfDeposit', 'Certificates of deposit'],
  ['securities', 'Securities'],
]

// Adds up some balance sheet lines for one period. Returns { total, entered, paths } (total is null when nothing is entered).
function lines(group, keys, column, base) {
  const out = { total: null, entered: [], paths: [] }
  for (const [key, label] of keys) {
    const v = money(group?.lines?.[key]?.[column], `${label} (${column === 'prior' ? 'prior period' : 'current period'})`)
    if (v === null) continue
    out.total = (out.total ?? 0) + v
    out.entered.push(label)
    out.paths.push(`${base}.lines.${key}.${column}`)
  }
  return out
}

export function liquidity(firm) {
  return section(() => {
    const d = firmData(firm)
    if (!d) return na('There is no firm record.')
    const bs = d.balanceSheet
    const liquid = lines(bs, FIRM_LIQUID, 'current', 'balanceSheet')
    const shortTerm = lines(bs, FIRM_SHORT_TERM, 'current', 'balanceSheet')
    const longTerm = lines(bs, FIRM_LONG_TERM, 'current', 'balanceSheet')
    const priorLiquid = lines(bs, FIRM_LIQUID, 'prior', 'balanceSheet')
    const priorLong = lines(bs, FIRM_LONG_TERM, 'prior', 'balanceSheet')
    const principal = lines(d.principalStatement, PRINCIPAL_LIQUID, 'amount', 'principalStatement')
    const paths = [...liquid.paths, ...shortTerm.paths, ...longTerm.paths, ...priorLiquid.paths, ...principal.paths]
    const facts = {
      firmLiquid: liquid.total,
      shortTerm: shortTerm.total,
      longTermDebt: longTerm.total,
      priorLiquid: priorLiquid.total,
      priorLongTermDebt: priorLong.total,
      principalLiquid: principal.total,
      period: typeof bs?.currentPeriod === 'string' || isNum(bs?.currentPeriod) ? String(bs.currentPeriod) : null,
      paths,
      guarantees: 'The workbook has no place for guarantees the firm or principal have given, so they are not counted.',
    }
    if (liquid.total === null) return na('The firm balance sheet has no cash or liquid assets entered (current period).', facts)
    if (shortTerm.total === null) return na('The firm balance sheet has no short-term obligations entered (accounts payable, credit cards, current debt and the like).', facts)
    if (shortTerm.total === 0) return na('The firm reports no short-term obligations, so there is nothing for its cash to cover.', { ...facts, nothingOwed: true })
    const value = liquid.total / shortTerm.total
    const withPrincipal = principal.total === null ? null : (liquid.total + principal.total) / shortTerm.total
    const allDebt = shortTerm.total + (longTerm.total ?? 0)
    return { ok: true, value, withPrincipal, liquidToAllDebt: allDebt > 0 ? liquid.total / allDebt : null, ...facts }
  }, 'liquidity cover')
}

// ---------------------------------------------------------------------------------------------
// Fee dependence: how much of the firm's income is fees, and do fees cover overhead
// ---------------------------------------------------------------------------------------------

const FEE_KEYS = ['developerFee', 'propertyManagementFee', 'gcFee', 'assetManagementFee', 'otherFee1', 'otherFee2', 'otherFee3']
const OTHER_INCOME_KEYS = ['operatingCashDistributions', 'nonFeeIncome']
const OVERHEAD_KEYS = [
  'salariesWages',
  'leaseExpense',
  'utilities',
  'marketing',
  'insurance',
  'mealsEntertainment',
  'travel',
  'technologyTelecom',
  'officeSupplies',
  'legalProfessional',
  'otherExpense1',
  'otherExpense2',
]

const yearOf = (date) => {
  const m = /^(\d{4})/.exec(typeof date === 'string' ? date : '')
  return m ? Number(m[1]) : null
}

function yearFigures(row, i) {
  const read = (keys) => {
    const vals = keys.map((k) => money(row[k], `${k} for ${row.fiscalYear}`))
    return { total: vals.some(isNum) ? sum(vals) : null, paths: keys.filter((k, j) => isNum(vals[j])).map((k) => `earnings.rows.${i}.${k}`) }
  }
  const fees = read(FEE_KEYS)
  const other = read(OTHER_INCOME_KEYS)
  const overhead = read(OVERHEAD_KEYS)
  const developerFee = money(row.developerFee, `developerFee for ${row.fiscalYear}`)
  return {
    year: row.fiscalYear,
    fees: fees.total,
    otherIncome: other.total,
    overhead: overhead.total,
    developerFee,
    paths: [`earnings.rows.${i}.fiscalYear`, ...fees.paths, ...other.paths, ...overhead.paths],
  }
}

export function feeDependence(firm, asOfDate) {
  return section(() => {
    const d = firmData(firm)
    if (!d) return na('There is no firm record.')
    const rows = Array.isArray(d.earnings?.rows) ? d.earnings.rows : []
    const asOfYear = yearOf(asOfDate)
    let years = rows.map((r, i) => (isObject(r) && isNum(r.fiscalYear) ? yearFigures(r, i) : null)).filter(Boolean)
    const projections = asOfYear ? years.filter((y) => y.year > asOfYear).length : 0
    if (asOfYear) years = years.filter((y) => y.year <= asOfYear)
    years = years.filter((y) => y.fees !== null || y.otherIncome !== null).sort((a, b) => a.year - b.year)
    const facts = { history: years, projectionsLeftOut: projections }
    if (!years.length) return na('The firm earnings table has no fee or other income entered for a year up to the "as of" date.', facts)
    const latest = years.at(-1)
    const prior = years.length > 1 ? years.at(-2) : null
    const peak = years.reduce((best, y) => ((y.fees ?? 0) > (best.fees ?? 0) ? y : best), years[0])
    const fees = latest.fees ?? 0
    const income = fees + (latest.otherIncome ?? 0)
    const result = {
      ...facts,
      year: latest.year,
      fees,
      otherIncome: latest.otherIncome,
      overhead: latest.overhead,
      developerFee: latest.developerFee,
      feeCoverOfOverhead: isNum(latest.overhead) && latest.overhead > 0 ? fees / latest.overhead : null,
      priorYear: prior?.year ?? null,
      priorFees: prior ? prior.fees ?? 0 : null,
      change: prior && (prior.fees ?? 0) > 0 ? (fees - prior.fees) / prior.fees : null,
      peakYear: peak.year,
      peakFees: peak.fees ?? 0,
      developerFeeShare: fees > 0 && isNum(latest.developerFee) ? latest.developerFee / fees : null,
      paths: [...(prior?.paths ?? []), ...latest.paths],
    }
    if (income <= 0) return na(`The firm reported no income in ${latest.year}, so there is nothing to divide fees by.`, result)
    return { ok: true, value: fees / income, ...result }
  }, 'fee dependence')
}

// ---------------------------------------------------------------------------------------------
// The sponsor's projects
// ---------------------------------------------------------------------------------------------

const projectIdOf = (record) => (typeof record?.meta?.projectId === 'string' ? record.meta.projectId : null)

// Accepts records, or { record } wrappers, and skips anything that is not a project record (saying so).
export function normalizeProjects(projects, current) {
  const list = Array.isArray(projects) ? projects : []
  const records = []
  const skipped = []
  list.forEach((item, i) => {
    const record = isObject(item) && isObject(item.data) ? item : isObject(item?.record) && isObject(item.record.data) ? item.record : null
    if (record) records.push(record)
    else skipped.push(`Item ${i + 1} in the project list is not a project record.`)
  })
  if (isObject(current) && isObject(current.data)) {
    const id = projectIdOf(current)
    const present = records.some((r) => r === current || (id && projectIdOf(r) === id))
    if (!present) records.push(current)
  }
  return { records, skipped }
}

function nameOf(record, i) {
  const name = record?.data?.identity?.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  return projectIdOf(record) ?? `Project ${i + 1}`
}

function ownershipOf(firm, record) {
  const id = projectIdOf(record)
  const rows = firmData(firm)?.projects?.rows
  if (!id || !Array.isArray(rows)) return null
  const row = rows.find((r) => isObject(r) && r.projectId === id)
  return isNum(row?.ownershipPct) && row.ownershipPct >= 0 && row.ownershipPct <= 1 ? row.ownershipPct : null
}

function projectFigures(record) {
  try {
    const n = noi(record)
    if (!n.ok) return { usable: false, reason: `NOI not available: ${n.reason}` }
    const ds = annualDebtService(record)
    if (!ds.ok) return { usable: false, noi: n.value, reason: `Debt service not available: ${ds.reason}` }
    return { usable: true, noi: n.value, debtService: ds.value, dscr: ds.value > 0 ? n.value / ds.value : null }
  } catch {
    return { usable: false, reason: 'The project record could not be read.' }
  }
}

export function globalDscr(rows) {
  const used = rows.filter((r) => r.usable)
  const excluded = rows.filter((r) => !r.usable).map((r) => ({ name: r.name, reason: r.reason }))
  const cover = (list) => {
    const ds = sum(list.map((r) => r.debtService))
    if (!list.length) return na('No project has both NOI and debt service that can be worked out.')
    if (ds <= 0) return na('None of the projects with usable numbers has loan payments to cover.')
    return { ok: true, value: sum(list.map((r) => r.noi)) / ds, noi: sum(list.map((r) => r.noi)), debtService: ds, count: list.length }
  }
  const all = cover(used)
  const operating = cover(used.filter((r) => r.stage === 'lease_up' || r.stage === 'completed'))
  return { ...all, included: used.map((r) => r.name), excluded, operating }
}

// ---------------------------------------------------------------------------------------------
// Credibility: projected vs. delivered on the sponsor's completed projects
// ---------------------------------------------------------------------------------------------

const POINTS = { delivered: 1, close: 0.5, missed: 0 }
export const MEASURES = [
  { id: 'budget', label: 'Budget' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'rents', label: 'Rents' },
  { id: 'stabilization', label: 'Stabilization' },
]

// Months since year 0 for "2026", "2026-03" or "2026-03-15". A year alone counts as its first month.
const monthIndex = (text) => {
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2]))?(?:-\d{2})?$/.exec(typeof text === 'string' ? text.trim() : isNum(text) ? String(text) : '')
  return m ? { idx: Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0), yearOnly: !m[2] } : null
}

const lookupHistory = (trackRecord, record, name) => {
  if (!isObject(trackRecord)) return {}
  const id = projectIdOf(record)
  const entry = (id && trackRecord[id]) || trackRecord[name]
  return isObject(entry) ? entry : {}
}

function budgetMeasure(record, history) {
  const projected = totalDevelopmentCost(record)
  if (!projected.ok) return na(`No original budget in the record (${projected.reason.replace(/\.$/, '')}).`)
  const final = isNum(history.finalCost) && history.finalCost > 0 ? history.finalCost : null
  if (final === null) return na('The workbook has no place for the final cost of a finished project.', { projected: fmt.usd(projected.value) })
  const over = (final - projected.value) / projected.value
  const status = over <= 0.02 ? 'delivered' : over <= 0.1 ? 'close' : 'missed'
  return { ok: true, status, projected: fmt.usd(projected.value), delivered: `${fmt.usd(final)} (${over >= 0 ? '+' : ''}${fmt.pct(over)})` }
}

function scheduleMeasure(record, history) {
  const actual = monthIndex(record.data.timeline?.constructionCompletion)
  const planned = monthIndex(history.plannedCompletion)
  if (!actual) return na('The construction completion date is not entered.')
  if (!planned) return na('The workbook has no place for the originally planned completion date of a finished project.', { delivered: String(record.data.timeline.constructionCompletion) })
  const yearly = actual.yearOnly || planned.yearOnly
  const late = yearly ? (Math.floor(actual.idx / 12) - Math.floor(planned.idx / 12)) * 12 : actual.idx - planned.idx
  const status = late <= 0 ? 'delivered' : late <= 3 ? 'close' : 'missed'
  const words = late <= 0 ? 'on time' : yearly ? `${late / 12} year${late === 12 ? '' : 's'} late` : `${late} month${late === 1 ? '' : 's'} late`
  return { ok: true, status, projected: String(history.plannedCompletion), delivered: `${record.data.timeline.constructionCompletion} (${words})` }
}

function rentsMeasure(record) {
  const rows = Array.isArray(record.data.residentialIncome?.rows) ? record.data.residentialIncome.rows : []
  const good = rows.filter((r) => isNum(r?.units) && isNum(r?.monthlyRent) && r.units >= 0 && r.monthlyRent >= 0 && r.monthlyRent < 1e7)
  const projected = sum(good.map((r) => r.units * r.monthlyRent))
  if (projected <= 0) return na('No underwritten residential rents in the record.')
  const months = (Array.isArray(record.data.t12?.rows) ? record.data.t12.rows : []).filter((m) => isNum(m?.residentialRevenue) && m.residentialRevenue >= 0)
  if (!months.length) return na('No T-12 residential revenue to compare with.', { projected: `${fmt.usd(projected)} a month` })
  const achieved = sum(months.map((m) => m.residentialRevenue - Math.abs(isNum(m.concessions) ? m.concessions : 0))) / months.length
  const share = achieved / projected
  const status = share >= 0.98 ? 'delivered' : share >= 0.92 ? 'close' : 'missed'
  return { ok: true, status, projected: `${fmt.usd(projected)} a month`, delivered: `${fmt.usd(achieved)} a month after free rent (${fmt.pct(share, 0)} of plan, ${months.length} month${months.length === 1 ? '' : 's'})` }
}

function stabilizationMeasure(record, settings) {
  const trailing = keyRatios(record, settings).find((r) => r.id === 'trailing')
  const when = record.data.timeline?.stabilization
  const projectedText = `Stable${when ? ` by ${when}` : ''} at the underwritten NOI`
  if (!trailing || !trailing.ok) return na(trailing?.reason ?? 'The stability test could not run.', { projected: projectedText })
  const streak = isNum(trailing.streak) ? trailing.streak : 0
  const enough = streak >= settings.consecutiveMonths
  const status = enough && trailing.value >= settings.noiVsUnderwritten ? 'delivered' : trailing.value >= 0.9 || streak > 0 ? 'close' : 'missed'
  return {
    ok: true,
    status,
    projected: projectedText,
    delivered: `T-12 NOI ${fmt.pct(trailing.value, 0)} of underwritten; ${streak} month${streak === 1 ? '' : 's'} in a row pass (needs ${settings.consecutiveMonths})`,
  }
}

function credibilityRow(record, name, settings, trackRecord) {
  const history = lookupHistory(trackRecord, record, name)
  const measures = {}
  const guard = (fn) => {
    try {
      return fn()
    } catch {
      return na('This part of the record could not be read.')
    }
  }
  measures.budget = guard(() => budgetMeasure(record, history))
  measures.schedule = guard(() => scheduleMeasure(record, history))
  measures.rents = guard(() => rentsMeasure(record))
  measures.stabilization = guard(() => stabilizationMeasure(record, settings))
  return { name, projectId: projectIdOf(record), measures }
}

export function scoreBand(score) {
  if (!isNum(score)) return null
  return score >= SCORE_BANDS.strong ? 'strong' : score >= SCORE_BANDS.mixed ? 'mixed' : 'weak'
}

export function credibility(rows) {
  const counted = rows.flatMap((r) => MEASURES.map((m) => r.measures[m.id]).filter((x) => x.ok))
  const possible = rows.length * MEASURES.length
  const base = { rows, counted: counted.length, possible }
  if (!rows.length) return na('The sponsor has no completed projects in this application, so there is no delivery record to score.', { ...base, noCompleted: true })
  if (!counted.length) return na('None of the completed projects has enough data to compare what was projected with what was delivered.', base)
  const score = Math.round((sum(counted.map((x) => POINTS[x.status])) / counted.length) * 100)
  const missed = counted.filter((x) => x.status === 'missed').length
  return { ok: true, value: score, band: scoreBand(score), missed, ...base }
}

// ---------------------------------------------------------------------------------------------
// The whole sponsor picture
// ---------------------------------------------------------------------------------------------

export function sponsorSummary(firm, projects, context = {}) {
  const ctx = isObject(context) ? context : {}
  const settings = sanitizeSettings(ctx.settings)
  const notes = []
  const d = firmData(firm)

  const { records, skipped } = normalizeProjects(projects, ctx.project)
  notes.push(...skipped)

  const rows = records.map((record, i) => {
    const name = nameOf(record, i)
    let stage = null
    try {
      stage = record.data.stage?.stage ?? null
    } catch {
      stage = null
    }
    return { name, projectId: projectIdOf(record), stage, stageLabel: stageLabel(stage), ownership: ownershipOf(firm, record), record, ...projectFigures(record) }
  })

  const asOfDate = typeof ctx.asOfDate === 'string' ? ctx.asOfDate : ctx.project?.data?.stage?.asOfDate ?? rows.map((r) => r.record.data.stage?.asOfDate).filter((x) => typeof x === 'string').sort().at(-1) ?? null

  const coverCount = (key) => (d && isNum(d.identity?.[key]) ? d.identity[key] : null)
  const counts = {
    total: rows.length,
    development: rows.filter((r) => r.stage === 'development').length,
    lease_up: rows.filter((r) => r.stage === 'lease_up').length,
    completed: rows.filter((r) => r.stage === 'completed').length,
    noStage: rows.filter((r) => !STAGE_LABEL[r.stage]).length,
    coverDevelopment: coverCount('developmentProjectCount'),
    coverCompleted: coverCount('completedProjectCount'),
  }

  const completedRows = rows.filter((r) => r.stage === 'completed')
  let cred
  try {
    cred = credibility(completedRows.map((r) => credibilityRow(r.record, r.name, settings, ctx.trackRecord)))
  } catch {
    cred = na('The credibility score could not be worked out because a completed project could not be read.', { rows: [], counted: 0, possible: 0 })
  }

  let global
  try {
    global = globalDscr(rows)
  } catch {
    global = na('Global coverage could not be worked out.', { included: [], excluded: [], operating: na('Not available.') })
  }

  const list = rows.map(({ record, ...rest }) => rest) // eslint-disable-line no-unused-vars
  return {
    firm: d
      ? { ok: true, name: typeof d.identity?.name === 'string' && d.identity.name.trim() ? d.identity.name.trim() : 'The sponsor firm', principal: d.identity?.principalName ?? null }
      : na('There is no firm record, so the firm balance sheet, earnings and debts could not be checked.'),
    settings,
    asOfDate,
    projects: list,
    // The track record: every project with its stage, the firm's share and its coverage, completed projects first.
    trackRecord: [...list].sort((a, b) => (b.stage === 'completed') - (a.stage === 'completed')),
    counts,
    globalDscr: global,
    liquidity: liquidity(firm),
    feeDependence: feeDependence(firm, asOfDate),
    credibility: cred,
    notes,
  }
}
