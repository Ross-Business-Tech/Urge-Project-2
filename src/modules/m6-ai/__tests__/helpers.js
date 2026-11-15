// Loads a sample scenario the way an underwriter would: import the workbook, upload its T-12, choose the stage and date.
import { scenarios } from '../../shared/samples/scenarios.js'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { importWorkbook } from '../../shared/import/importWorkbook.js'
import { buildT12Template, parseT12Template } from '../../shared/import/t12Template.js'
import { applyStageAndDate, replaceT12Rows, DEFAULT_SETTINGS } from '../../shared/index.js'
import { collectFlags } from '../collect.js'
import { buildPayload } from '../payload.js'

export { scenarios }

export async function loadScenario(s, edit) {
  const built = s.build()
  if (edit) edit(built)
  const out = await importWorkbook(recordsToWorkbook(built))
  let record = applyStageAndDate(out.projects[0], { stage: s.stage, asOfDate: s.asOf })
  if (s.t12) record = replaceT12Rows(record, parseT12Template(buildT12Template({ rows: s.t12.rows })))
  const result = { ...out, projects: out.projects.map((p) => (p.meta?.projectId === record.meta?.projectId ? record : p)), settings: { ...DEFAULT_SETTINGS } }
  const { flags, notes } = collectFlags(record, { firm: out.firm, settings: result.settings, result })
  const { payload, map } = buildPayload({ record, firm: out.firm, settings: result.settings, result, flags, notes })
  return { record, firm: out.firm, result, settings: result.settings, flags, notes, payload, map }
}
