// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║  M3D CUTOFFS: THE NUMBERS THAT DECIDE HIGH / MEDIUM / LOW                                ║
// ║                                                                                          ║
// ║  EVERY NUMBER IN THIS FILE IS A MADE-UP PLACEHOLDER, NOT AN INDUSTRY STANDARD.           ║
// ║  They are waiting for the real ranges from the team's lender / instructor.               ║
// ║                                                                                          ║
// ║  TO CHANGE ONE: edit the number on its line below, save, and that is all.                ║
// ║  The checks, the screen's "Cutoffs used" list and the tests all read from here.          ║
// ║  (If a test then fails, it is only because the test still expects the old number.)       ║
// ║                                                                                          ║
// ║  Percentages are decimals: 0.75 means 75%.  Months are whole months.                     ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════╝
//
// Two cutoffs are NOT here because they live in shared files that M0 owns:
//   - The lender's minimum DSCR (1.20) is a setting: src/modules/shared/settings.js, `minDscr`.
//   - The contingency range (5% to 10% of hard cost) is in the benchmark sets:
//     src/modules/shared/benchmarks/sets.js, `contingencyShare`. Both are made up too.

export const THRESHOLDS = {
  // ---- BUDGET ----------------------------------------------------------------------------
  // Contingency compared with the benchmark's LOW end (5%).
  //   below the low end ............ MEDIUM
  //   below this fraction of it .... HIGH   (0.5 = under half of the low end, so under 2.5%)
  contingencyHighBelowFractionOfLow: 0.5,

  // Contingency ABOVE a funder's cap. Some programs (MSHDA, per a reviewer's note) refuse a high contingency.
  // The cap is a placeholder: ask which program applies. Above it is MEDIUM. (Between the benchmark's high end and this cap is not flagged.)
  contingencyProgramCap: 0.15, // share of hard cost

  // Permits, tap fees and bonds as a share of hard cost before contingency (one line a reviewer questioned as "so high").
  permitsShareOfHard: { low: 0.02, medium: 0.04 }, // above the first is LOW, above the second is MEDIUM

  // All developer and related-party fees (developer, project management, construction management, consulting, other
  // related-party) as a share of total project cost.
  developerFeesShareOfCost: { low: 0.1, medium: 0.15 }, // above the first is LOW, above the second is MEDIUM

  // Soft costs as a share of hard costs. Outside the usual range is LOW...
  softToHardRange: { low: 0.1, high: 0.4 },
  // ...and outside this wider range is MEDIUM.
  softToHardFar: { low: 0.05, high: 0.6 },

  // ---- SCHEDULE --------------------------------------------------------------------------
  // Outside either range is MEDIUM.
  constructionMonths: { low: 6, high: 36 }, // construction start to completion
  leaseUpMonths: { low: 3, high: 24 }, // completion to stabilization
  // Still "development" after the planned completion date:
  //   up to this many months late ..... MEDIUM
  //   more than this many months late . HIGH
  slippedMonthsHigh: 6,

  // ---- MONEY AND TAKEOUT -----------------------------------------------------------------
  // (DSCR below the lender's minimum is always HIGH. The minimum itself is in settings.js.)
  // DSCR that clears the minimum by less than this much is a thin cushion: MEDIUM.
  dscrThinMargin: 0.1, // in times (0.10 means 1.20 to 1.29 with a 1.20 minimum)

  // Debt as a share of total project cost.
  debtToCost: { medium: 0.75, high: 0.85 }, // above the first is MEDIUM, above the second is HIGH

  // Stabilized income divided by the debt (what a permanent lender checks to refinance).
  debtYieldMin: { medium: 0.08, high: 0.07 }, // below the first is MEDIUM, below the second is HIGH

  // Reserves vs. what they must carry. The reserves are the Construction Interest, Rent-Up Reserve and Operating Reserve budget
  // lines (spec section 1b: the workbook has no line called "interest reserve"). What they must carry is the interest while
  // building (loans x rate x average drawn x months / 12) plus the loan payments through lease-up with no income.
  averageDrawn: 0.55, // average share of the loan outstanding while building
  interestReserve: { medium: 0.8, high: 0.5 }, // share of that estimate the reserves cover: under 80% MEDIUM, under 50% HIGH

  // ---- LOW-LEVEL FLAGS (no number to set) -----------------------------------------------
  // A missing or duplicated lien priority, a team role that is not named, and any check that
  // could not run because data is missing are all LOW.
  // Mezzanine debt ranked ahead of the senior loan is MEDIUM.
}

const pct = (n) => `${Math.round(n * 1000) / 10}%`

// The same cutoffs in plain words, built from the numbers above so the screen can never disagree with the checks.
// Each row: { topic, high, medium, low } where a blank means "no flag at this level".
export function cutoffRows(t = THRESHOLDS, { minDscr = 1.2, contingencyLow = 0.05, contingencyHigh = 0.1 } = {}) {
  return [
    { topic: 'Contingency (cushion for cost overruns), share of hard cost', high: `under ${pct(contingencyLow * t.contingencyHighBelowFractionOfLow)}`, medium: `under ${pct(contingencyLow)} (benchmark ${pct(contingencyLow)} to ${pct(contingencyHigh)})`, low: '' },
    { topic: 'Contingency above a program cap', high: '', medium: `over ${pct(t.contingencyProgramCap)} of hard cost`, low: '' },
    { topic: 'Permits, tap fees and bonds, share of hard cost', high: '', medium: `over ${pct(t.permitsShareOfHard.medium)}`, low: `over ${pct(t.permitsShareOfHard.low)}` },
    { topic: 'Developer and related-party fees, share of total cost', high: '', medium: `over ${pct(t.developerFeesShareOfCost.medium)}`, low: `over ${pct(t.developerFeesShareOfCost.low)}` },
    { topic: 'Soft costs, share of hard cost', high: '', medium: `under ${pct(t.softToHardFar.low)} or over ${pct(t.softToHardFar.high)}`, low: `under ${pct(t.softToHardRange.low)} or over ${pct(t.softToHardRange.high)}` },
    { topic: 'Dates out of order', high: 'any', medium: '', low: '' },
    { topic: 'Construction length', high: '', medium: `under ${t.constructionMonths.low} or over ${t.constructionMonths.high} months`, low: '' },
    { topic: 'Lease-up length (completion to stabilization)', high: '', medium: `under ${t.leaseUpMonths.low} or over ${t.leaseUpMonths.high} months`, low: '' },
    { topic: 'Past planned completion date, still in development', high: `more than ${t.slippedMonthsHigh} months late`, medium: `up to ${t.slippedMonthsHigh} months late`, low: '' },
    { topic: 'DSCR (income ÷ loan payments)', high: `under ${minDscr.toFixed(2)}×`, medium: `${minDscr.toFixed(2)}× to ${(minDscr + t.dscrThinMargin - 0.005).toFixed(2)}× (thin cushion)`, low: '' },
    { topic: 'Debt as a share of project cost', high: `over ${pct(t.debtToCost.high)}`, medium: `over ${pct(t.debtToCost.medium)}`, low: '' },
    { topic: 'Debt yield (income ÷ debt)', high: `under ${pct(t.debtYieldMin.high)}`, medium: `under ${pct(t.debtYieldMin.medium)}`, low: '' },
    { topic: 'Reserves (construction interest, rent-up, operating) vs. interest and lease-up loan payments', high: `cover under ${pct(t.interestReserve.high)}`, medium: `cover under ${pct(t.interestReserve.medium)}`, low: '' },
    { topic: 'A loan comes due before stabilization', high: 'any', medium: '', low: '' },
    { topic: 'Lien priority', high: '', medium: 'mezzanine ranked ahead of senior loan', low: 'blank or duplicate ranking' },
    { topic: 'Deferred or "Other" money larger than the budgeted fees', high: '', medium: '', low: 'any' },
    { topic: 'Team not fully named, or data missing', high: '', medium: '', low: 'any' },
  ]
}
