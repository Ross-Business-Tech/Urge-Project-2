// The lease-up view (M3T): occupancy trend, absorption pace, concessions, the stability streak and an estimate of when
// the project will pass the stability test in section 1f.
//
// Nothing here recomputes a shared calculator. Monthly NOI and whether a month passes the DSCR and NOI tests come from
// M0's own "T-12 vs. underwritten, and stability" ratio, asked one month at a time on a copy of the record. The streak
// itself is M0's (back-to-back months only; a missing month ends it). What is new here is reading the trend: how fast
// occupancy and NOI are moving, and so how many months are left.

import { keyRatios, noi, annualDebtService, sanitizeSettings, loadBenchmarks, rentBenchmark, BENCHMARK_SETS, fmt } from '../shared/index.js'
import { monthIndex, monthText, timelineMonth, plural } from './dates.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const sum = (list) => list.reduce((t, v) => t + (isNum(v) ? v : 0), 0)
const isShare = (v) => isNum(v) && v >= 0 && v <= 1

export const settingsFrom = (context) => sanitizeSettings(context?.settings)

// A shallow copy of the project under another stage (the original is never touched).
export const withStage = (project, stage) => ({ ...project, data: { ...project.data, stage: { ...project.data.stage, stage } } })

// M0's trailing ratio. A development project has no trailing ratio of its own, so it is asked as if leasing up.
export function trailingRatio(project, settings) {
  const stage = project.data.stage?.stage
  const asked = stage === 'lease_up' || stage === 'completed' ? project : withStage(project, 'lease_up')
  return keyRatios(asked, settings).find((r) => r.id === 'trailing') ?? null
}

// Straight-line slope (change per month) through points { x, y }. Null with fewer than 2 points.
export function slope(points) {
  if (points.length < 2) return null
  const mx = sum(points.map((p) => p.x)) / points.length
  const my = sum(points.map((p) => p.y)) / points.length
  const den = sum(points.map((p) => (p.x - mx) ** 2))
  return den > 0 ? sum(points.map((p) => (p.x - mx) * (p.y - my))) / den : null
}

// The T-12 rows, one per calendar month (a later row for the same month wins), oldest first, and the months missing
// between the first and the last.
export function t12Series(project) {
  const rows = Array.isArray(project?.data?.t12?.rows) ? project.data.t12.rows : []
  const byMonth = new Map()
  let undated = 0
  let duplicates = 0
  for (const row of rows) {
    const idx = monthIndex(row?.month)
    if (idx === null) {
      undated++
      continue
    }
    if (byMonth.has(idx)) duplicates++
    byMonth.set(idx, row)
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([idx, row]) => ({ idx, row }))
  const gaps = []
  for (let i = 1; i < months.length; i++) for (let g = months[i - 1].idx + 1; g < months[i].idx; g++) gaps.push(g)
  return { months, undated, duplicates, gaps }
}

// The latest run of back-to-back months.
function latestRun(months) {
  const run = []
  for (let i = months.length - 1; i >= 0; i--) {
    if (run.length && run[0].idx - months[i].idx !== 1) break
    run.unshift(months[i])
  }
  return run
}

// One month's NOI and whether it passes the stability test, from M0's ratio on a one-month copy of the record.
function monthResult(project, row, settings, underwrittenNoi, yearlyDs) {
  const copy = withStage({ ...project, data: { ...project.data, t12: { ...project.data.t12, rows: [row] } } }, 'lease_up')
  const t = keyRatios(copy, settings).find((r) => r.id === 'trailing')
  if (!t?.ok) return { noi: null, passes: null, reason: t?.reason ?? 'not available' }
  const monthlyNoi = Math.round(((t.value * underwrittenNoi) / 12) * 100) / 100
  const debtService = isNum(row.debtService) ? row.debtService : yearlyDs > 0 ? yearlyDs / 12 : null
  return { noi: monthlyNoi, passes: debtService === null ? null : t.streak >= 1, debtService }
}

// Rent per unit a month, weighted by units, from the rent roll.
function rentRoll(project) {
  const rows = Array.isArray(project.data.residentialIncome?.rows) ? project.data.residentialIncome.rows : []
  const usable = rows.filter((r) => isNum(r?.units) && r.units > 0 && r.units < 1e7)
  const units = sum(usable.map((r) => r.units))
  const priced = usable.filter((r) => isNum(r.monthlyRent) && r.monthlyRent >= 0)
  const pricedUnits = sum(priced.map((r) => r.units))
  return { rows: usable, units, underwrittenRent: pricedUnits > 0 ? sum(priced.map((r) => r.units * r.monthlyRent)) / pricedUnits : null }
}

// The market rent the rent roll would earn, weighted by units, from the benchmark set for this stage.
function marketRent(project, context, roll) {
  const stage = ['development', 'lease_up', 'completed'].includes(project.data.stage?.stage) ? project.data.stage.stage : 'lease_up'
  const loaded = loadBenchmarks(stage, context?.benchmarks ?? BENCHMARK_SETS)
  if (!loaded.ok) return { ok: false, reason: loaded.reason }
  let weighted = 0
  let units = 0
  const skipped = []
  for (const r of roll.rows) {
    const b = rentBenchmark(loaded.set, r.unitType, r.amiLevel)
    if (!b.ok) {
      skipped.push(b.reason)
      continue
    }
    weighted += r.units * b.range.median
    units += r.units
  }
  if (units === 0) return { ok: false, reason: skipped[0] ?? 'No unit types to compare with the market.' }
  return { ok: true, median: weighted / units, units, skipped, setName: loaded.set.name }
}

// Everything the lease-up view shows. Returns { ok: false, reason, needs } when there is no T-12 to read.
export function buildView(project, context = {}) {
  const settings = settingsFrom(context)
  const series = t12Series(project)
  if (series.months.length === 0) {
    const reason = series.undated > 0 ? 'The T-12 rows have no month entered.' : 'No T-12 months entered.'
    return { ok: false, reason, needs: [{ group: 't12', label: 'Trailing 12 months (optional)' }] }
  }

  const notes = []
  if (series.undated) notes.push(`${plural(series.undated, 'T-12 row')} without a month ${series.undated === 1 ? 'was' : 'were'} left out.`)
  if (series.duplicates) notes.push(`${plural(series.duplicates, 'month')} appeared more than once; the later entry was used.`)

  const uw = noi(project)
  const ds = annualDebtService(project)
  const yearlyDs = ds.ok ? ds.value : 0
  const roll = rentRoll(project)

  const months = series.months.map(({ idx, row }) => {
    const res = isNum(row.residentialRevenue) && row.residentialRevenue >= 0 ? row.residentialRevenue : null
    const concessions = isNum(row.concessions) ? Math.abs(row.concessions) : null
    const result = uw.ok && uw.value > 0 ? monthResult(project, row, settings, uw.value, yearlyDs) : { noi: null, passes: null }
    return {
      idx,
      month: monthText(idx),
      occupancy: isShare(row.occupancy) ? row.occupancy : null,
      residentialRevenue: res,
      concessions,
      concessionShare: res > 0 && concessions !== null ? concessions / res : null,
      noi: result.noi,
      passes: result.passes,
      debtService: result.debtService ?? null,
    }
  })
  if (series.months.some(({ row }) => isNum(row.occupancy) && !isShare(row.occupancy))) notes.push('An occupancy outside 0% to 100% was left out.')

  const run = latestRun(months)
  const latest = months.at(-1)

  // ---- Occupancy trend and absorption pace (the latest back-to-back months, at most the last 6)
  const occPoints = run.filter((m) => m.occupancy !== null).slice(-6)
  const latestOcc = [...months].reverse().find((m) => m.occupancy !== null) ?? null
  const pace = slope(occPoints.map((m) => ({ x: m.idx, y: m.occupancy })))
  const resVacancy = project.data.residentialIncome?.stabilizedVacancy
  const target = isShare(resVacancy) ? Math.max(1 - resVacancy, settings.occupancyFloor) : settings.occupancyFloor
  const planned = timelineMonth(project.data.timeline?.stabilization)
  const occupancy = {
    latest: latestOcc?.occupancy ?? null,
    latestMonth: latestOcc?.month ?? null,
    first: occPoints[0]?.occupancy ?? null,
    points: occPoints.length,
    trend: pace === null ? 'unknown' : pace > 0.002 ? 'rising' : pace < -0.002 ? 'falling' : 'flat',
    floor: settings.occupancyFloor,
    belowFloor: latestOcc ? latestOcc.occupancy < settings.occupancyFloor : null,
  }

  let absorption = { ok: false, reason: 'At least two back-to-back months with occupancy are needed to measure the pace.' }
  if (latestOcc && pace !== null) {
    const reached = latestOcc.occupancy >= target
    const monthsToTarget = reached ? 0 : pace > 0 ? Math.ceil((target - latestOcc.occupancy) / pace) : null
    const reachMonth = monthsToTarget === null ? null : latestOcc.idx + monthsToTarget
    const monthsLeft = planned ? planned.idx - latestOcc.idx : null
    const neededPace = reached ? 0 : monthsLeft !== null && monthsLeft > 0 ? (target - latestOcc.occupancy) / monthsLeft : null
    absorption = {
      ok: true,
      pacePerMonth: pace,
      unitsPerMonth: roll.units > 0 ? pace * roll.units : null,
      target,
      reached,
      monthsToTarget,
      reachMonth,
      reachText: reachMonth === null ? null : monthText(reachMonth),
      planned: planned ? { idx: planned.idx, text: monthText(planned.idx, planned.approx), approx: planned.approx } : null,
      neededPace,
      monthsLate: reachMonth !== null && planned ? reachMonth - planned.idx : null,
      fromMonth: latestOcc.idx,
    }
  }

  // ---- Concessions (the latest up to 3 back-to-back months)
  const recent = run.slice(-3)
  const withConc = recent.filter((m) => m.concessionShare !== null)
  const billed = sum(withConc.map((m) => m.residentialRevenue))
  const given = sum(withConc.map((m) => m.concessions))
  const concessions = withConc.length
    ? {
        ok: true,
        months: withConc.length,
        share: billed > 0 ? given / billed : 0,
        monthly: given / withConc.length,
        billedRent: roll.units > 0 ? billed / withConc.length / roll.units : null,
        netRent: roll.units > 0 ? (billed - given) / withConc.length / roll.units : null,
        underwrittenRent: roll.underwrittenRent,
      }
    : { ok: false, reason: recent.some((m) => m.residentialRevenue !== null) ? 'No concessions are entered in the latest T-12 months.' : 'No residential revenue is entered in the latest T-12 months.' }

  // ---- Achieved rent against the market (for the occupancy screen in section 1f)
  let rentVsMarket = { ok: false, reason: 'The latest T-12 month has no residential revenue.' }
  const lastRent = [...months].reverse().find((m) => m.residentialRevenue !== null)
  if (lastRent && roll.units > 0) {
    const market = marketRent(project, context, roll)
    const achieved = (lastRent.residentialRevenue - (lastRent.concessions ?? 0)) / roll.units
    rentVsMarket = market.ok
      ? { ok: true, achieved, market: market.median, premium: market.median > 0 ? achieved / market.median - 1 : null, month: lastRent.month, skipped: market.skipped }
      : { ok: false, reason: market.reason }
    if (market.ok && market.units < roll.units) notes.push(`Market rent covers ${plural(market.units, 'unit')} of ${roll.units}; the rest have no comparable benchmark.`)
  } else if (lastRent) {
    rentVsMarket = { ok: false, reason: 'The rent roll has no units, so rent per unit cannot be worked out.' }
  }

  // ---- Stability streak (M0's) and the estimate of when the test will be met
  const trailing = trailingRatio(project, settings)
  const needed = settings.consecutiveMonths
  const runStart = run[0]
  const brokenBy = runStart && runStart.idx !== months[0].idx ? monthText(runStart.idx - 1) : null
  const stability = {
    ok: Boolean(trailing?.ok),
    reason: trailing?.ok ? null : trailing?.reason ?? 'The stability test could not run.',
    streak: trailing?.ok ? trailing.streak : null,
    needed,
    brokenBy,
    gaps: series.gaps.map((g) => monthText(g)),
    estimate: estimate({ trailing, needed, run, latest, settings, uw, planned }),
  }

  return { ok: true, settings, months, latestMonth: latest.month, latestIdx: latest.idx, units: roll.units, occupancy, absorption, concessions, rentVsMarket, stability, notes }
}

// When will the project pass the stability test? Counted in months after the latest T-12 month.
function estimate({ trailing, needed, run, latest, settings, uw, planned }) {
  if (!trailing?.ok) return { ok: false, reason: trailing?.reason ?? 'The stability test could not run.' }
  const streak = trailing.streak
  const plannedText = planned ? monthText(planned.idx, planned.approx) : null
  const finish = (monthsAway, how) => {
    const idx = latest.idx + monthsAway
    return { ok: true, onTrack: true, monthsAway, month: idx, monthText: monthText(idx), how, planned: plannedText, monthsLate: planned ? idx - planned.idx : null }
  }
  if (streak >= needed) return finish(0, `It already passes: ${plural(streak, 'month')} in a row meet the test (${needed} needed).`)

  const withNoi = run.filter((m) => m.noi !== null)
  const last = withNoi.at(-1)
  if (!last || last.idx !== latest.idx) return { ok: false, reason: 'The latest T-12 month has no NOI, so the pace cannot be read.' }
  const monthlyDs = last.debtService
  const threshold = Math.max((settings.noiVsUnderwritten * uw.value) / 12, monthlyDs !== null ? settings.minDscr * monthlyDs : 0)
  if (last.passes) {
    const left = needed - streak
    return finish(left, `The latest month passes. ${plural(left, 'more month')} at this level would complete the ${needed}-month streak.`)
  }
  const trend = slope(withNoi.slice(-6).map((m) => ({ x: m.idx, y: m.noi })))
  if (trend === null || trend <= 0) {
    return {
      ok: true,
      onTrack: false,
      monthsAway: null,
      month: null,
      monthText: null,
      planned: plannedText,
      monthsLate: null,
      threshold,
      how: `Monthly NOI (${fmt.usd(last.noi)} in ${last.month}) is below the ${fmt.usd(threshold)} needed and is not rising, so at the current pace the project does not reach the test.`,
    }
  }
  const reach = Math.ceil((threshold - last.noi) / trend)
  const result = finish(reach + needed - 1, `Monthly NOI is ${fmt.usd(last.noi)} against ${fmt.usd(threshold)} needed and rising about ${fmt.usd(trend)} a month, so it reaches the level in about ${plural(reach, 'month')}, then needs ${needed} months in a row.`)
  return { ...result, threshold }
}

// ---- The helpers the spec names, each safe to call with anything.
const safely = (fn) => (project, context) => {
  try {
    if (!project?.data) return { ok: false, reason: 'There is no project to read.' }
    return fn(project, context)
  } catch {
    return { ok: false, reason: 'The lease-up figures could not be worked out from this project.' }
  }
}

export const leaseUpView = safely((project, context) => buildView(project, context))
const part = (key) => safely((project, context) => {
  const v = buildView(project, context)
  return v.ok ? (v[key].ok === undefined ? { ok: true, ...v[key] } : v[key]) : v
})
export const occupancyTrend = part('occupancy')
export const absorptionPace = part('absorption')
export const concessionsView = part('concessions')
export const monthsUntilStabilization = safely((project, context) => {
  const v = buildView(project, context)
  if (!v.ok) return v
  return { ...v.stability.estimate, streak: v.stability.streak, needed: v.stability.needed, brokenBy: v.stability.brokenBy }
})
