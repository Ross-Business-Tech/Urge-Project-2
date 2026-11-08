import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { replaceT12Rows, applyStageAndDate, compareSeverity, validateFlag } from '../../shared/index.js'
import { run, checklist } from '../index.js'
import { looksLikePlaceholder, monthOf } from '../checks.js'

// Load a scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
async function load(s) {
  const out = await importWorkbook(recordsToWorkbook(s.build()))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  return { record, context: { firm: out.firm, facts: out.facts, report: out.report, projects: out.projects } }
}

for (const s of scenarios) {
  test(`${s.id}: M1 matches the answer key`, async () => {
    const { record, context } = await load(s)
    const { flags, notes } = run(record, context)
    assert.ok(!flags.some((f) => f.id === 'M1-check-failed'), `a check crashed: ${notes.join(' | ')}`)
    for (const f of flags) assert.deepEqual(validateFlag(f), [], f.id)
    for (const want of s.key.flags.filter((k) => k.module === 'M1')) {
      const got = flags.find((f) => f.id === want.id)
      if (want.must === false) assert.equal(got, undefined, `should not raise ${want.id}: ${got?.evidence}`)
      else {
        assert.ok(got, `should raise ${want.id}; got ${flags.map((f) => f.id).join(', ') || 'nothing'}`)
        assert.ok(compareSeverity(got.severity, want.severity) <= 0, `${want.id} is ${got.severity}, key wants at least ${want.severity}`)
      }
    }
  })
}

test('the healthy control raises no M1 flag at all, and every check passes or does not apply', async () => {
  for (const id of ['s01-healthy-development', 's10-healthy-project-failing-firm']) {
    const { record, context } = await load(scenarios.find((x) => x.id === id))
    assert.deepEqual(run(record, context).flags.map((f) => f.evidence), [], id)
    for (const r of checklist(record, context)) assert.ok(['pass', 'not_applicable'].includes(r.status), `${id} ${r.id}: ${r.detail}`)
  }
})

test('each planted problem is caught only by its own check (no noise on the other checks)', async () => {
  const expected = {
    's02-sources-not-equal-uses': ['M1-sources-uses'],
    's04-error-cells': ['M1-error-cells'],
    's05-template-residue': ['M1-template-residue'],
    's06-hidden-tab-with-data': ['M1-project-count'],
    's07-stage-contradicts-data': ['M1-stage-contradicted'],
    's11-missing-t12': ['M1-t12-missing'],
    's12-partial-t12': ['M1-t12-partial'],
    's13-typed-payment-too-low': ['M1-payment-override-low'],
    's14-rate-typed-as-whole-number': ['M1-implausible-input'],
    's15-equity-with-rate-and-term': ['M1-equity-with-payment-terms'],
    's16-typed-over-total': ['M1-typed-over-formula'],
  }
  for (const [id, ids] of Object.entries(expected)) {
    const { record, context } = await load(scenarios.find((x) => x.id === id))
    const got = run(record, context).flags.map((f) => f.id)
    assert.deepEqual(got, ids, id)
  }
})

test('error cells and typed-over totals name the exact cells', async () => {
  const s04 = await load(scenarios.find((x) => x.id === 's04-error-cells'))
  const e = run(s04.record, s04.context).flags.find((f) => f.id === 'M1-error-cells')
  assert.ok(e.cell_refs.includes('Development Project 1 Details!E139'))
  assert.ok(e.cell_refs.includes('Development Project 1 Details!H28'))
  const s16 = await load(scenarios.find((x) => x.id === 's16-typed-over-total'))
  const t = run(s16.record, s16.context).flags.find((f) => f.id === 'M1-typed-over-formula')
  assert.deepEqual([...t.cell_refs], ['Development Project 1 Budget!G102'])
  assert.match(t.evidence, /\$550,000/)
})

test('the stage is never changed, and the checks never crash without facts or a firm', async () => {
  const { record } = await load(scenarios.find((x) => x.id === 's07-stage-contradicts-data'))
  const before = JSON.stringify(record)
  const { flags } = run(record, {})
  assert.equal(JSON.stringify(record), before)
  assert.ok(flags.some((f) => f.id === 'M1-stage-contradicted'))
  assert.ok(flags.some((f) => f.id === 'M1-error-cells-missing'), 'missing facts are said out loud')
  assert.ok(!flags.some((f) => f.id === 'M1-check-failed'))
})

test('a project with no stage gets a "could not be checked" flag, not a crash', async () => {
  const out = await importWorkbook(recordsToWorkbook(scenarios[0].build()))
  const { flags } = run(out.projects[0], { firm: out.firm, facts: out.facts })
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [['M1-stage-missing', 'low']])
})

test('placeholder text and dates are recognised', () => {
  for (const t of ['Enter firm name here', 'Project Name', 'Enter address', 'TBD', '[Name]', 'Type name here']) assert.ok(looksLikePlaceholder(t), t)
  for (const t of ['Harbor View Lofts', 'Maple Ridge Partners', '1 Harbor Road', 'Example Bank', 'Retail']) assert.ok(!looksLikePlaceholder(t), t)
  assert.equal(monthOf('2026-03', false), 2026 * 12 + 2)
  assert.equal(monthOf('2027', true), 2027 * 12 + 11)
  assert.equal(monthOf(2027, false), 2027 * 12)
  assert.equal(monthOf('12/31/2025', true), 2025 * 12 + 11)
  assert.equal(monthOf('soon', true), null)
})
