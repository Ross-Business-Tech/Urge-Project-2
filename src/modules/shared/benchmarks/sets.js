// The benchmark sets, one per stage. ALL NUMBERS ARE MADE UP, for building and testing M2. They are not market data.
// To use real figures later, replace the numbers here (the loader checks them) without touching the code that reads them.
//
// Every range is { low, median, high }. Rents are dollars per unit per month. Expenses are dollars per unit per year.
// Cost is dollars per square foot. Contingency is a share of hard cost (0.05 is 5%).
// A metric that does not apply to a stage is null (completed projects have no cost benchmark).

const r = (low, median, high) => ({ low, median, high })

// Market rents by unit type, scaled for each stage below. Rounded to the nearest 5 dollars.
const MARKET = { studio: [1100, 1250, 1400], '1br': [1300, 1500, 1700], '2br': [1650, 1900, 2150], '3br': [2000, 2300, 2600] }
// Affordable rents are a share of market rent at each AMI level (made up).
const AMI_SHARE = { 30: 0.4, 50: 0.62, 60: 0.72, 80: 0.88 }

const scaled = (factor) => {
  const round5 = (n) => Math.round((n * factor) / 5) * 5
  const rents = []
  for (const [unitType, [lo, mid, hi]] of Object.entries(MARKET)) {
    rents.push({ unitType, amiLevel: null, range: r(round5(lo), round5(mid), round5(hi)) })
    for (const [ami, share] of Object.entries(AMI_SHARE)) {
      rents.push({ unitType, amiLevel: Number(ami), range: r(round5(lo * share), round5(mid * share), round5(hi * share)) })
    }
  }
  return rents
}

export const BENCHMARK_SETS = {
  development: {
    stage: 'development',
    name: 'Development: projected rents against comparable new deliveries (made-up sample)',
    version: 1,
    madeUp: true,
    rents: scaled(1.0),
    expensePerUnitYear: r(5200, 5900, 6800),
    costPerSqft: { hard: r(160, 190, 230), soft: r(35, 45, 60), total: r(220, 270, 330) },
    contingencyShare: r(0.05, 0.075, 0.1),
  },
  lease_up: {
    stage: 'lease_up',
    name: 'Lease-up: achieved rents (net of concessions) against comps (made-up sample)',
    version: 1,
    madeUp: true,
    rents: scaled(0.97),
    expensePerUnitYear: r(5400, 6200, 7200),
    costPerSqft: { hard: r(160, 190, 230), soft: r(35, 45, 60), total: r(220, 270, 330) }, // remaining cost to finish
    contingencyShare: r(0.05, 0.075, 0.1),
  },
  completed: {
    stage: 'completed',
    name: 'Completed: in-place rents and T-12 expenses against comps (made-up sample)',
    version: 1,
    madeUp: true,
    rents: scaled(0.92),
    expensePerUnitYear: r(5000, 5800, 6800),
    costPerSqft: null,
    contingencyShare: null,
  },
}
