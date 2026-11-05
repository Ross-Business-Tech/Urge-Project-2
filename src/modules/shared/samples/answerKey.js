// Turns the scenario list into the written answer key (ANSWER-KEY.md).
import { scenarios } from './scenarios.js'

const SEV = { high: 'High', medium: 'Medium', low: 'Low' }

export function renderAnswerKey() {
  const out = [
    '# Sample workbooks: the answer key',
    '',
    'Generated from `scenarios.js`. Do not edit by hand: change the scenario and run `node src/modules/shared/samples/writeKey.mjs`.',
    '',
    'Every scenario is a made-up applicant workbook (cover version 1.9 layout), built from a healthy baseline with one thing broken on purpose. A module is correct for a scenario when it raises the flags below at (at least) the severity shown, and stays quiet where the key says "should not flag".',
    '',
    'The healthy baseline: total cost 5,550,000; one loan of 3,000,000 at 6% over 360 months; sponsor equity 2,000,000; deferred fee 550,000; stabilized NOI 586,000; DSCR 2.71. Settings are the defaults (minimum DSCR 1.20, occupancy floor 90%, rent premium 10%, stability streak 3 months).',
    '',
    '| Scenario | Stage | What is planted |',
    '|---|---|---|',
    ...scenarios.map((s) => `| ${s.id} | ${s.stage} | ${s.title} |`),
    '',
  ]
  for (const s of scenarios) {
    out.push(`## ${s.id}: ${s.title}`, '', `- **Stage chosen:** ${s.stage}. **As of:** ${s.asOf}.`, `- **Planted:** ${s.what}`)
    if (s.t12) out.push(`- **T-12:** ${s.t12.rows.length} month${s.t12.rows.length === 1 ? '' : 's'}, from ${s.t12.rows[0].month} to ${s.t12.rows.at(-1).month}.`)
    else out.push('- **T-12:** none.')
    const ratios = Object.entries(s.key.ratios)
    if (ratios.length) out.push(`- **Calculators:** ${ratios.map(([k, v]) => `${k} = ${v}`).join('; ')}.`)
    out.push('- **Modules should:**')
    for (const f of s.key.flags) {
      out.push(f.must === false ? `  - ${f.module} should not flag \`${f.id}\`. ${f.about}` : `  - ${f.module} raises \`${f.id}\` (${SEV[f.severity]} or higher). ${f.about}`)
    }
    out.push(`- **Overall:** ${s.key.summary}`, '')
  }
  return out.join('\n')
}
