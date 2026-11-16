// Writes the fully filled-in example into sample-files/. Run: node src/modules/shared/samples/writeFullExample.mjs
// Everything here is made up.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fullExampleBuild, fullExampleT12, EXAMPLE_BENCHMARKS, EXAMPLE_BENCHMARKS_CHANGED_AT, FULL_EXAMPLE } from './fullExample.js'
import { recordsToWorkbook } from './toWorkbook.js'
import { buildT12Template } from '../import/t12Template.js'
import { serializeEntries } from '../index.js'

const dir = new URL('../../../../sample-files/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL(`${FULL_EXAMPLE.development.file}.xlsx`, dir), recordsToWorkbook(fullExampleBuild('development')))
writeFileSync(new URL(`${FULL_EXAMPLE.completed.file}.xlsx`, dir), recordsToWorkbook(fullExampleBuild('completed')))
writeFileSync(new URL(`${FULL_EXAMPLE.completed.file}-t12.xlsx`, dir), buildT12Template({ rows: fullExampleT12() }))
writeFileSync(new URL('full-example-benchmarks.json', dir), serializeEntries(EXAMPLE_BENCHMARKS, 'Made-up example ranges for trying the app. Not market data.', EXAMPLE_BENCHMARKS_CHANGED_AT))
console.log('Wrote the full example to sample-files/')
