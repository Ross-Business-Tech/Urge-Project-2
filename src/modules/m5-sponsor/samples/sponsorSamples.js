// Three made-up sponsors, each with a new building to review and a history of completed projects, for trying M5 the way a
// real user would: load the workbook, choose the stage Completed for each past project, and load each project's T-12 file.
// Everything here is invented (names, addresses, numbers). Built with the shared sample builders; nothing in shared/ changed.
//
// A sponsor has:
//   id, title, what      the file name, a plain title, and one sentence about the case
//   firm()               the sponsor firm record
//   newBuild()           the project under review (stage: development)
//   past: [{ name, kind, record(), t12 }]   completed projects, each with its T-12 rows (or none)
//   key                  what M5 should show, in plain words and as checks the test applies

import { healthyFirm, healthyProject } from '../../shared/samples/baseline.js'

export const AS_OF = '2026-01-15'

// Twelve T-12 months, 2024-12 to 2025-11. Rent and expenses follow the underwritten project (see healthyProject), scaled by
// units and rent. rentFactor and occupancy make a project do worse than promised; `poorMonths` makes the first months miss
// (at `poorFactor` of the promised rent), which is how a project that stabilizes late looks.
function t12(units, rent, { occupancy = 0.95, rentFactor = 1, poorMonths = 0, poorFactor = 0.5 } = {}) {
  return Array.from({ length: 12 }, (_, i) => {
    const t = 2025 * 12 - 1 + i
    const month = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
    const poor = i < poorMonths
    const potential = Math.round(units * rent * (poor ? poorFactor : rentFactor))
    return {
      month,
      residentialRevenue: potential,
      commercialRevenue: 8333,
      otherRevenue: 1000,
      vacancyLoss: Math.round(potential * (1 - occupancy)),
      concessions: 0,
      occupancy,
      propertyManagement: 4167,
      propertyTaxes: 10000,
      replacementReserves: 1667,
      otherExpenses: 833,
    }
  })
}

// A completed project: the underwriting (rent roll, vacancy, sources, the date it was meant to stabilize) and its T-12.
function past({ name, address, units, rent, stabilization, start, completion, size = 1, ...t12Options }) {
  return {
    name,
    kind: 'completed',
    t12: t12(units, rent, t12Options),
    record: () => {
      const p = healthyProject({ name })
      p.data.identity.address = address
      p.data.timeline = { constructionStart: start, constructionCompletion: completion, stabilization }
      p.data.residentialIncome.rows = [{ amiLevel: null, unitType: '1-bdr', units, baths: 1, sqft: 700, monthlyRent: rent }]
      if (size !== 1) p.data.sources.rows = p.data.sources.rows.map((s) => ({ ...s, amount: typeof s.amount === 'number' ? s.amount * size : s.amount }))
      return p
    },
  }
}

const building = (name, address) => () => {
  const p = healthyProject({ name })
  p.data.identity.address = address
  return p
}

export const sponsorSamples = [
  {
    id: 'proven-sponsor',
    title: 'Proven sponsor: three projects delivered, one new building',
    what: 'Cedar Hollow Partners has finished three projects. Two met their underwriting; the third took two months longer than promised to stabilize. It now proposes a building about the size of its past ones.',
    firm: () => healthyFirm({ name: 'Cedar Hollow Partners', principal: 'Riley Example' }),
    newBuild: building('Harbor View Lofts', '1 Harbor Road'),
    past: [
      past({ name: 'Alder Court', address: '12 Alder Street', units: 40, rent: 1500, start: '2021-03', completion: '2022-09', stabilization: '2025-03' }),
      past({ name: 'Willow Street Flats', address: '48 Willow Street', units: 36, rent: 1450, start: '2021-09', completion: '2023-01', stabilization: '2025-01', poorMonths: 3, poorFactor: 0.8, occupancy: 0.96 }),
      past({ name: 'Maple Row Townhomes', address: '7 Maple Row', units: 48, rent: 1550, start: '2022-02', completion: '2023-06', stabilization: '2025-06', occupancy: 0.97 }),
    ],
    key: {
      summary: 'A clean record: the credibility score is Strong and M5 raises no flag.',
      credibility: { label: 'Strong', min: 90, projectsScored: 3 },
      expect: [],
      forbid: ['M5-no-track-record', 'M5-track-record-weak', 'M5-track-record-failing', 'M5-scale-step-up'],
      notes: ['Willow Street Flats leased up slowly at first: it passed the stability test two months after its target and its rents ran a little behind. Its card shows "Behind" on those two rows, but its own score stays at 90, so it is not flagged.'],
    },
  },
  {
    id: 'mixed-record-sponsor',
    title: 'Mixed record: one project on target, one fell short',
    what: 'Granite Bay Development delivered one project as promised. The other earned far less than underwritten, with rents and occupancy well below plan, and is still not stable. It now proposes a new building.',
    firm: () => healthyFirm({ name: 'Granite Bay Development', principal: 'Sam Example' }),
    newBuild: building('Lakeside Terrace', '300 Lake Drive'),
    past: [
      past({ name: 'Juniper Commons', address: '5 Juniper Lane', units: 40, rent: 1500, start: '2021-05', completion: '2022-10', stabilization: '2025-03' }),
      past({ name: 'Birch Row', address: '90 Birch Row', units: 40, rent: 1500, start: '2021-08', completion: '2023-02', stabilization: '2025-03', rentFactor: 0.85, occupancy: 0.85 }),
    ],
    key: {
      summary: 'The average hides a failure, so M5 flags the weak project on its own. The credibility score is Adequate, not Strong.',
      credibility: { label: 'Adequate', min: 55, max: 74, projectsScored: 2 },
      expect: [{ id: 'M5-delivery-shortfall-birch-row', severity: 'high' }],
      forbid: ['M5-delivery-shortfall-juniper-commons', 'M5-no-track-record', 'M5-scale-step-up'],
      notes: ['Birch Row scores about 11 out of 100 on its own: income was 74% of underwritten, rents 85%, occupancy 10 points low.'],
    },
  },
  {
    id: 'big-step-up-sponsor',
    title: 'Big step up: a small past project, a much larger new building',
    what: 'Larkspur Builders delivered one small project well. It now proposes a building four times the size of anything it has completed.',
    firm: () => healthyFirm({ name: 'Larkspur Builders', principal: 'Jordan Example' }),
    newBuild: building('Summit Tower', '1 Summit Plaza'),
    past: [past({ name: 'Pebble Creek Cottages', address: '22 Pebble Creek Road', units: 40, rent: 1500, start: '2021-04', completion: '2022-08', stabilization: '2025-03', size: 0.25 })],
    key: {
      summary: 'The past project was delivered well, so the delivery parts are strong, but the size jump is the risk: M5 raises the scale flag.',
      credibility: { label: 'Strong', min: 75, projectsScored: 1 },
      expect: [{ id: 'M5-scale-step-up', severity: 'high' }],
      forbid: ['M5-delivery-shortfall-pebble-creek-cottages', 'M5-no-track-record'],
      notes: ['With only one completed project, the credibility score rests on a single data point and the page says so.'],
    },
  },
]

// What a user would have on disk for one sponsor: the workbook's records and, per completed project, its T-12 rows.
export const buildSponsor = (sample) => ({
  firm: sample.firm(),
  projects: [{ record: sample.newBuild(), kind: 'development' }, ...sample.past.map((p) => ({ record: p.record(), kind: 'completed' }))],
})

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
export const t12FileName = (sample, project) => `${sample.id}-t12-${slug(project.name)}.xlsx`
