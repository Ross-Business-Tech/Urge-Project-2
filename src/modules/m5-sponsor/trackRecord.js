// M5-b: sponsor track record and credibility score. "Has this sponsor delivered what it promised before?"
//
// The sponsor's completed projects (the ones whose stage the underwriter chose as `completed`) are compared with what was
// promised for them, using only what the records hold: the applicant's underwriting (rent roll, vacancy, income, expenses,
// stabilization date) against the T-12 actuals. The records hold one set of dates and no budget for a completed project,
// so budget and completion date show "not available" rather than a guess.
//
// The credibility score (0 to 100) has four parts:
//   Income delivered              T-12 NOI against underwritten NOI                                   weight 40%
//   Rent and occupancy delivered  T-12 rents and occupancy against the underwritten rent roll/vacancy weight 20%
//   Stabilization on time         when the project passed the stability test against its target date  weight 20%
//   Scale fit                     the size of the project under review against the largest delivered  weight 20%
//
// Same rules as the shared calculators: a missing input is never guessed as zero, a part that cannot be worked out is left
// out of the score (and the result says how many of the four were used), and a result is never NaN or Infinity.

import { keyRatios, noi, totalSources, fmt } from '../shared/calculators.js'
import { sanitizeSettings } from '../shared/settings.js'
import { interpolate, labelFor } from './firmHealth.js'

export const TRACK_WEIGHTS = { income: 0.4, rentOccupancy: 0.2, stabilization: 0.2, scale: 0.2 }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const average = (list) => (list.length ? sum(list) / list.length : null)

// "2026-06" or "2026-06-30" -> months since year 0; "2026" alone -> December of that year (the benefit of the doubt: the
// workbook asks for years only). Anything else -> null.
export function monthIndex(text) {
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-\d{2})?)?$/.exec(typeof text === 'string' ? text.trim() : '')
  if (!m) return null
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) : 12) - 1
}
const monthLabel = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`

const na = (id, label, reason, projected = '—') => ({ id, label, projected, delivered: '—', score: null, status: 'unavailable', note: reason })

const nameOf = (p) => p.data?.identity?.name || p.meta?.sourceTab || 'Unnamed project'

// One T-12 month per calendar month (a later row for the same month wins), in date order.
function t12Months(project) {
  const byMonth = new Map()
  for (const row of project.data.t12.rows) {
    const idx = monthIndex(row.month)
    if (idx !== null) byMonth.set(idx, row)
  }
  return [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([idx, row]) => ({ idx, row }))
}

// ---- The measures for one completed project ---------------------------------------------------

function incomeMeasure(project, trailing) {
  const label = 'Income (NOI, a year)'
  if (!trailing?.ok) return na('income', label, trailing?.reason ?? 'The T-12 comparison is not available.')
  const underwritten = noi(project)
  const actual = trailing.value * underwritten.value
  const pct = fmt.pct(trailing.value, 0)
  return {
    id: 'income',
    label,
    projected: fmt.usd(underwritten.value),
    delivered: fmt.usd(actual),
    score: interpolate(trailing.value, [[0.7, 0], [0.8, 30], [0.9, 65], [1, 100]]),
    status: trailing.value >= 0.95 ? 'good' : trailing.value >= 0.85 ? 'watch' : 'concern',
    note: `T-12 NOI is ${pct} of underwritten.`,
    ratio: trailing.value,
  }
}

function rentMeasure(project, months) {
  const label = 'Residential rent (a month)'
  const rows = project.data.residentialIncome.rows.filter((r) => isNum(r.units) && isNum(r.monthlyRent))
  if (rows.length === 0) return na('rent', label, 'No underwritten residential rent roll (units and monthly rent) was entered.')
  const projected = sum(rows.map((r) => r.units * r.monthlyRent))
  if (projected <= 0) return na('rent', label, 'The underwritten rent roll adds up to zero.')
  const revenue = months.map((m) => m.row.residentialRevenue).filter(isNum)
  if (revenue.length === 0) return na('rent', label, 'The T-12 has no residential revenue.')
  const delivered = average(revenue)
  const ratio = delivered / projected
  return {
    id: 'rent',
    label,
    projected: fmt.usd(projected),
    delivered: fmt.usd(delivered),
    score: interpolate(ratio, [[0.75, 0], [0.8, 20], [0.9, 60], [0.98, 100]]),
    status: ratio >= 0.97 ? 'good' : ratio >= 0.9 ? 'watch' : 'concern',
    note: `Rents achieved were ${fmt.pct(ratio, 0)} of underwritten.`,
    ratio,
  }
}

function occupancyMeasure(project, months) {
  const label = 'Occupancy'
  const vacancy = project.data.residentialIncome.stabilizedVacancy
  if (!isNum(vacancy)) return na('occupancy', label, 'No underwritten vacancy was entered.')
  const seen = months.map((m) => m.row.occupancy).filter(isNum)
  if (seen.length === 0) return na('occupancy', label, 'The T-12 has no occupancy.')
  const projected = 1 - vacancy
  const delivered = average(seen)
  const gap = delivered - projected
  return {
    id: 'occupancy',
    label,
    projected: fmt.pct(projected, 0),
    delivered: fmt.pct(delivered, 0),
    score: interpolate(gap, [[-0.1, 0], [-0.06, 40], [-0.03, 70], [0, 100]]),
    status: gap >= -0.01 ? 'good' : gap >= -0.04 ? 'watch' : 'concern',
    note: gap >= 0 ? 'Occupancy met or beat the underwriting.' : `Occupancy ran ${(Math.abs(gap) * 100).toFixed(0)} points below the underwriting.`,
    gap,
  }
}

// When did the project actually pass the stability test, against the date its timeline promised?
function stabilizationMeasure(project, trailing, months, settings) {
  const label = 'Stabilization'
  const target = monthIndex(project.data.timeline.stabilization)
  if (target === null) return na('stabilization', label, 'No stabilization date was entered in the timeline.')
  const projected = monthLabel(target)
  if (!trailing?.ok || !isNum(trailing.streak)) return na('stabilization', label, trailing?.reason ?? 'The stability test could not be run on the T-12.', projected)
  const first = months[0].idx
  const last = months[months.length - 1].idx
  const needed = settings.consecutiveMonths
  const asOf = monthIndex(project.data.stage.asOfDate)

  if (trailing.streak >= needed) {
    if (trailing.streak >= months.length) {
      // The whole T-12 passes, so the project was stable no later than the first month shown.
      if (first <= target) return { id: 'stabilization', label, projected, delivered: `by ${monthLabel(first)}`, score: 100, status: 'good', note: 'Stable by the first T-12 month, which is on or before the target.' }
      return na('stabilization', label, `The T-12 starts in ${monthLabel(first)}, after the target ${projected}, and is stable throughout, so the actual month cannot be told.`, projected)
    }
    const actual = last - trailing.streak + 1
    const late = actual - target
    return {
      id: 'stabilization',
      label,
      projected,
      delivered: monthLabel(actual),
      score: late <= 0 ? 100 : interpolate(late, [[0, 100], [3, 80], [6, 60], [12, 30], [13, 0]]),
      status: late <= 0 ? 'good' : late <= 6 ? 'watch' : 'concern',
      note: late <= 0 ? 'Passed the stability test on or before the target.' : `Passed the stability test ${late} month${late === 1 ? '' : 's'} after the target.`,
    }
  }
  // Not stable at the end of the T-12.
  if (asOf !== null && asOf > target) {
    return { id: 'stabilization', label, projected, delivered: 'not stable yet', score: 0, status: 'concern', note: `Not stable at ${monthLabel(last)}, ${asOf - target} month${asOf - target === 1 ? '' : 's'} after the target, even though the project is marked completed.` }
  }
  return na('stabilization', label, 'The project does not pass the stability test yet, but its target date has not passed, so it cannot be called late.', projected)
}

const NO_BUDGET = na('budget', 'Budget (promised vs. spent)', 'Completed projects carry no delivered budget in the records.')
const NO_COMPLETION = na('completion', 'Construction completion (promised vs. actual)', 'The records hold only one set of dates, so a promised and an actual date cannot be compared.')

// One completed project's own delivery score: the same three delivery parts and weights as the sponsor score (scale fit
// is about the new project, not this one), using whichever parts could be worked out. Null when none could.
function deliveryScore(measures) {
  const pick = (ids) => average(measures.filter((m) => ids.includes(m.id) && isNum(m.score)).map((m) => m.score))
  const parts = [['income', pick(['income'])], ['rentOccupancy', pick(['rent', 'occupancy'])], ['stabilization', pick(['stabilization'])]].filter(([, v]) => isNum(v))
  if (parts.length === 0) return null
  const weight = sum(parts.map(([id]) => TRACK_WEIGHTS[id]))
  return Math.round(sum(parts.map(([id, v]) => v * TRACK_WEIGHTS[id])) / weight)
}

// How one completed project delivered against what was promised.
export function projectDelivery(project, settings) {
  const trailing = keyRatios(project, settings).find((r) => r.id === 'trailing')
  const months = t12Months(project)
  const measures = months.length
    ? [incomeMeasure(project, trailing), rentMeasure(project, months), occupancyMeasure(project, months), stabilizationMeasure(project, trailing, months, settings)]
    : [na('income', 'Income (NOI, a year)', 'No T-12 was loaded for this project.'), na('rent', 'Residential rent (a month)', 'No T-12 was loaded for this project.'), na('occupancy', 'Occupancy', 'No T-12 was loaded for this project.'), na('stabilization', 'Stabilization', 'No T-12 was loaded for this project.')]
  const size = totalSources(project)
  const units = sum(project.data.residentialIncome.rows.map((r) => r.units))
  return { name: nameOf(project), stage: project.data.stage.stage, size: size.ok ? size.value : null, units: units > 0 ? units : null, measures: [...measures, NO_BUDGET, NO_COMPLETION], months: months.length, score: deliveryScore(measures) }
}

// ---- The sponsor ------------------------------------------------------------------------------

const scoreOf = (project, ids) => average(project.measures.filter((m) => ids.includes(m.id) && isNum(m.score)).map((m) => m.score))

// trackRecord(firm, projects, settings, reviewed) -> { ok, ... }
//   firm       the firm record (only used to compare with the number of completed projects the Cover reports)
//   projects   every project of the sponsor; the completed ones (by the underwriter's chosen stage) are the track record
//   reviewed   the project under review, for scale fit. A completed project under review has no scale fit.
export function trackRecord(firm, projects = [], settings, reviewed = null) {
  const st = sanitizeSettings(settings)
  const notes = []
  const unstaged = projects.filter((p) => !p.data?.stage?.stage).length
  if (unstaged) notes.push(`${unstaged} project${unstaged === 1 ? ' has' : 's have'} no stage yet and ${unstaged === 1 ? 'is' : 'are'} not counted.`)

  const completed = projects.filter((p) => p.data?.stage?.stage === 'completed')
  const declared = firm?.data?.identity?.completedProjectCount
  if (completed.length === 0) {
    const reason = 'No completed projects are loaded, so there is no track record to judge.'
    return { ok: false, noTrackRecord: true, reason, declared: isNum(declared) ? declared : null, parts: [], projects: [], used: 0, total: 4, notes: [...notes, reason] }
  }
  if (isNum(declared) && declared > completed.length) {
    notes.push(`The Cover reports ${declared} completed project${declared === 1 ? '' : 's'}, but only ${completed.length} ${completed.length === 1 ? 'is' : 'are'} loaded, so the record covers ${completed.length} of ${declared}.`)
  }

  const rows = completed.map((p) => projectDelivery(p, st))
  const sized = rows.map((r) => r.size).filter(isNum)
  const largest = sized.length ? Math.max(...sized) : null
  const measured = rows.filter((r) => r.measures.some((m) => isNum(m.score)))
  const avg = (ids) => average(rows.map((r) => scoreOf(r, ids)).filter(isNum))
  const withDetail = (id, title, ids, empty) => {
    const score = avg(ids)
    const n = rows.filter((r) => isNum(scoreOf(r, ids))).length
    return isNum(score)
      ? { id, title, ok: true, score, weight: TRACK_WEIGHTS[id], detail: [`Based on ${n} of ${rows.length} completed project${rows.length === 1 ? '' : 's'}`] }
      : { id, title, ok: false, reason: empty, weight: TRACK_WEIGHTS[id] }
  }

  const scale = () => {
    const title = 'Scale fit'
    if (!reviewed || reviewed.data?.stage?.stage === 'completed') return { id: 'scale', title, ok: false, reason: 'Scale fit compares the project under review with what was delivered, so it needs a project that is not yet completed.', weight: TRACK_WEIGHTS.scale }
    const size = totalSources(reviewed)
    if (!size.ok) return { id: 'scale', title, ok: false, reason: `The size of the project under review is not available: ${size.reason}`, weight: TRACK_WEIGHTS.scale }
    if (!largest) return { id: 'scale', title, ok: false, reason: 'No completed project has its sources of money entered, so sizes cannot be compared.', weight: TRACK_WEIGHTS.scale }
    const step = size.value / largest
    return {
      id: 'scale',
      title,
      ok: true,
      score: interpolate(step, [[1.25, 100], [2, 60], [3, 20], [4, 0]]),
      weight: TRACK_WEIGHTS.scale,
      step,
      detail: [`This project (${fmt.usd(size.value)}) is ${step.toFixed(2)}× the largest the sponsor has completed (${fmt.usd(largest)})`],
    }
  }

  const parts = [
    withDetail('income', 'Income delivered', ['income'], 'No completed project has a T-12 to compare with its underwriting.'),
    withDetail('rentOccupancy', 'Rent and occupancy delivered', ['rent', 'occupancy'], 'No completed project has T-12 rents or occupancy to compare with its underwriting.'),
    withDetail('stabilization', 'Stabilization on time', ['stabilization'], 'No completed project could be compared with its stabilization date.'),
    scale(),
  ]
  const scored = parts.filter((p) => p.ok)
  const summary = { count: completed.length, declared: isNum(declared) ? declared : null, units: sum(rows.map((r) => r.units)) || null, largest, measured: measured.length }
  const base = { declared: summary.declared, parts, projects: rows, summary, used: scored.length, total: 4 }
  notes.push(`The credibility score is based on ${scored.length} of 4 parts and ${measured.length} of ${rows.length} completed project${rows.length === 1 ? '' : 's'} with data.`)
  for (const p of parts.filter((x) => !x.ok)) notes.push(`${p.title} not available: ${p.reason}`)

  if (scored.length === 0) return { ok: false, reason: 'None of the four parts could be worked out from the completed projects.', ...base, notes }
  // Scale fit says how big the step up is, not whether the sponsor delivers. Without a delivery measure there is no score.
  if (!scored.some((p) => p.id !== 'scale')) {
    const reason = 'No completed project could be compared with its underwriting (no usable T-12), so there is no evidence of delivery to score.'
    return { ok: false, noDeliveryEvidence: true, reason, ...base, notes: [...notes, reason] }
  }
  const weight = sum(scored.map((p) => p.weight))
  const score = Math.round(sum(scored.map((p) => p.score * p.weight)) / weight)
  const band = labelFor(score)
  // How the number was reached: each part's score times its share of the weight (parts that could not be worked out are left
  // out and the rest are scaled up to add to 100%).
  const breakdown = scored.map((p) => ({ id: p.id, title: p.title, score: p.score, weight: p.weight, share: p.weight / weight, points: (p.score * p.weight) / weight }))
  return { ok: true, score, label: band.label, plain: band.plain, breakdown, ...base, notes }
}
