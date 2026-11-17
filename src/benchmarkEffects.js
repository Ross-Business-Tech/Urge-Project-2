// What the team's benchmarks found in one project: for every range they entered, where the project stands against it, and what
// could not be compared. Everything is worked out from what the modules already report, so this never disagrees with the screens.
//
// One item for each benchmark that is in use:
//   { id, label, wanted, status, severity, text, screen }
//   status: 'within' | 'above' | 'below' | 'better' | 'not_available' | 'unused'
//   ('above' / 'below' are the risky side of a range and carry a flag. 'better' is outside the range on the good side: no flag.)
//   screen: the screen where the detail is shown
// notCompared: parts of the project that no benchmark covers (for example 2-bedroom units when only a 1-bedroom rent was entered).

import { keyOf, metricOf, usableEntries, toBenchmarkSets, normalizeUnitType, normalizeAmi } from './modules/shared/index.js'
import { compareProject, compareYours, rangeText } from './modules/m2-benchmarks/index.js'
import { checklist as devChecklist, appliesTo as devApplies } from './modules/m3d-development/index.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const rentKey = (unitType, ami) => keyOf({ metric: 'rent', unitType, ami })
const incomeLevel = (ami) => {
  const n = normalizeAmi(ami)
  return n ? ` at the ${n}% income level` : ' (market rate)'
}

export function benchmarkEffects(project, entries, { settings, firm } = {}) {
  const used = usableEntries(entries)
  const empty = { stage: project?.data?.stage?.stage ?? null, items: [], notCompared: [] }
  if (used.length === 0 || !project?.data?.stage?.stage) return empty
  const stage = project.data.stage.stage
  const sets = toBenchmarkSets(entries)
  const cmp = compareProject(project, { benchmarks: entries, benchmarkSets: sets, settings })
  const yours = compareYours(project, entries, { settings })
  const rowOf = (id) => cmp.rows.find((r) => r.id === id)
  // The flag for a row's metric and direction, which carries the severity (one flag covers every row of that metric and direction).
  const GROUP = { rent: 'rent', expense: 'expenses', cost: 'cost' }
  const groupFlag = (row) => cmp.flags.find((f) => f.id === `M2-${GROUP[row.metric]}-${row.status}-comps`)
  const KNOWN = ['within', 'above', 'below', 'better']
  const ofRow = (row) => ({ status: KNOWN.includes(row.status) ? row.status : 'not_available', severity: groupFlag(row)?.severity ?? null, text: row.detail })

  const units = project.data.residentialIncome.rows.map((r, i) => ({ r, i })).filter(({ r }) => isNum(r.monthlyRent) && r.monthlyRent > 0)
  const items = []

  for (const e of used) {
    const metric = metricOf(e.metric)
    const base = { id: e.id, label: metric.label, wanted: rangeText(e), screen: 'keynumbers' }

    if (metric.id === 'rent') {
      const label = `${metric.label}: ${normalizeUnitType(e.unitType)}${incomeLevel(e.ami)}`
      const mine = units.filter(({ r }) => rentKey(r.unitType, r.amiLevel) === keyOf(e))
      const rows = mine.map(({ i }) => rowOf(`rent-${i}`)).filter((r) => r && KNOWN.includes(r.status))
      if (mine.length === 0) {
        items.push({ ...base, label, status: 'unused', severity: null, text: 'No unit in this project matches this unit type and income level, so this range was not used.' })
      } else if (rows.length === 0) {
        const achieved = rowOf('rent-achieved') // lease-up with a T-12: achieved rent is compared as one figure across the unit mix
        items.push(achieved ? { ...base, label, ...ofRow(achieved), text: `Compared as one figure for all units, weighted by the unit mix. ${achieved.detail}` } : { ...base, label, status: 'not_available', severity: null, text: 'This project’s rents could not be compared with it.' })
      } else {
        const count = (s) => rows.filter((r) => r.status === s).length
        // The worst result stands for the group: a risky side first, then good news, then within.
        const worst = count('above') ? 'above' : count('below') ? 'below' : count('better') ? 'better' : 'within'
        const WORDS = { above: 'above your range', below: 'below your range', better: 'better than your range', within: 'within your range' }
        const parts = ['above', 'below', 'better', 'within'].filter(count).map((s) => `${count(s)} ${WORDS[s]}`)
        items.push({ ...base, label, status: worst, severity: groupFlag({ metric: 'rent', status: worst })?.severity ?? null, text: `${plural(rows.length, 'unit row')} of this type: ${parts.join(', ')}. ${(rows.find((r) => r.status === worst) ?? rows[0]).detail}` })
      }
    } else if (metric.id === 'expense') {
      const row = rowOf('expenses')
      items.push(row ? { ...base, ...ofRow(row) } : { ...base, status: 'not_available', severity: null, text: 'Operating expenses could not be compared.' })
    } else if (['costHard', 'costSoft', 'costTotal'].includes(metric.id)) {
      const part = { costHard: 'hard', costSoft: 'soft', costTotal: 'total' }[metric.id]
      const row = rowOf(`cost-${part}`) ?? rowOf('cost')
      if (stage === 'completed') items.push({ ...base, status: 'unused', severity: null, text: 'Cost ranges apply to projects being built. A completed project’s cost is already spent, so this range was not used.' })
      else items.push(row ? { ...base, ...ofRow(row) } : { ...base, status: 'not_available', severity: null, text: 'The cost could not be compared.' })
    } else if (metric.id === 'contingency') {
      const row = devApplies(project) ? devChecklist(project, { firm, settings, benchmarkSets: sets }).find((c) => c.id === 'contingency') : null
      if (!row) items.push({ ...base, screen: 'devrisk', status: 'unused', severity: null, text: 'Contingency is checked for projects being built, so this range was not used for this project.' })
      else if (row.status === 'pass') items.push({ ...base, screen: 'devrisk', status: 'within', severity: null, text: row.detail })
      else if (row.status === 'fail') {
        const f = row.flags[0]
        items.push({ ...base, screen: 'devrisk', status: f?.id === 'M3D-contingency-high' ? 'above' : 'below', severity: f?.severity ?? null, text: row.detail })
      } else items.push({ ...base, screen: 'devrisk', status: 'not_available', severity: null, text: row.detail })
    } else {
      const row = yours.rows.find((r) => r.id === `yours-${e.id}`)
      if (!row) items.push({ ...base, status: 'not_available', severity: null, text: 'This figure could not be compared.' })
      else {
        const known = KNOWN.includes(row.status)
        const f = yours.flags.find((x) => x.id === `M2-yours-${row.slug}-${row.status}`)
        items.push({ ...base, status: known ? row.status : 'not_available', severity: f?.severity ?? null, text: row.detail })
      }
    }
  }

  // Unit types in this project that no rent range covers. They are not compared, and are never compared with another type.
  const rentEntered = used.some((e) => e.metric === 'rent')
  const notCompared = []
  if (rentEntered) {
    const covered = new Set(used.filter((e) => e.metric === 'rent').map(keyOf))
    const missing = new Map()
    for (const { r } of units) {
      if (covered.has(rentKey(r.unitType, r.amiLevel))) continue
      const type = normalizeUnitType(r.unitType) || 'unit type not entered'
      const label = `${type}${incomeLevel(r.amiLevel)}`
      missing.set(label, (missing.get(label) ?? 0) + 1)
    }
    for (const [label, n] of missing) notCompared.push(`Rent for ${label}: no range entered, so ${plural(n, 'unit row')} not compared.`)
  }
  return { stage, items, notCompared }
}
