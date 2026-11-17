// Writes the demo pack into sample-files/demo/. Run: node src/modules/shared/samples/writeDemoPack.mjs
// Everything here is made up.
import { mkdirSync, writeFileSync } from 'node:fs'
import { recordsToWorkbook } from './toWorkbook.js'
import { buildT12Template } from '../import/t12Template.js'
import { serializeEntries } from '../index.js'
import { demoBuild, pastProjects, DEMO_BENCHMARKS, DEMO_BENCHMARKS_CHANGED_AT, DEMO_FILE } from './demoPack.js'
import { demoReviewText } from './demoReview.js'

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const dir = new URL('../../../../sample-files/demo/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL(`${DEMO_FILE.workbook}.xlsx`, dir), recordsToWorkbook(demoBuild()))
for (const p of pastProjects) writeFileSync(new URL(`demo-t12-${slug(p.name)}.xlsx`, dir), buildT12Template({ rows: p.t12 }))
writeFileSync(new URL(`${DEMO_FILE.benchmarks}.json`, dir), serializeEntries(DEMO_BENCHMARKS, 'Made-up example ranges for the demo. Not market data.', DEMO_BENCHMARKS_CHANGED_AT))
writeFileSync(new URL(`${DEMO_FILE.review}.json`, dir), await demoReviewText())
console.log('Wrote the demo pack to sample-files/demo/')
