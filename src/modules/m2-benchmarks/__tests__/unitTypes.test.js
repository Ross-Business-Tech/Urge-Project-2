import test from 'node:test'
import assert from 'node:assert/strict'
import { unitTypesIn, unitTypeChoices, typeName, STANDARD_TYPES } from '../unitTypes.js'

const project = (...rows) => ({ data: { residentialIncome: { rows: rows.map(([unitType, units]) => ({ unitType, units, monthlyRent: 1000 })) } } })

test('the types a workbook holds are read from its unit mix, in standard form, with unit counts and how they were written', () => {
  const found = unitTypesIn([project(['2 BR', 20], ['1-bdr', 40], ['one bedroom', 10], ['Studio', 5], ['Penthouse', 2])])
  assert.deepEqual(found, [
    { type: 'studio', units: 5, written: [] },
    { type: '1br', units: 50, written: ['1-bdr', 'one bedroom'] },
    { type: '2br', units: 20, written: ['2 BR'] },
    { type: 'penthouse', units: 2, written: [] },
  ])
})

test('every loaded project is read, a type is listed once, and blank or missing types are skipped', () => {
  const found = unitTypesIn([project(['1br', 10], ['', 3], [null, 4]), project(['1 BR', 6], ['3br', 8])])
  assert.deepEqual(found.map((t) => [t.type, t.units]), [['1br', 16], ['3br', 8]])
  assert.deepEqual(unitTypesIn(null), [])
  assert.deepEqual(unitTypesIn([null, {}, { data: {} }]), [])
})

test('a type without a usable unit count is still listed, with zero units counted', () => {
  assert.deepEqual(unitTypesIn([project(['2br', null])]), [{ type: '2br', units: 0, written: [] }])
})

test('the dropdown lists the workbook’s types first, then only the standard types the workbook does not have', () => {
  const found = unitTypesIn([project(['1-bdr', 40], ['2 BR', 1])])
  const c = unitTypeChoices(found)
  assert.deepEqual(c.inWorkbook.map((t) => t.label), ['1 bedroom (1br): 40 units, written “1-bdr”', '2 bedroom (2br): 1 unit, written “2 BR”'])
  assert.deepEqual(c.standard.map((t) => t.type), ['studio', '3br', '4br'])
  assert.deepEqual(unitTypeChoices([]).standard.map((t) => t.type), STANDARD_TYPES)
  assert.deepEqual(unitTypeChoices(undefined).inWorkbook, [])
})

test('type names are plain words', () => {
  assert.equal(typeName('studio'), 'Studio')
  assert.equal(typeName('3br'), '3 bedroom (3br)')
  assert.equal(typeName('penthouse'), 'penthouse')
})
