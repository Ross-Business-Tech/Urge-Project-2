// Made-up sponsors for trying the track record on the Sponsor page. The sample workbooks hold one project each, so none of
// them shows a sponsor with a history. These do. Everything here is invented. Each has the same shape as a sample scenario
// (so the page can list them together); a project may name its own stage, and the project under review comes first.

import { healthyFirm, healthyProject } from '../shared/samples/baseline.js'
import { t12Rows } from '../shared/samples/scenarios.js'

// The T-12 sample months run from 2024-12 to 2025-11, so a target of 2025-03 lets the stabilization test be worked out.
const finished = (name, rows, { stabilization = '2025-03', size = 1 } = {}) => {
  const p = healthyProject({ name })
  p.data.timeline = { constructionStart: '2022-01', constructionCompletion: '2023-06', stabilization }
  p.data.t12.rows = rows
  if (size !== 1) p.data.sources.rows = p.data.sources.rows.map((s) => ({ ...s, amount: typeof s.amount === 'number' ? s.amount * size : s.amount }))
  return { record: p, stage: 'completed' }
}

const newBuild = () => ({ record: healthyProject({ name: 'Harbor View Lofts' }), stage: 'development' })

const base = { stage: 'development', asOf: '2026-01-15' }

export const trackRecordDemos = [
  {
    ...base,
    id: 'm5-proven',
    title: 'Proven sponsor: two projects delivered, new build planned',
    what: 'Two earlier projects met their underwriting. A new building is being reviewed.',
    build: () => ({ firm: healthyFirm(), projects: [newBuild(), finished('Alder Court', t12Rows({})), finished('Willow Street Flats', t12Rows({ occupancy: 0.96 }))] }),
  },
  {
    ...base,
    id: 'm5-mixed',
    title: 'Mixed record: one project on target, one fell short',
    what: 'One earlier project met its underwriting. The other earned far less than promised and is still not stable. A new building is being reviewed.',
    build: () => ({ firm: healthyFirm(), projects: [newBuild(), finished('Alder Court', t12Rows({})), finished('Birch Row', t12Rows({ rentFactor: 0.85, occupancy: 0.85 }))] }),
  },
  {
    ...base,
    id: 'm5-big-step',
    title: 'Big step up: small past project, much larger new build',
    what: 'The one earlier project was delivered well, but it was one quarter the size of the new building.',
    build: () => ({ firm: healthyFirm(), projects: [newBuild(), finished('Alder Court', t12Rows({}), { size: 0.25 })] }),
  },
]
