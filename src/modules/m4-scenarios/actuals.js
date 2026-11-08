// Starting a scenario from the T-12 (the last months of real income and expenses) instead of the applicant's projection.
//
// The shared calculators work out NOI from the income and expense groups of the record. To stress actuals with the same
// calculators, the T-12 is turned into those groups on a COPY of the record: the average month, times 12. The levers and
// calculators then run on that copy exactly as they do on a projection, so "rents -10%" means 10% off what was really
// collected. The original record is never touched.
//
// Whether a T-12 can be used at all is decided by the shared "T-12 vs. underwritten" ratio (M0): it already refuses
// unbelievable numbers, rows with no month, and a record with nothing to compare against. M4 does not repeat that.

import { keyRatios, noi, projectSchema } from '../shared/index.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const OPEX_KEYS = projectSchema.find((g) => g.id === 'operatingExpenses').rows.map((r) => r.key)
const REVENUE_KEYS = ['residentialRevenue', 'commercialRevenue', 'otherRevenue']
const EXPENSE_KEYS = [...OPEX_KEYS, 'otherExpenses']

// "2026-06" and "2026-06-30" are the same month. A month entered twice counts once, the later row wins (as in M0).
const monthOf = (text) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(typeof text === 'string' ? text : '')
  return m ? `${m[1]}-${m[2]}` : null
}

const average = (rows, key, f = (v) => v) => rows.reduce((t, r) => t + (isNum(r[key]) ? f(r[key]) : 0), 0) / rows.length

// Returns { ok: true, record, months, annualNoi, summary, rowIndexes } or { ok: false, reason }.
// `record` is a copy whose income and expenses are the annualized T-12. `annualNoi` and `summary` are M0's own figures.
export function t12Basis(original, settings) {
  if (original.data.t12.rows.length === 0) return { ok: false, reason: 'No T-12 has been entered for this project.' }

  const trailing = keyRatios(original, settings).find((r) => r.id === 'trailing')
  if (!trailing?.ok) return { ok: false, reason: trailing?.reason ?? 'The T-12 cannot be compared with the underwriting.' }

  // One row per calendar month, a month counts only if it has both revenue and expenses entered.
  const byMonth = new Map()
  original.data.t12.rows.forEach((row, index) => {
    const month = monthOf(row.month)
    if (month) byMonth.set(month, { row, index })
  })
  const used = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .filter(({ row }) => REVENUE_KEYS.some((k) => isNum(row[k])) && EXPENSE_KEYS.some((k) => isNum(row[k])))
  if (used.length === 0) return { ok: false, reason: 'No T-12 month has both revenue and expenses entered.' }

  const rows = used.map((u) => u.row)
  const res = average(rows, 'residentialRevenue') * 12
  const com = average(rows, 'commercialRevenue') * 12
  const oth = average(rows, 'otherRevenue') * 12
  const loss = (average(rows, 'vacancyLoss', Math.abs) + average(rows, 'concessions', Math.abs)) * 12 // typed as a loss, either sign
  const rentable = res + com
  const lossShare = rentable > 0 ? loss / rentable : loss > 0 ? 2 : 0 // 2 = "more than all of it", refused below
  if (lossShare > 1) return { ok: false, reason: 'The T-12 vacancy and free rent add up to more than the rent that was billed.' }

  // The copy: the T-12 average month becomes one yearly row of income and the yearly expense lines.
  const record = structuredClone(original)
  const d = record.data
  d.residentialIncome.rows = res > 0 ? [{ amiLevel: null, unitType: 'T-12 average', units: 1, baths: null, sqft: null, monthlyRent: res / 12 }] : []
  d.commercialIncome.rows = com > 0 ? [{ leaseType: null, description: 'T-12 average', sqft: 1, rentPerSqft: com }] : []
  d.otherIncome.rows = oth > 0 ? [{ description: 'T-12 average', monthlyIncome: oth / 12 }] : []
  // The loss is spread evenly over residential and commercial rent, so total collected income equals the T-12's.
  d.residentialIncome.stabilizedVacancy = lossShare
  d.commercialIncome.stabilizedVacancy = lossShare
  for (const key of OPEX_KEYS) d.operatingExpenses.lines[key].amount = rows.some((r) => isNum(r[key])) ? average(rows, key) * 12 : null
  d.otherExpenses.rows = rows.some((r) => isNum(r.otherExpenses)) ? [{ description: 'T-12 average', amount: average(rows, 'otherExpenses') * 12 }] : []

  return {
    ok: true,
    record,
    months: used.length,
    annualNoi: trailing.value * noi(original).value, // M0's ratio is T-12 NOI over underwritten NOI; this is the T-12 NOI a year
    summary: trailing.detail?.[0] ?? '', // M0's own sentence: "T-12 NOI $x a year against $y underwritten"

    rowIndexes: used.map((u) => u.index),
  }
}
