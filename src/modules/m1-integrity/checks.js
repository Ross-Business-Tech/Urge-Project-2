// M1: Integrity checks (layer 1). "Can we trust the numbers at all?"
//
// Every check reads the project record, the firm record and the workbook facts that M0's importer returns. Nothing here
// re-reads the workbook, changes a record, or works out the stage. Each check returns one checklist row:
//
//   { id, title, status: 'pass' | 'fail' | 'not_checked' | 'not_applicable', detail, cells, flags }
//
// `run(project, context)` (index.js) collects the flags; the checklist on screen shows every row, so a check that could not
// run is visible instead of silently skipped.

import {
  firmSchema,
  projectSchema,
  totalSources,
  totalUses,
  monthlyPayment,
  missingDataFlag,
  citeCells,
  fmt,
  DEBT_SOURCE_TYPES,
  SOURCE_TYPES,
} from '../shared/index.js'
import { PROJECT_TAB } from '../shared/import/workbookMap.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const usd = (n) => fmt.usd(n)
const sourceName = (row, i) => row.name || `source ${i + 1}`
const typeLabel = (value) => SOURCE_TYPES.find((t) => t.value === value)?.label ?? 'no type'

// The firm tabs the importer reads. Errors on these, or on this project's own tabs, matter; elsewhere they are noise.
const FIRM_TABS = ['Cover', 'Balance Sheet', 'Principal PFS', 'Consol Financials & Projections', 'Cap Table']

// The workbook tabs this project came from.
export function projectTabs(record) {
  const details = record.meta?.sourceTab ?? null
  const budget = details && /^Development /.test(details) ? details.replace(/ Details$/, ' Budget') : null
  return { details, budget }
}

// ---------------------------------------------------------------------------------------------
// Dates. The timeline holds years ("2027") or months ("2027-06"); statements hold dates or periods ("2025").
// ---------------------------------------------------------------------------------------------

// A date-like value as a month number. `end` decides where a bare year lands: December (end) or January (start).
// Being generous this way means we only call something past or future when it clearly is.
export function monthOf(value, end) {
  if (isNum(value) && value >= 1900 && value <= 2200 && Number.isInteger(value)) return value * 12 + (end ? 11 : 0)
  if (typeof value !== 'string') return null
  const text = value.trim()
  let m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(text)
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1
  m = /^(?:FY\s*)?(\d{4})$/i.exec(text)
  if (m) return Number(m[1]) * 12 + (end ? 11 : 0)
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text) // 12/31/2025
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return Number(m[3]) * 12 + Number(m[1]) - 1
  m = /(\d{4})\s*$/.exec(text) // "Year ended 2025" and the like
  if (m) return Number(m[1]) * 12 + (end ? 11 : 0)
  return null
}
const monthText = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`

// ---------------------------------------------------------------------------------------------
// Building rows and flags
// ---------------------------------------------------------------------------------------------

function row(id, title, status, detail, { cells = [], flags = [] } = {}) {
  return { id, title, status, detail, cells, flags }
}

// A row for a check that could not run: it carries a low "could not be checked" flag naming what is missing.
function notChecked(ctx, id, title, missing, cells = []) {
  const flag = missingDataFlag({ module: 'M1', stage_used: ctx.stage, check: id, checkTitle: title, missing, cell_refs: cells })
  return row(id, title, 'not_checked', Array.isArray(missing) ? missing.join(' ') : missing, { cells, flags: [flag] })
}

// ---------------------------------------------------------------------------------------------
// 1. Sources equal uses
// ---------------------------------------------------------------------------------------------

function sourcesEqualUses(ctx) {
  const { record, flag, tabs } = ctx
  const title = 'Sources equal uses'
  const s = totalSources(record)
  const u = totalUses(record)
  const sourceCells = citeCells(record, record.data.sources.rows.map((_, i) => `sources.rows.${i}.amount`))
  if (!u.ok && ctx.stage === 'completed' && !Object.values(record.data.budget.lines).some((l) => isNum(l.amount))) {
    return row('sources-uses', title, 'not_applicable', 'Completed projects have no development budget in the workbook, so there are no uses to compare.')
  }
  if (!s.ok || !u.ok) {
    return notChecked(ctx, 'sources-uses', title, [!s.ok && s.reason, !u.ok && u.reason].filter(Boolean), sourceCells)
  }
  const gap = s.value - u.value
  const share = Math.abs(gap) / u.value
  const detail = `Sources ${usd(s.value)} vs. uses ${usd(u.value)}.`
  if (Math.abs(gap) < 1) return row('sources-uses', title, 'pass', `${detail} They match.`)
  const cells = [...sourceCells, ...(tabs.budget ? [`${tabs.budget}!G102`] : [])]
  const short = gap < 0
  const f = flag({
    id: 'M1-sources-uses',
    severity: share >= 0.01 ? 'high' : 'medium',
    title: short ? 'The money raised does not cover the project cost.' : 'The money raised is more than the project cost.',
    evidence: `Sources ${usd(s.value)} vs. uses ${usd(u.value)}: a ${usd(Math.abs(gap))} ${short ? 'shortfall' : 'surplus'} (${fmt.pct(share)} of uses).`,
    cell_refs: cells,
    follow_up: short
      ? `Where will the remaining ${usd(Math.abs(gap))} come from? Please send an updated sources and uses that balance.`
      : `What is the extra ${usd(Math.abs(gap))} of sources for? Please send an updated sources and uses that balance.`,
  })
  return row('sources-uses', title, 'fail', `${detail} ${short ? 'Short' : 'Over'} by ${usd(Math.abs(gap))} (${fmt.pct(share)}).`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 2. No error values or broken formulas
// ---------------------------------------------------------------------------------------------

function errorCells(ctx) {
  const { facts, report, flag, tabs } = ctx
  const title = 'No error values or broken formulas'
  if (!facts || !Array.isArray(facts.sheets)) return notChecked(ctx, 'error-cells', title, 'The workbook facts are not available (load the workbook again).')
  const listed = Array.isArray(facts.errorCells) ? facts.errorCells : []
  const own = new Set([tabs.details, tabs.budget].filter(Boolean))
  const readCells = new Set((report?.errorCells ?? []).map((c) => `${c.tab}!${c.cell}`))
  const mine = listed.filter((c) => own.has(c.tab))
  const firmRead = listed.filter((c) => FIRM_TABS.includes(c.tab) && readCells.has(`${c.tab}!${c.cell}`))
  const elsewhere = facts.sheets.filter((s) => !own.has(s.name) && !FIRM_TABS.includes(s.name)).reduce((n, s) => n + (s.errorCount || 0), 0)
  const firmUnread = facts.sheets.filter((s) => FIRM_TABS.includes(s.name)).reduce((n, s) => n + (s.errorCount || 0), 0) - firmRead.length
  const ownTotal = facts.sheets.filter((s) => own.has(s.name)).reduce((n, s) => n + (s.errorCount || 0), 0)

  const noise = []
  if (elsewhere > 0) noise.push(`${plural(elsewhere, 'error cell')} on helper or other projects' tabs (not counted here)`)
  if (firmUnread > 0) noise.push(`${plural(firmUnread, 'error cell')} on firm tabs in cells this tool does not read`)
  const noiseText = noise.length ? ` Ignored: ${noise.join('; ')}.` : ''

  const found = [...mine, ...firmRead]
  if (found.length === 0 && ownTotal === 0) return row('error-cells', title, 'pass', `No error cells on this project's tabs or in the firm cells we read.${noiseText}`)

  const cells = found.slice(0, 50).map((c) => `${c.tab}!${c.cell}`)
  const sample = found.slice(0, 6).map((c) => `${c.tab}!${c.cell} (${c.value})`).join(', ')
  const count = Math.max(ownTotal, mine.length) + firmRead.length
  const f = flag({
    id: 'M1-error-cells',
    severity: 'high',
    title: `The workbook shows ${plural(count, 'Excel error')} in cells this review depends on.`,
    evidence: `${plural(count, 'error cell')}: ${sample}${found.length > 6 ? ', and more' : ''}. Values in these cells could not be read, so any figure built on them is missing.`,
    cell_refs: cells,
    follow_up: 'Several cells in your workbook show Excel errors (such as #REF! or #DIV/0!). Please fix the formulas and send the corrected workbook.',
  })
  return row('error-cells', title, 'fail', `${plural(count, 'error cell')}: ${sample}${found.length > 6 ? ', …' : ''}.${noiseText}`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 3. Template residue: placeholder text, and key fields left blank
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER = [
  /^enter\b/i,
  /\b(type|insert|enter|add)\b.*\bhere\b/i,
  /^(project|firm|development|property|company|sponsor|developer) name$/i,
  /^name of (the )?(firm|project|development|source)$/i,
  /^(street )?address( here)?$/i,
  /^(city|city, state,? zip)$/i,
  /^(tbd|tba|n\/?a|xxx+|x+|\?+|placeholder|sample|example|lorem ipsum.*|test)$/i,
  /^[[<{].*[\]>}]$/,
]
export const looksLikePlaceholder = (v) => typeof v === 'string' && PLACEHOLDER.some((re) => re.test(v.trim()))

function textFields(record, schema) {
  const out = []
  for (const g of schema) {
    const d = record.data[g.id]
    if (!d) continue
    const textKeys = (list) => (list || []).filter((f) => f.type === 'text').map((f) => f.key)
    if (g.kind === 'fields' || g.fields) for (const k of textKeys(g.fields)) out.push({ path: `${g.id}.${k}`, label: `${g.title}: ${g.fields.find((f) => f.key === k).label}`, value: d[k] })
    if (g.kind === 'table') d.rows?.forEach((r, i) => textKeys(g.columns).forEach((k) => out.push({ path: `${g.id}.rows.${i}.${k}`, label: `${g.title} row ${i + 1}: ${g.columns.find((c) => c.key === k).label}`, value: r[k] })))
    if (g.kind === 'grid') for (const r of g.rows) textKeys(g.columns).forEach((k) => out.push({ path: `${g.id}.lines.${r.key}.${k}`, label: `${g.title}, ${r.label}: ${g.columns.find((c) => c.key === k).label}`, value: d.lines?.[r.key]?.[k] }))
  }
  return out
}

function templateResidue(ctx) {
  const { record, firm, flag } = ctx
  const title = 'No template text left in'
  const hits = []
  for (const [rec, schema, who] of [[firm, firmSchema, 'Firm'], [record, projectSchema, 'Project']]) {
    if (!rec) continue
    for (const f of textFields(rec, schema)) if (looksLikePlaceholder(f.value)) hits.push({ ...f, rec, who })
  }
  if (hits.length === 0) return row('template-residue', title, 'pass', 'No placeholder wording found in the names, addresses and descriptions.')
  const cells = hits.flatMap((h) => citeCells(h.rec, [h.path]))
  const list = hits.slice(0, 6).map((h) => `${h.label} says "${String(h.value).trim().slice(0, 40)}"`).join('; ')
  const f = flag({
    id: 'M1-template-residue',
    severity: 'medium',
    title: 'The applicant left template placeholder text in the workbook.',
    evidence: `${plural(hits.length, 'field')} still hold placeholder wording: ${list}${hits.length > 6 ? '; and more' : ''}.`,
    cell_refs: cells,
    follow_up: 'Some parts of the form still show the template wording (for example the names or address). Please complete them and confirm the rest of the workbook is final.',
  })
  return row('template-residue', title, 'fail', `${list}${hits.length > 6 ? '; …' : ''}.`, { cells, flags: [f] })
}

// The fields a review cannot do without, by stage.
function keyFieldsFilled(ctx) {
  const { record, firm, flag } = ctx
  const title = 'Key fields are filled in'
  const d = record.data
  const missing = []
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  if (firm && blank(firm.data.identity.name)) missing.push({ label: 'firm name', path: 'identity.name', rec: firm })
  if (blank(d.identity.name)) missing.push({ label: 'project name', path: 'identity.name', rec: record })
  if (blank(d.identity.address)) missing.push({ label: 'project address', path: 'identity.address', rec: record })
  for (const k of ['constructionStart', 'constructionCompletion', 'stabilization']) {
    if (blank(d.timeline[k])) missing.push({ label: `${k === 'constructionStart' ? 'construction start' : k === 'constructionCompletion' ? 'construction completion' : 'stabilization'} date`, path: `timeline.${k}`, rec: record })
  }
  if (!d.sources.rows.some((r) => isNum(r.amount) && r.amount > 0)) missing.push({ label: 'sources of money', path: 'sources.rows', rec: record })
  if (ctx.stage !== 'completed' && !Object.values(d.budget.lines).some((l) => isNum(l.amount) && l.amount > 0)) missing.push({ label: 'development budget', path: 'budget.lines', rec: record })
  if (!d.residentialIncome.rows.length && !d.commercialIncome.rows.length) missing.push({ label: 'rent roll (residential or commercial income)', path: 'residentialIncome.rows', rec: record })
  if (!Object.values(d.operatingExpenses.lines).some((l) => isNum(l.amount) && l.amount > 0)) missing.push({ label: 'operating expenses', path: 'operatingExpenses.lines', rec: record })
  if (missing.length === 0) return row('key-fields', title, 'pass', 'Names, address, timeline, sources, income and expenses are all entered.')
  const cells = missing.flatMap((m) => citeCells(m.rec, [m.path]))
  const list = missing.map((m) => m.label).join(', ')
  const f = flag({
    id: 'M1-unfilled-fields',
    severity: missing.length >= 3 ? 'medium' : 'low',
    title: 'Parts of the applicant form were left blank.',
    evidence: `Blank: ${list}.`,
    cell_refs: cells,
    follow_up: `Please fill in the parts of the form that were left blank: ${list}.`,
  })
  return row('key-fields', title, 'fail', `Blank: ${list}.`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 4. Cross-tab tie-outs: a total typed over its formula must still equal its parts
// ---------------------------------------------------------------------------------------------

function typedOverFormula(ctx) {
  const { record, facts, flag, tabs } = ctx
  const title = 'Totals match their parts (no typed-over formulas)'
  if (!facts || !Array.isArray(facts.sheets)) return notChecked(ctx, 'typed-over', title, 'The workbook facts are not available (load the workbook again).')
  const own = new Set([tabs.details, tabs.budget, ...FIRM_TABS].filter(Boolean))
  const typed = (facts.typedOver ?? []).filter((c) => own.has(c.tab))
  if (typed.length === 0) return row('typed-over', title, 'pass', 'Every total and subtotal we know of is still a formula.')

  // Where we can, compare the typed number with the total we work out from the parts.
  const ours = (c) => {
    if (c.tab === tabs.budget && c.cell === 'G102') return { label: 'total development costs', result: totalUses(record) }
    if (c.tab === tabs.details && c.cell === 'F42') return { label: 'total sources', result: totalSources(record) }
    return null
  }
  const lines = []
  let worst = 'low'
  for (const c of typed) {
    const o = ours(c)
    if (o?.result.ok && isNum(c.value)) {
      const diff = c.value - o.result.value
      if (Math.abs(diff) >= 1) {
        worst = 'medium'
        lines.push(`${c.tab}!${c.cell} (${o.label}) is a typed ${usd(c.value)}, but the lines add to ${usd(o.result.value)}: ${usd(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'}`)
      } else lines.push(`${c.tab}!${c.cell} (${o.label}) is a typed ${usd(c.value)}; it matches its lines today but will not update if they change`)
    } else {
      worst = 'medium'
      lines.push(`${c.tab}!${c.cell} is a typed ${isNum(c.value) ? c.value.toLocaleString('en-US') : 'value'} where the workbook expects a formula`)
    }
  }
  const total = Math.max(facts.typedOverTotal ?? 0, typed.length)
  const cells = typed.slice(0, 50).map((c) => `${c.tab}!${c.cell}`)
  const f = flag({
    id: 'M1-typed-over-formula',
    severity: worst,
    title: 'A total in the workbook was typed in by hand instead of being calculated.',
    evidence: `${lines.slice(0, 4).join('. ')}${lines.length > 4 ? '. And more' : ''}.`,
    cell_refs: cells,
    follow_up: `Why ${total === 1 ? 'was this total' : 'were these totals'} typed in rather than calculated? Please restore the formulas and confirm which figure is right.`,
  })
  return row('typed-over', title, 'fail', `${lines.join('. ')}.`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 5. The chosen stage is not clearly contradicted by the data
// ---------------------------------------------------------------------------------------------

const t12HasRent = (record) => record.data.t12.rows.some((r) => [r.residentialRevenue, r.commercialRevenue].some((v) => isNum(v) && v > 0))

function stageContradicted(ctx) {
  const { record, flag, asOf } = ctx
  const title = 'The chosen stage fits the data'
  if (asOf === null) return notChecked(ctx, 'stage-contradicted', title, 'The "as of" date is not chosen.')
  const t = record.data.timeline
  const reasons = []
  const paths = []
  const pastEnd = (v) => monthOf(v, true) !== null && monthOf(v, true) < asOf
  const futureStart = (v) => monthOf(v, false) !== null && monthOf(v, false) > asOf
  const asOfText = record.data.stage.asOfDate
  if (ctx.stage === 'development') {
    if (pastEnd(t.stabilization)) {
      reasons.push(`the stabilization date (${t.stabilization}) is before the "as of" date (${asOfText})`)
      paths.push('timeline.stabilization')
    } else if (pastEnd(t.constructionCompletion)) {
      reasons.push(`construction completion (${t.constructionCompletion}) is before the "as of" date (${asOfText})`)
      paths.push('timeline.constructionCompletion')
    }
    if (t12HasRent(record)) {
      reasons.push(`a T-12 with ${plural(record.data.t12.rows.length, 'month')} of collected rent is loaded`)
      paths.push('t12.rows.0.residentialRevenue')
    }
  }
  if (ctx.stage === 'completed') {
    if (futureStart(t.constructionCompletion)) {
      reasons.push(`construction completion (${t.constructionCompletion}) is after the "as of" date (${asOfText})`)
      paths.push('timeline.constructionCompletion')
    }
    if (!record.data.residentialIncome.rows.length && !record.data.commercialIncome.rows.length && !record.data.t12.rows.length) {
      reasons.push('there is no rent roll and no T-12')
      paths.push('residentialIncome.rows')
    }
  }
  if (ctx.stage === 'lease_up' && futureStart(t.constructionStart)) {
    reasons.push(`construction has not started yet (start ${t.constructionStart}, "as of" ${asOfText})`)
    paths.push('timeline.constructionStart')
  }
  const label = { development: 'development', lease_up: 'lease-up', completed: 'completed' }[ctx.stage]
  if (reasons.length === 0) return row('stage-contradicted', title, 'pass', `Nothing in the timeline or T-12 contradicts the ${label} stage you chose.`)
  const cells = citeCells(record, paths)
  const text = reasons.join('; ')
  const f = flag({
    id: 'M1-stage-contradicted',
    severity: 'medium',
    title: `The data does not look like a ${label} project.`,
    evidence: `Stage chosen: ${label}. But ${text}.`,
    cell_refs: cells,
    follow_up: 'Where does the project actually stand today: under construction, leasing up, or stabilized? Please confirm the dates and send current figures.',
  })
  return row('stage-contradicted', title, 'fail', `You chose ${label}, but ${text}. The stage is not changed; you decide.`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 6. The Cover's project count matches the project tabs that hold data (hidden tabs included)
// ---------------------------------------------------------------------------------------------

function projectCount(ctx) {
  const { firm, facts, flag } = ctx
  const title = "The Cover's project count matches the project tabs"
  if (!facts || !Array.isArray(facts.sheets)) return notChecked(ctx, 'project-count', title, 'The workbook facts are not available (load the workbook again).')
  if (!firm) return notChecked(ctx, 'project-count', title, 'The firm record is not available.')
  const tabs = facts.sheets.filter((s) => PROJECT_TAB.test(s.name) && s.hasData)
  const kindOf = (s) => (s.name.startsWith('Development') ? 'development' : 'completed')
  const problems = []
  const cells = []
  let severity = 'medium'
  for (const [kind, key, cell] of [['development', 'developmentProjectCount', 'Cover!C9'], ['completed', 'completedProjectCount', 'Cover!C10']]) {
    const declared = firm.data.identity[key]
    const found = tabs.filter((s) => kindOf(s) === kind).length
    if (!isNum(declared)) {
      if (found > 0) {
        problems.push(`the Cover does not say how many ${kind} projects there are, but ${plural(found, `${kind} tab`)} ${found === 1 ? 'has' : 'have'} data`)
        cells.push(cell)
      }
      continue
    }
    if (declared !== found) {
      severity = 'high'
      problems.push(`the Cover says ${plural(declared, `${kind} project`)}, but ${plural(found, 'tab')} ${found === 1 ? 'has' : 'have'} data`)
      cells.push(cell)
    }
  }
  const hidden = tabs.filter((s) => s.state !== 'visible')
  for (const s of hidden) {
    problems.push(`"${s.name}" is ${s.state === 'veryHidden' ? 'very hidden' : 'hidden'} but holds a project`)
    cells.push(`${s.name}!E3`)
  }
  if (problems.length === 0) return row('project-count', title, 'pass', `The Cover and the workbook agree: ${plural(tabs.length, 'project tab')} with data, none hidden.`)
  const text = problems.join('; ')
  const f = flag({
    id: 'M1-project-count',
    severity,
    title: hidden.length ? 'The workbook holds a project the applicant did not list, on a hidden tab.' : "The Cover's project count does not match the project tabs.",
    evidence: `${text[0].toUpperCase()}${text.slice(1)}.`,
    cell_refs: cells,
    follow_up: 'How many projects does the firm have in total? Please explain any hidden project tab and confirm whether it is part of this application.',
  })
  return row('project-count', title, 'fail', `${text[0].toUpperCase()}${text.slice(1)}.`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 7 and 8. Sources: a typed payment is not too low, and non-debt sources do not carry loan terms
// ---------------------------------------------------------------------------------------------

function paymentOverrideLow(ctx) {
  const { record, flag } = ctx
  const title = 'Typed loan payments are not lower than the loan terms give'
  const typed = record.data.sources.rows.map((r, i) => ({ r, i })).filter(({ r }) => isNum(r.paymentOverride) && r.paymentOverride > 0)
  if (typed.length === 0) return row('payment-override', title, 'pass', 'No source has a typed payment; every payment is calculated from its amount, rate and term.')
  const low = []
  const unchecked = []
  for (const { r, i } of typed) {
    const monthly = monthlyPayment(r.amount, r.interestRate, r.termMonths)
    if (monthly === null) {
      unchecked.push({ r, i })
      continue
    }
    const yearly = monthly * 12
    if (r.paymentOverride < yearly * 0.99) low.push({ r, i, yearly })
  }
  if (low.length) {
    const cells = citeCells(record, low.flatMap(({ i }) => [`sources.rows.${i}.paymentOverride`, `sources.rows.${i}.amount`, `sources.rows.${i}.interestRate`, `sources.rows.${i}.termMonths`]))
    const text = low.map(({ r, i, yearly }) => `"${sourceName(r, i)}": typed ${usd(r.paymentOverride)} a year vs. ${usd(yearly)} from ${usd(r.amount)} at ${fmt.pct(r.interestRate, 2)} over ${r.termMonths} months`).join('; ')
    const f = flag({
      id: 'M1-payment-override-low',
      severity: 'high',
      title: 'A typed loan payment is lower than the loan itself requires, which makes debt coverage look better.',
      evidence: `${text}.`,
      cell_refs: cells,
      follow_up: 'Why is the typed annual payment lower than the payment on the stated amount, rate and term? Please send the loan terms or term sheet that support it.',
    })
    return row('payment-override', title, 'fail', `${text}.`, { cells, flags: [f] })
  }
  if (unchecked.length) {
    const names = unchecked.map(({ r, i }) => `"${sourceName(r, i)}"`).join(', ')
    return notChecked(ctx, 'payment-override', title, `${names} ${unchecked.length === 1 ? 'has' : 'have'} a typed payment but no believable amount, rate and term to compare it with.`, citeCells(record, unchecked.map(({ i }) => `sources.rows.${i}.paymentOverride`)))
  }
  return row('payment-override', title, 'pass', `${plural(typed.length, 'typed payment')} checked; none is below what the loan terms give.`)
}

function equityWithTerms(ctx) {
  const { record, flag } = ctx
  const title = 'Equity, grants and "Other" sources have no loan terms'
  const odd = record.data.sources.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !DEBT_SOURCE_TYPES.includes(r.type) && isNum(r.amount) && r.amount > 0 && isNum(r.termMonths) && r.termMonths > 0 && isNum(r.interestRate))
  if (odd.length === 0) return row('equity-terms', title, 'pass', 'Only sources typed as debt carry a rate and a term.')
  const cells = citeCells(record, odd.flatMap(({ i }) => [`sources.rows.${i}.type`, `sources.rows.${i}.interestRate`, `sources.rows.${i}.termMonths`]))
  const text = odd.map(({ r, i }) => `"${sourceName(r, i)}" (${typeLabel(r.type)}, ${usd(r.amount)}) has a ${fmt.pct(r.interestRate, 2)} rate and a ${r.termMonths}-month term`).join('; ')
  const f = flag({
    id: 'M1-equity-with-payment-terms',
    severity: 'medium',
    title: 'A source that is not typed as debt has a rate and a term, so it is being counted as a loan.',
    evidence: `${text}. Its payments are included in debt service.`,
    cell_refs: cells,
    follow_up: 'Is this money a loan that must be repaid, or true equity or a grant? Please confirm its type and terms.',
  })
  return row('equity-terms', title, 'fail', `${text}. It is counted in debt service; confirm it is not a loan under the wrong label.`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 9. Values inside their believable range
// ---------------------------------------------------------------------------------------------

// Every number in a record that breaks its schema limits (or the shared trillion-dollar ceiling).
function outOfRange(rec, schema) {
  const hits = []
  const check = (def, value, path, label) => {
    if (!isNum(value) || !def) return
    const isPct = def.type === 'percent'
    const max = isNum(def.max) ? def.max : def.type === 'dollars' || def.type === 'number' ? 1e12 : null
    const min = isNum(def.min) ? def.min : def.type === 'dollars' ? -1e12 : null
    const bad = (min !== null && value < min) || (max !== null && value > max) || (def.integer && !Number.isInteger(value))
    if (!bad) return
    const shown = isPct ? `${Number((value * 100).toPrecision(6))}%` : value.toLocaleString('en-US')
    const why = isPct ? (value > 1 ? `; a percentage above 100% (typed ${value} instead of ${value}%?)` : '; a negative percentage') : def.integer && !Number.isInteger(value) ? '; it should be a whole number' : value < 0 ? '; it should not be negative' : '; it is past the believable limit'
    hits.push({ rec, path, text: `${label} is ${shown}${why}` })
  }
  for (const g of schema) {
    const d = rec.data[g.id]
    if (!d) continue
    for (const f of g.fields || []) check(f, d[f.key], `${g.id}.${f.key}`, f.label)
    if (g.kind === 'table') d.rows?.forEach((r, i) => (g.columns || []).forEach((c) => check(c, r[c.key], `${g.id}.rows.${i}.${c.key}`, `${g.title} row ${i + 1}, ${c.label.toLowerCase()}`)))
    if (g.kind === 'grid') for (const r of g.rows) (g.columns || []).forEach((c) => check(c, d.lines?.[r.key]?.[c.key], `${g.id}.lines.${r.key}.${c.key}`, `${r.label}${g.columns.length > 1 ? ` (${c.label.toLowerCase()})` : ''}`))
  }
  return hits
}

function believableValues(ctx) {
  const { record, firm, flag } = ctx
  const title = 'Every value is inside its believable range'
  const hits = [...outOfRange(record, projectSchema), ...(firm ? outOfRange(firm, firmSchema) : [])]
  if (hits.length === 0) return row('implausible', title, 'pass', 'Rates, percentages, amounts and terms are all within believable limits.')
  const cells = hits.flatMap((h) => citeCells(h.rec, [h.path])).slice(0, 50)
  const text = hits.slice(0, 5).map((h) => h.text).join('. ')
  const f = flag({
    id: 'M1-implausible-input',
    severity: 'high',
    title: 'A number in the workbook is outside its believable range, so the calculations that use it are refused.',
    evidence: `${text}${hits.length > 5 ? `. And ${hits.length - 5} more` : ''}.`,
    cell_refs: cells,
    follow_up: 'Some figures look mistyped (for example a rate entered as 6.5 instead of 6.5%). Please check and correct them.',
  })
  return row('implausible', title, 'fail', `${text}${hits.length > 5 ? '. …' : ''}.`, { cells, flags: [f] })
}

// ---------------------------------------------------------------------------------------------
// 10. T-12 present (completed) and complete, and statements no more than 12 months old
// ---------------------------------------------------------------------------------------------

function t12Present(ctx) {
  const { record, flag } = ctx
  const title = 'A full T-12 is loaded'
  const rows = record.data.t12.rows
  const months = new Set(rows.map((r) => monthOf(r.month, false)).filter((m) => m !== null)).size
  if (ctx.stage === 'development') {
    return row('t12', title, 'not_applicable', rows.length ? `A T-12 is loaded (${plural(months, 'month')}); not expected for a development project.` : 'Not expected for a development project.')
  }
  if (rows.length === 0) {
    if (ctx.stage === 'lease_up') return row('t12', title, 'not_applicable', 'No T-12 loaded. Optional for a lease-up project, but actuals to date would help.')
    const f = flag({
      id: 'M1-t12-missing',
      severity: 'medium',
      title: 'This completed project has no trailing 12 months (T-12) of actual results.',
      evidence: 'Stage chosen: completed. No T-12 is loaded, so actual income and expenses cannot be checked.',
      cell_refs: ['T-12 template (not uploaded)'],
      follow_up: 'Please send the trailing 12 months of operating statements (T-12) for this property.',
    })
    return row('t12', title, 'fail', 'No T-12 is loaded for this completed project. Upload one from the "Trailing 12 months" group below.', { flags: [f] })
  }
  if (months < 12) {
    if (ctx.stage === 'lease_up') return row('t12', title, 'pass', `${plural(months, 'month')} of actuals loaded. A partial year is normal during lease-up.`)
    const f = flag({
      id: 'M1-t12-partial',
      severity: 'low',
      title: 'The T-12 covers less than a full year.',
      evidence: `Only ${months} of 12 months are provided.`,
      cell_refs: ['T-12 template'],
      follow_up: `Please send the remaining ${12 - months} months of the trailing 12 months.`,
    })
    return row('t12', title, 'fail', `Only ${months} of 12 months are loaded.`, { flags: [f] })
  }
  return row('t12', title, 'pass', `${plural(months, 'month')} of actuals loaded.`)
}

function freshness(ctx) {
  const { record, firm, flag, asOf } = ctx
  const title = 'Statements are no more than 12 months old'
  if (asOf === null) return notChecked(ctx, 'stale-statements', title, 'The "as of" date is not chosen.')
  const items = []
  const t12Months = record.data.t12.rows.map((r) => monthOf(r.month, false)).filter((m) => m !== null)
  if (t12Months.length) items.push({ label: 'T-12 (latest month)', month: Math.max(...t12Months), refs: ['T-12 template'] })
  if (firm) {
    const bs = firm.data.balanceSheet.currentPeriod
    if (bs) items.push({ label: 'firm balance sheet', raw: bs, month: monthOf(bs, true), refs: citeCells(firm, ['balanceSheet.currentPeriod']) })
    const pfs = firm.data.principalStatement.statementDate
    if (pfs) items.push({ label: "principal's personal statement", raw: pfs, month: monthOf(pfs, true), refs: citeCells(firm, ['principalStatement.statementDate']) })
  }
  const unreadable = items.filter((i) => i.month === null)
  const stale = items.filter((i) => i.month !== null && asOf - i.month > 12)
  const asOfText = record.data.stage.asOfDate
  if (stale.length) {
    const cells = stale.flatMap((s) => s.refs)
    const text = stale.map((s) => `${s.label} is from ${monthText(s.month)}, ${asOf - s.month} months before the "as of" date (${asOfText})`).join('; ')
    const f = flag({
      id: 'M1-stale-statements',
      severity: 'medium',
      title: 'Some financial statements are more than a year old.',
      evidence: `${text}.`,
      cell_refs: cells,
      follow_up: `Please send current versions of: ${stale.map((s) => s.label).join(', ')}.`,
    })
    return row('stale-statements', title, 'fail', `${text}.`, { cells, flags: [f] })
  }
  if (unreadable.length) {
    return notChecked(ctx, 'stale-statements', title, unreadable.map((u) => `The date of the ${u.label} ("${u.raw}") could not be read.`), unreadable.flatMap((u) => u.refs))
  }
  if (items.length === 0) return notChecked(ctx, 'stale-statements', title, 'No statement dates entered (balance sheet period or personal statement date).', ['Balance Sheet!B6', 'Principal PFS!B7'])
  const list = items.map((i) => `${i.label}: ${monthText(i.month)}`).join('; ')
  return row('stale-statements', title, 'pass', `${list[0].toUpperCase()}${list.slice(1)}. All within 12 months of ${asOfText}.`)
}

// ---------------------------------------------------------------------------------------------

export const CHECKS = [
  sourcesEqualUses,
  errorCells,
  templateResidue,
  keyFieldsFilled,
  typedOverFormula,
  stageContradicted,
  projectCount,
  paymentOverrideLow,
  equityWithTerms,
  believableValues,
  t12Present,
  freshness,
]
