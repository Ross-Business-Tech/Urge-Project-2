// Made-up example reviews for the welcome screen, so anyone can see the tool working without an applicant workbook.
// Each one is built the same way a real upload is read: a fake workbook is written, then imported again.
// The sample data lives in the app only when someone taps a sample (it is loaded on demand).

import { importWorkbook, applyStageAndDate, DEFAULT_SETTINGS } from './modules/shared/index.js'

export const SAMPLES = [
  { id: 's01-healthy-development', label: 'A clean project', blurb: 'Everything adds up. See what a good result looks like.' },
  { id: 's03-thin-contingency', label: 'Thin safety margin', blurb: 'The budget keeps very little aside for surprises.' },
  { id: 's08-dscr-under-minimum', label: 'Weak loan coverage', blurb: 'Income barely covers the loan payments.' },
]

export async function buildSampleReview(id) {
  const [{ scenarios }, { recordsToWorkbook }] = await Promise.all([
    import('./modules/shared/samples/scenarios.js'),
    import('./modules/shared/samples/toWorkbook.js'),
  ])
  const scenario = scenarios.find((s) => s.id === id)
  if (!scenario) throw new Error(`Unknown sample: ${id}`)
  const bytes = recordsToWorkbook(scenario.build())
  const result = await importWorkbook(bytes, { fileName: `Sample: ${scenario.title}.xlsx` })
  const projects = result.projects.map((p) => applyStageAndDate(p, { stage: scenario.stage, asOfDate: scenario.asOf }))
  return { ...result, projects, settings: { ...DEFAULT_SETTINGS } }
}
