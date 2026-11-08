// Two questions an underwriter asks that three fixed cases cannot answer (M4, layer 4):
//
//  1. Break-even: "How far can this one thing move before the loan breaks?" Each lever is moved on its own, in the bad
//     direction, until coverage falls to the lender's minimum, falls to 1.00×, or (for costs and delays) until the
//     contingency or reserves are used up and new money is needed.
//  2. One lever at a time: "Which of the downside's levers does the damage?" Each lever is turned alone, to the downside's
//     setting, and the damage is compared with the Base case.
//
// Both use the same calculators as the three cases, on the same starting point (actuals or projection), so they can never
// disagree with them. Nothing here changes the project.

import { dscr } from '../shared/index.js'
import { applyLevers, evaluateCase, prepare } from './engine.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// How far each lever is searched, in its bad direction, beyond the slider's range (a strong deal may not break within it).
// If a lever does not break the loan even here, the answer is "holds up even at ...".
const SEARCH_LIMIT = {
  rentChange: -1, // every rent gone
  vacancyChange: 1, // fully empty
  expenseGrowth: 5, // expenses six times as high
  takeoutRate: 0.3, // 30 points more
  costOverrun: 2, // costs three times the budget
  delayMonths: 120,
  absorptionMonths: 120,
}

const COVERAGE_LEVERS = ['rentChange', 'vacancyChange', 'expenseGrowth', 'takeoutRate']
const MONEY_LEVERS = ['costOverrun', 'delayMonths', 'absorptionMonths']

// Find how far a lever can move from `from` toward `limit` before `broken(x)` turns true. `broken` must be false near
// `from` and stay true once it flips, which holds for every lever here: each one only ever makes things worse.
// If moving the lever all the way changes nothing (`effect(x)` is the same at both ends), the answer is "no effect", not
// "holds up": a loan whose payment was typed in does not care what the rate does, which says nothing about its safety.
function threshold(broken, from, limit, effect) {
  if (broken(from)) return { status: 'already' }
  if (!broken(limit)) return effect && effect(from) === effect(limit) ? { status: 'noeffect', limit } : { status: 'never', limit }
  let ok = from
  let bad = limit
  for (let i = 0; i < 40; i++) {
    const mid = (ok + bad) / 2
    if (broken(mid)) bad = mid
    else ok = mid
  }
  return { status: 'found', at: bad, headroom: Math.abs(bad - from) }
}

// ---------------------------------------------------------------------------------------------
// 1. Break-even
// ---------------------------------------------------------------------------------------------

// Returns { ok: false, reason, needs } when the project cannot be stress-tested, otherwise
//   { ok: true, stage, targets, coverage: [{ def, from, results: [{ target, ...threshold }] }], money: [{ def, from, ...threshold }] }
// A threshold is { status: 'found', at, headroom } | { status: 'already' } | { status: 'never', limit } (holds up even at the
// limit) | { status: 'noeffect', limit } (the lever does nothing to this project).
// The other levers sit at their Base-case settings while one is moved, so the answer follows the Base sliders.
export function runBreakEvens(project, options = {}) {
  const prep = prepare(project, options)
  if (!prep.ok) return prep
  if (prep.refused) return { ok: false, ...prep.refused }
  const { stage, settings, defs, levers, start } = prep
  const base = levers.base
  const targets = [settings.minDscr, 1]

  const coverage = defs
    .filter((d) => COVERAGE_LEVERS.includes(d.id))
    .map((def) => {
      const dscrAt = (x) => dscr(applyLevers(start, { ...base, [def.id]: x }).record)
      return {
        def,
        from: base[def.id],
        results: targets.map((target) => ({
          target,
          ...threshold((x) => {
            const d = dscrAt(x)
            return d.ok && d.value < target
          }, base[def.id], SEARCH_LIMIT[def.id], (x) => dscrAt(x).value),
        })),
      }
    })

  const money = defs
    .filter((d) => MONEY_LEVERS.includes(d.id))
    .map((def) => ({
      def,
      from: base[def.id],
      ...threshold((x) => {
        const r = evaluateCase(start, stage, settings, { ...base, [def.id]: x })
        return r.ok && r.oneTime?.ok && r.oneTime.gap > 0
      }, base[def.id], SEARCH_LIMIT[def.id]),
    }))

  return { ok: true, stage, targets, coverage, money }
}

// ---------------------------------------------------------------------------------------------
// 2. One lever at a time
// ---------------------------------------------------------------------------------------------

const change = (from, to) => (isNum(from) && isNum(to) ? to - from : null)

// Returns { ok: false, reason, needs } or { ok: true, stage, base, together, coverage, money, value, quiet }.
//  coverage / money / value: one row per lever that the downside actually turns, worst first:
//    { def, setting, dscr: { from, to, change }, cashFlow: { change }, extraCost: { change }, gap: { change }, loanToValue: { from, to, change } }
//  together: the whole downside at once, and `sumOfDscrChanges`, the separate coverage effects added up (they do not
//  match exactly, because the levers act on each other).
//  quiet: the levers whose downside setting equals the Base setting, so there is nothing to isolate.
export function runImpacts(project, options = {}) {
  const prep = prepare(project, options)
  if (!prep.ok) return prep
  if (prep.refused) return { ok: false, ...prep.refused }
  const { stage, settings, defs, levers, start } = prep

  const base = evaluateCase(start, stage, settings, levers.base)
  const together = evaluateCase(start, stage, settings, levers.downside)
  const rows = []
  const quiet = []
  for (const def of defs) {
    if (levers.downside[def.id] === levers.base[def.id]) {
      quiet.push(def)
      continue
    }
    const alone = evaluateCase(start, stage, settings, { ...levers.base, [def.id]: levers.downside[def.id] })
    if (!alone.ok) continue
    rows.push({
      def,
      setting: levers.downside[def.id],
      dscr: { from: base.dscr, to: alone.dscr, change: change(base.dscr, alone.dscr) },
      cashFlow: { change: alone.cashFlow - base.cashFlow },
      extraCost: { change: (alone.oneTime?.ok ? alone.oneTime.extraCost : 0) - (base.oneTime?.ok ? base.oneTime.extraCost : 0) },
      gap: { change: (alone.oneTime?.ok ? alone.oneTime.gap : 0) - (base.oneTime?.ok ? base.oneTime.gap : 0) },
      loanToValue: { from: base.exit?.loanToValue ?? null, to: alone.exit?.loanToValue ?? null, change: change(base.exit?.loanToValue, alone.exit?.loanToValue) },
      noEffect: alone.noi === base.noi && alone.debtService === base.debtService && alone.oneTime?.extraCost === base.oneTime?.extraCost && alone.exit?.loanToValue === base.exit?.loanToValue,
    })
  }

  // Worst first. Coverage by how much DSCR is lost (a rate that stops affecting DSCR falls back to the cash lost);
  // one-time money by the cost it adds.
  const coverage = rows.filter((r) => COVERAGE_LEVERS.includes(r.def.id)).sort((a, b) => (a.dscr.change ?? 0) - (b.dscr.change ?? 0) || a.cashFlow.change - b.cashFlow.change)
  const money = rows.filter((r) => MONEY_LEVERS.includes(r.def.id)).sort((a, b) => b.extraCost.change - a.extraCost.change)
  const value = rows.filter((r) => r.def.id === 'exitCapRate')

  return {
    ok: true,
    stage,
    base,
    together: { ...together, dscrChange: change(base.dscr, together.dscr), sumOfDscrChanges: coverage.reduce((t, r) => t + (r.dscr.change ?? 0), 0) },
    coverage,
    money,
    value,
    quiet,
  }
}
