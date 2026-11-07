// Writes the sample workbooks and T-12 files into sample-files/. Run: node src/modules/shared/samples/writeFiles.mjs
// Everything here is made up. Load them in the app's "Load workbook" tab.
import { mkdirSync, writeFileSync } from 'node:fs'
import { scenarios } from './scenarios.js'
import { recordsToWorkbook } from './toWorkbook.js'
import { buildT12Template } from '../import/t12Template.js'

const dir = new URL('../../../../sample-files/', import.meta.url)
mkdirSync(dir, { recursive: true })
for (const s of scenarios) {
  writeFileSync(new URL(`${s.id}.xlsx`, dir), recordsToWorkbook(s.build()))
  if (s.t12) writeFileSync(new URL(`${s.id}-t12.xlsx`, dir), buildT12Template({ rows: s.t12.rows }))
}
console.log(`Wrote sample files to sample-files/`)
