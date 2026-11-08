// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║  M3C CUTOFFS: THE NUMBERS THAT DECIDE HIGH / MEDIUM / LOW                     ║
// ║                                                                                          ║
// ║  EVERY NUMBER IN THIS FILE IS A MADE-UP PLACEHOLDER, NOT AN INDUSTRY STANDARD.           ║
// ║  They are waiting for the real ranges from the team's lender / instructor.               ║
// ║                                                                                          ║
// ║  TO CHANGE ONE: edit the number on its line below, save, and that is all.                ║
// ║  The checks and the tests read from here. (If a test then fails, it is only because      ║
// ║  the test still expects the old number.)                                                 ║
// ║                                                                                          ║
// ║  Percentages are decimals: 0.75 means 75%.  Months are whole months.                     ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════╝
//
// The lender's minimum DSCR, the occupancy floor and the rent premium are settings that M0 owns
// (src/modules/shared/settings.js), and the benchmark ranges are M0's too (shared/benchmarks/sets.js).

export const THRESHOLDS = {
  noiVsUnderwritten: { medium: 0.95, high: 0.8 }, // T-12 NOI as a share of underwritten NOI
  rentVsUnderwritten: { medium: 0.9, high: 0.75 },
  expenseOverUnderwritten: { medium: 1.1, high: 1.25 }, // T-12 expenses as a multiple of underwritten
  vacancyOverUnderwritten: { medium: 0.03, high: 0.08 }, // percentage points
  reservesPerUnitYear: 250,
  reassessedTaxRate: 0.012, // property tax as a share of what the property cost, if it were reassessed
  reassessmentTrigger: 0.7, // flagged when taxes are under this share of the reassessed amount
  maturityMonths: { high: 12, medium: 24 },
  keyExpenseLines: ['propertyManagement', 'propertyLiabilityInsurance', 'propertyTaxes', 'replacementReserves'],
  expectedExpenseLines: ['propertyManagement', 'propertyLiabilityInsurance', 'propertyTaxes', 'replacementReserves', 'electricHeatCommon', 'waterSewer', 'garbage', 'contractRepairs', 'groundsMaintenance'],
}
