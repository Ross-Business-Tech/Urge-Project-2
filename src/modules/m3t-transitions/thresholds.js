// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║  M3T CUTOFFS: THE NUMBERS THAT DECIDE HIGH / MEDIUM / LOW                     ║
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
  lateMonths: { medium: 6, high: 12 }, // estimated stabilization later than underwritten by this many months
  concessionShare: { medium: 0.05, high: 0.1 }, // free rent as a share of potential rent
  delayMonths: 6, // the delivery delay the reserves are tested against
  averageDrawn: 0.5, // on average half of a construction loan is drawn while it is being built
  refinanceWindowMonths: 36, // a loan due within this long is tested for refinancing
  refinanceRateShock: 0.02, // the refinance is tested at the loans' current rate plus this
  refinanceAmortizationMonths: 360,
  debtYieldMin: 0.08,
}
