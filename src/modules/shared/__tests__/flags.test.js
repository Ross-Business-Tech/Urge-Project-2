import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../index.js'
import { blankProject } from '../records.js'
import { roundNumberProject } from './helpers.js'

const good = () => ({
  id: 'M3D-contingency-low',
  module: 'M3D',
  stage_used: 'development',
  severity: 'high',
  title: 'The budget keeps very little money aside for surprises.',
  evidence: 'Contingency 2.1% of hard costs vs. a 5% to 10% benchmark.',
  cell_refs: ['Development Project 1 Budget!G40', 'Development Project 1 Budget!G45'],
  follow_up: 'Why is the construction contingency so low, and who covers an overrun?',
  transition: '',
})
const refuses = (change, pattern) => {
  const f = good()
  change(f)
  assert.throws(() => M.makeFlag(f), (e) => e instanceof M.FlagError && pattern.test(e.message))
}

// ---------------------------------------------------------------- a valid flag
test('a valid flag is created with its layer filled in, and cannot be changed afterwards', () => {
  const flag = M.makeFlag(good())
  assert.equal(flag.layer, 3, 'the layer comes from the module')
  assert.equal(flag.transition, '')
  assert.deepEqual(flag.cell_refs, ['Development Project 1 Budget!G40', 'Development Project 1 Budget!G45'])
  assert.ok(Object.isFrozen(flag) && Object.isFrozen(flag.cell_refs), 'frozen, so one module cannot alter another module\'s flag')
  assert.throws(() => { flag.severity = 'low' }, TypeError)
  assert.deepEqual(M.validateFlag(flag), [])
})

test('optional parts default sensibly, and a layer that is given must agree with the module', () => {
  const f = good()
  delete f.cell_refs
  delete f.transition
  const flag = M.makeFlag(f)
  assert.deepEqual(flag.cell_refs, [])
  assert.equal(flag.transition, '')
  assert.equal(M.makeFlag({ ...good(), layer: 3 }).layer, 3)
  refuses((x) => (x.layer = 2), /layer 2 does not match module M3D/)
})

test('every module has a layer, split modules are accepted, and transitions are limited', () => {
  assert.deepEqual(M.MODULE_LAYERS, { M1: 1, M2: 2, M3D: 3, M3C: 3, M3T: 3, M4: 4, M5: 5, M6: 6 })
  assert.equal(M.makeFlag({ ...good(), module: 'M3D-a' }).layer, 3)
  for (const t of ['T1', 'T2', 'T3']) assert.equal(M.makeFlag({ ...good(), module: 'M3T', id: 'M3T-delivery-late', transition: t }).transition, t)
  assert.equal(M.makeFlag({ ...good(), transition: null }).transition, '', 'null means no transition')
})

// ---------------------------------------------------------------- everything that can be wrong
test('a flag with a mistake is refused, with a plain message naming it', () => {
  refuses((f) => (f.severity = 'critical'), /severity/)
  refuses((f) => (f.severity = 'HIGH'), /severity/)
  refuses((f) => delete f.severity, /severity/)
  refuses((f) => (f.module = 'M9'), /module/)
  refuses((f) => (f.module = 'm3d'), /module/)
  refuses((f) => (f.module = 'M0'), /module/)
  refuses((f) => delete f.module, /module/)
  refuses((f) => (f.stage_used = 'Development'), /stage_used/)
  refuses((f) => (f.stage_used = null), /stage_used/)
  refuses((f) => (f.transition = 'T4'), /transition/)
  refuses((f) => (f.transition = 'next'), /transition/)
  refuses((f) => (f.id = 'contingency-low'), /id/)
  refuses((f) => (f.id = 'M1-contingency-low'), /id/) // an id must belong to the module that raised it
  refuses((f) => (f.id = 'M3D-Contingency Low'), /id/)
  refuses((f) => (f.id = 'M3D-'), /id/)
  refuses((f) => delete f.id, /id/)
})

test('the written parts must be real sentences, not blank or runaway', () => {
  for (const key of ['title', 'evidence', 'follow_up']) {
    refuses((f) => (f[key] = ''), new RegExp(key))
    refuses((f) => (f[key] = '   '), new RegExp(key))
    refuses((f) => delete f[key], new RegExp(key))
    refuses((f) => (f[key] = 42), new RegExp(key))
    refuses((f) => (f[key] = { text: 'x' }), new RegExp(key))
  }
  refuses((f) => (f.title = 'Line one\nLine two'), /title/)
  refuses((f) => (f.title = 'x'.repeat(201)), /title/)
  refuses((f) => (f.evidence = 'x'.repeat(1001)), /evidence/)
  refuses((f) => (f.follow_up = 'x'.repeat(501)), /follow_up/)
})

test('cell references must be a list of real text', () => {
  refuses((f) => (f.cell_refs = 'Budget!G40'), /cell_refs/)
  refuses((f) => (f.cell_refs = ['']), /cell_refs/)
  refuses((f) => (f.cell_refs = [42]), /cell_refs/)
  refuses((f) => (f.cell_refs = [null]), /cell_refs/)
  refuses((f) => (f.cell_refs = Array.from({ length: 60 }, (_, i) => `Budget!G${i}`)), /cell_refs/)
})

test('misspelled or extra fields are refused, so a typo cannot silently drop information', () => {
  refuses((f) => (f['follow-up'] = 'x'), /follow-up/)
  refuses((f) => (f.colour = 'red'), /colour/)
  refuses((f) => (f.constructor = 1), /constructor/)
  assert.throws(() => M.makeFlag(null), M.FlagError)
  assert.throws(() => M.makeFlag('flag'), M.FlagError)
  assert.throws(() => M.makeFlag([]), M.FlagError)
})

test('validateFlag lists every problem at once (for the module that combines flags)', () => {
  const problems = M.validateFlag({ ...good(), severity: 'critical', title: '', transition: 'T9' })
  assert.equal(problems.length, 3)
  assert.ok(problems.every((p) => typeof p === 'string'))
  assert.deepEqual(M.validateFlag(undefined), ['A flag must be an object.'])
})

test('severities can be compared', () => {
  assert.deepEqual(M.SEVERITIES, ['high', 'medium', 'low'])
  const order = ['low', 'high', 'medium'].sort(M.compareSeverity)
  assert.deepEqual(order, ['high', 'medium', 'low'], 'most serious first')
})

// ---------------------------------------------------------------- making flags for a project
test('a flag maker fills in the module and the stage the project was reviewed under', () => {
  const project = roundNumberProject('completed')
  const maker = M.createFlagMaker('M3C', project)
  const { title, evidence, follow_up, cell_refs } = good()
  const flag = maker.flag({ id: 'M3C-noi-short', severity: 'medium', title, evidence, follow_up, cell_refs })
  assert.equal(flag.module, 'M3C')
  assert.equal(flag.layer, 3)
  assert.equal(flag.stage_used, 'completed')
})

test('a lease-up project can run development checks, and the flag says so', () => {
  const maker = M.createFlagMaker('M3D', roundNumberProject('lease_up'))
  const { title, evidence, follow_up } = good()
  assert.equal(maker.flag({ id: 'M3D-budget-thin', severity: 'low', title, evidence, follow_up }).stage_used, 'lease_up')
  assert.equal(maker.flag({ id: 'M3D-budget-thin', severity: 'low', title, evidence, follow_up, stage_used: 'development' }).stage_used, 'development')
})

test('a project with no stage cannot be reviewed, and the maker says why', () => {
  assert.throws(() => M.createFlagMaker('M1', blankProject()), (e) => e instanceof M.FlagError && /stage/.test(e.message))
  assert.throws(() => M.createFlagMaker('M9', roundNumberProject()), (e) => e instanceof M.FlagError && /module/.test(e.message))
})

// ---------------------------------------------------------------- "can't check" flags
test('a check that cannot run becomes a low-severity flag naming what is missing', () => {
  const flag = M.missingDataFlag({ module: 'M3D', stage_used: 'development', check: 'contingency-low', checkTitle: 'Contingency size', missing: ['The development budget'], cell_refs: [] })
  assert.equal(flag.severity, 'low')
  assert.equal(flag.id, 'M3D-contingency-low-missing')
  assert.match(flag.title, /Contingency size/)
  assert.match(flag.title, /could not be checked/)
  assert.match(flag.evidence, /The development budget/)
  assert.match(flag.follow_up, /development budget/i)
  assert.deepEqual(M.validateFlag(flag), [])
})

test('several missing things are all listed', () => {
  const flag = M.missingDataFlag({ module: 'M1', stage_used: 'completed', check: 'sources-equal-uses', checkTitle: 'Sources equal uses', missing: ['The sources of money', 'The budget'] })
  assert.match(flag.evidence, /The sources of money/)
  assert.match(flag.evidence, /The budget/)
})

test('a calculator that says "not available" becomes a flag, and one that works gives none', () => {
  const noBudget = roundNumberProject('development')
  Object.values(noBudget.data.budget.lines).forEach((l) => (l.amount = null))
  const unavailable = M.keyRatios(noBudget).find((r) => r.id === 'debtToCost')
  const flag = M.flagFromUnavailable(unavailable, { module: 'M3D', stage_used: 'development', check: 'debt-to-cost', checkTitle: 'Debt-to-cost' })
  assert.equal(flag.severity, 'low')
  assert.match(flag.evidence, /No development budget entered/)
  assert.match(flag.follow_up, /Development budget/)
  assert.equal(M.flagFromUnavailable(M.keyRatios(roundNumberProject()).find((r) => r.id === 'debtToCost'), { module: 'M3D', stage_used: 'development', check: 'debt-to-cost', checkTitle: 'Debt-to-cost' }), null)
})

test('a refused (implausible) input can be flagged more seriously', () => {
  const p = roundNumberProject('development')
  p.data.residentialIncome.stabilizedVacancy = 8
  const r = M.dscr(p)
  const flag = M.flagFromUnavailable(r, { module: 'M1', stage_used: 'development', check: 'vacancy-range', checkTitle: 'Vacancy is believable', severity: 'medium' })
  assert.equal(flag.severity, 'medium')
  assert.match(flag.evidence, /vacancy/i)
})

// ---------------------------------------------------------------- citing cells
test('citeCells names where each number came from, in spreadsheet terms', () => {
  const rec = roundNumberProject()
  rec.sources['sources.rows.0.amount'] = 'Development Project 1 Details!F28'
  rec.sources['t12.rows.0.month'] = 'T-12 template!A5'
  rec.sources['identity.name'] = 'manual'
  const refs = M.citeCells(rec, ['sources.rows.0.amount', 't12.rows.0.month', 'identity.name', 'identity.address', 'sources.rows.0.amount'])
  assert.deepEqual(refs, ['Development Project 1 Details!F28', 'T-12 template!A5', 'identity.name (entered by hand)', 'identity.address (blank)'])
})

// ---------------------------------------------------------------- the module contract
test('a well-behaved module result passes through unchanged', () => {
  const project = roundNumberProject()
  const run = M.guardModule('M3D', (p) => ({ flags: [M.createFlagMaker('M3D', p).flag({ ...good(), module: undefined, stage_used: undefined })], notes: ['Ran 4 checks.'] }))
  const out = run(project, {})
  assert.equal(out.flags.length, 1)
  assert.equal(out.flags[0].id, 'M3D-contingency-low')
  assert.deepEqual(out.notes, ['Ran 4 checks.'])
})

test('a module that crashes is reported, not hidden, and does not stop the others', () => {
  const run = M.guardModule('M2', () => { throw new Error('benchmarks missing') })
  const out = run(roundNumberProject(), {})
  assert.equal(out.flags.length, 1)
  assert.equal(out.flags[0].id, 'M2-check-failed')
  assert.equal(out.flags[0].severity, 'medium')
  assert.equal(out.flags[0].module, 'M2')
  assert.ok(out.notes.some((n) => /benchmarks missing/.test(n)))
  assert.doesNotMatch(out.flags[0].evidence, /benchmarks missing/, 'the raw error text stays out of the plain-language flag')
})

test('malformed output is caught: bad flags are dropped, reported, and good ones are kept', () => {
  const p = roundNumberProject()
  const okFlag = M.createFlagMaker('M1', p).flag({ id: 'M1-sources-gap', severity: 'high', title: 'Sources do not equal uses.', evidence: 'Sources $5.55M vs. uses $5.4M.', follow_up: 'Where is the extra $150,000 going?' })
  const run = M.guardModule('M1', () => ({ flags: [okFlag, { ...good(), severity: 'critical' }, 'nonsense'], notes: [] }))
  const out = run(p, {})
  assert.equal(out.flags.filter((f) => f.id === 'M1-sources-gap').length, 1)
  assert.ok(out.flags.some((f) => f.id === 'M1-check-failed'))
  assert.ok(out.notes.some((n) => /severity/.test(n)))
  for (const f of out.flags) assert.deepEqual(M.validateFlag(f), [])
})

test('results that are not { flags, notes } are caught', () => {
  for (const bad of [undefined, null, 'flags', 42, [], { flags: 'x' }, Promise.resolve({ flags: [] })]) {
    const out = M.guardModule('M5', () => bad)(roundNumberProject(), {})
    assert.equal(out.flags[0].id, 'M5-check-failed', String(bad))
  }
})

test('the guard works even when the project is missing its stage, and an unknown module is refused up front', () => {
  const out = M.guardModule('M1', () => { throw new Error('x') })(blankProject(), {})
  assert.equal(out.flags[0].id, 'M1-check-failed')
  assert.match(out.notes.join(' '), /stage/i)
  assert.throws(() => M.guardModule('M9', () => ({ flags: [], notes: [] })), M.FlagError)
})

// ---------------------------------------------------------------- found by attacking the first version
test('a module cannot break the review by handing back objects that throw when read', () => {
  const project = roundNumberProject()
  const boom = () => { throw new Error('boom') }
  const bads = [
    () => ({ flags: [{ get id() { return boom() } }], notes: [] }),
    () => ({ flags: [new Proxy({}, { get: boom, ownKeys: boom, getOwnPropertyDescriptor: boom })], notes: [] }),
    () => ({ flags: [], get notes() { return boom() } }),
    () => ({ get flags() { return boom() } }),
  ]
  for (const bad of bads) {
    const out = M.guardModule('M3D', bad)(project, {})
    assert.ok(out.flags.some((f) => f.id === 'M3D-check-failed'), 'reported, not thrown')
  }
})

test('a module cannot pose as another module', () => {
  const project = roundNumberProject()
  const other = M.createFlagMaker('M1', project).flag({ id: 'M1-x-low', severity: 'low', title: 'T.', evidence: 'E.', follow_up: 'Q?' })
  const out = M.guardModule('M2', () => ({ flags: [other], notes: [] }))(project, {})
  assert.deepEqual(out.flags.map((f) => f.id), ['M2-check-failed'], 'the M1 flag is not passed off as M2\'s, and not as M1\'s either')
  assert.ok(out.notes.some((n) => /came from M1, not M2/.test(n)))
})

test('every flag that comes out of the guard is complete and frozen, even if it went in incomplete', () => {
  const project = roundNumberProject()
  const thin = Object.freeze({ id: 'M3D-x-low', module: 'M3D', stage_used: 'development', severity: 'low', title: 'T.', evidence: 'E.', follow_up: 'Q?' })
  const out = M.guardModule('M3D', () => ({ flags: [thin], notes: [] }))(project, {})
  const flag = out.flags[0]
  assert.equal(flag.layer, 3)
  assert.deepEqual(flag.cell_refs, [])
  assert.equal(flag.transition, '')
  assert.ok(Object.isFrozen(flag))
})

test('too many flags from one module are cut off and said so', () => {
  const project = roundNumberProject()
  const one = M.createFlagMaker('M3D', project).flag({ id: 'M3D-x-low', severity: 'low', title: 'T.', evidence: 'E.', follow_up: 'Q?' })
  const out = M.guardModule('M3D', () => ({ flags: Array.from({ length: 5000 }, () => one), notes: [] }))(project, {})
  assert.ok(out.flags.length <= 1001)
  assert.ok(out.notes.some((n) => /only the first 1000/.test(n)))
})

test('only a FlagError can come out of makeFlag, whatever it is given', () => {
  for (const junk of [Symbol('s'), () => 1, 10n, new Date(0), new Map(), NaN, Infinity, {}, [], '\n']) {
    for (const key of ['id', 'module', 'layer', 'stage_used', 'severity', 'title', 'evidence', 'cell_refs', 'follow_up', 'transition']) {
      const f = { ...good(), [key]: junk }
      try { M.makeFlag(f) } catch (e) { assert.ok(e instanceof M.FlagError, `${key}: ${String(e)}`) }
      assert.ok(Array.isArray(M.validateFlag(f)))
    }
  }
})

test('an own "__proto__" key is a refused unknown field, and cannot supply values from outside', () => {
  const evil = JSON.parse('{"__proto__": {"title": "Smuggled title."}, "id": "M3D-x-low", "module": "M3D", "stage_used": "development", "severity": "low", "evidence": "E.", "follow_up": "Q?"}')
  assert.throws(() => M.makeFlag(evil), (e) => e instanceof M.FlagError && /__proto__|title/.test(e.message))
  assert.equal(({}).title, undefined)
})

test('a flag whose fields change every time they are read cannot sneak past the checks', () => {
  let reads = 0
  const shifty = { ...good(), get severity() { return ++reads === 1 ? 'low' : 'critical' } }
  try {
    const flag = M.makeFlag(shifty)
    assert.ok(M.SEVERITIES.includes(flag.severity), 'whatever came out is a valid severity')
  } catch (e) {
    assert.ok(e instanceof M.FlagError)
  }
})

test('the written description of the flag format covers every field, in order', () => {
  const f = M.makeFlag(good())
  assert.deepEqual(M.FLAG_FIELD_DOCS.map((d) => d.field), Object.keys(f))
  assert.ok(M.FLAG_FIELD_DOCS.every((d) => d.meaning && d.rule))
})
