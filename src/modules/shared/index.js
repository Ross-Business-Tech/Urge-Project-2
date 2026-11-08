// Everything other modules may import from the shared foundation (M0).
export { STAGES, SOURCE_TYPES, LEASE_TYPES, DEBT_SOURCE_TYPES } from './enums.js'
export { SCHEMA_VERSION, firmSchema, projectSchema } from './schema.js'
export { blankFirm, blankProject, blankTableRow, describeGroup, checkSchema } from './records.js'
export { importWorkbook, ImportError } from './import/importWorkbook.js'
export { MAX_FILE_BYTES } from './import/xlsxReader.js'
export { checkMapCoverage } from './import/workbookMap.js'
export { buildReview, serializeReview, parseReview, reviewFileName, ReviewFileError, MAX_REVIEW_BYTES } from './reviewFile.js'
export { STAGE_VALUES, isValidDate, applyStageAndDate, projectReadiness, reviewReadiness } from './projectStage.js'
export { formatForInput, parseInput, isEmpty } from './fieldFormat.js'
export { getValue, setValue, provenance, addTableRow, removeTableRow, countGroup, replaceT12Rows } from './recordEdit.js'
export { DEFAULT_SETTINGS, SETTING_DEFS, checkSetting, sanitizeSettings } from './settings.js'
export {
  totalSources,
  totalUses,
  totalDevelopmentCost,
  monthlyPayment,
  annualDebtService,
  totalDebt,
  noi,
  dscr,
  keyRatios,
  ratioIdsForStage,
  fmt,
} from './calculators.js'
export { buildT12Template, parseT12Template, T12_SHEET, T12_SOURCE, T12_TEMPLATE_VERSION } from './import/t12Template.js'
export {
  SEVERITIES,
  TRANSITIONS,
  MODULE_LAYERS,
  FLAG_FIELD_DOCS,
  FlagError,
  compareSeverity,
  validateFlag,
  makeFlag,
  createFlagMaker,
  missingDataFlag,
  flagFromUnavailable,
  citeCells,
  guardModule,
} from './flags.js'
export {
  checkBenchmarkSet,
  loadBenchmarks,
  normalizeUnitType,
  normalizeAmi,
  rentBenchmark,
  expenseBenchmark,
  costBenchmark,
  contingencyBenchmark,
  compareToRange,
} from './benchmarks/index.js'
export { BENCHMARK_SETS } from './benchmarks/sets.js'
