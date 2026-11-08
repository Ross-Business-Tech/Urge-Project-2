// Writes the three sample sponsors into sample-files/sponsors/: a workbook per sponsor, a T-12 file per completed project,
// and a README with what M5 should show. Run: node src/modules/m5-sponsor/samples/writeSponsorFiles.mjs
// Everything here is made up. Load the workbooks in the app's "Load workbook" tab.
import { mkdirSync, writeFileSync } from 'node:fs'
import { recordsToWorkbook } from '../../shared/samples/toWorkbook.js'
import { buildT12Template } from '../../shared/import/t12Template.js'
import { sponsorSamples, buildSponsor, t12FileName, AS_OF } from './sponsorSamples.js'

const dir = new URL('../../../../sample-files/sponsors/', import.meta.url)
mkdirSync(dir, { recursive: true })

const lines = [
  '# Sample sponsors with a history',
  '',
  'Three made-up sponsors, each with a new building to review and a record of completed projects. Nothing here is real. They are for trying the **Sponsor** tab the way a real user would.',
  '',
  '## How to try one',
  '',
  '1. On the **Load workbook** tab, drop the sponsor\'s workbook (for example `proven-sponsor.xlsx`). One workbook holds the new building and every past project, one tab each.',
  `2. Open each project. For the new building choose the stage **Development**; for each past project choose **Completed**. Use ${AS_OF} as the "as of" date (the **Today** button also works).`,
  '3. For each past project, open its **Trailing 12 months** group and load that project\'s T-12 file (the file name ends with the project\'s name).',
  '4. Open the **Sponsor** tab. It shows the loaded sponsor first: the firm health score, the track record and credibility score, and the review flags.',
  '',
  'Without step 3 a past project has no T-12, so it cannot be compared with its underwriting and the track record shows "not available".',
  '',
]

for (const s of sponsorSamples) {
  writeFileSync(new URL(`${s.id}.xlsx`, dir), recordsToWorkbook(buildSponsor(s)))
  lines.push(`## ${s.title}`, '', `**File:** \`${s.id}.xlsx\``, '', s.what, '', '**T-12 files:**')
  for (const p of s.past) {
    writeFileSync(new URL(t12FileName(s, p), dir), buildT12Template({ rows: p.t12 }))
    lines.push(`- \`${t12FileName(s, p)}\` for ${p.name}`)
  }
  lines.push('', `**What M5 should show:** ${s.key.summary}`, '')
  lines.push(`- Credibility score: ${s.key.credibility.label}${s.key.credibility.min ? `, ${s.key.credibility.min}${s.key.credibility.max ? ` to ${s.key.credibility.max}` : ' or more'} out of 100` : ''}.`)
  for (const e of s.key.expect) lines.push(`- Raises \`${e.id}\` (${e.severity}).`)
  if (s.key.expect.length === 0) lines.push('- Raises no track record flag and no firm flag.')
  for (const f of s.key.forbid) lines.push(`- Stays quiet about \`${f}\`.`)
  for (const n of s.key.notes) lines.push(`- ${n}`)
  lines.push('')
}
lines.push('To rebuild these files after changing a sponsor: `node src/modules/m5-sponsor/samples/writeSponsorFiles.mjs`', '')
writeFileSync(new URL('README.md', dir), lines.join('\n'))
console.log('Wrote the sample sponsors to sample-files/sponsors/')
