import { firmSchema, projectSchema } from './modules/shared/index.js'

// A small line icon. `d` is one or more SVG path strings.
function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {[].concat(d).map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  )
}

// Every screen in the app. `needsReview` screens are empty until a workbook has been loaded.
export const VIEWS = [
  {
    id: 'import',
    label: 'Workbook',
    icon: <Icon d={['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6M9 17h4']} />,
    heading: 'Your workbook and projects',
    lede: 'Check what was read from the spreadsheet, choose each project’s stage, and edit any value. You can save the review as a file and reopen it later.',
  },
  {
    id: 'keynumbers',
    label: 'Key numbers',
    needsReview: true,
    icon: <Icon d={['M4 20V10M10 20V4M16 20v-7M22 20H2']} />,
    heading: 'The key numbers',
    lede: 'The main ratios for each project, and how they compare with typical ranges. Shows the projects in the workbook you loaded.',
  },
  {
    id: 'benchmarks',
    label: 'Benchmarks',
    icon: <Icon d={['M4 6h16M4 12h16M4 18h16', 'M8 4v4M15 10v4M10 16v4']} />,
    heading: 'Your benchmarks',
    lede: 'The ranges you trust for rents, interest rates, coverage and more. Every project is compared with these, and with nothing else. Change them whenever you like.',
  },
  {
    id: 'datachecks',
    label: 'Data checks',
    needsReview: true,
    icon: <Icon d={['M9 12l2 2 4-4', 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z']} />,
    heading: 'Can the workbook be trusted?',
    lede: 'Checks that the numbers in the workbook agree with each other. Shows the projects in the workbook you loaded.',
  },
  {
    id: 'scenarios',
    label: 'Scenarios',
    needsReview: true,
    icon: <Icon d={['M3 17l6-6 4 4 8-8', 'M15 7h6v6']} />,
    heading: 'Stress-test a project',
    lede: 'What happens to the loan in the downside, base and upside cases? Shows the projects in the workbook you loaded. Move the sliders to try your own numbers.',
  },
  {
    id: 'devrisk',
    label: 'Development risk',
    needsReview: true,
    icon: <Icon d={['M3 21h18', 'M5 21V9l7-5 7 5v12', 'M9 21v-6h6v6']} />,
    heading: 'What can go wrong while it is built',
    lede: 'Budget, schedule, loans and team checks for projects being built or filling. Shows the projects in the workbook you loaded.',
  },
  {
    id: 'completedrisk',
    label: 'Completed risk',
    needsReview: true,
    icon: <Icon d={['M12 3v18', 'M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6']} />,
    heading: 'Is it performing as promised?',
    lede: 'Actual results against the underwriting, expenses, vacancy and loan maturity for properties that are open. Shows the projects in the workbook you loaded.',
  },
  {
    id: 'transitions',
    label: 'Stage changes',
    needsReview: true,
    icon: <Icon d={['M5 12h14', 'M13 6l6 6-6 6']} />,
    heading: 'Will it make the next jump?',
    lede: 'Every project is heading for a hand-off: construction to leasing, leasing to stable, stable to refinance. This shows where a project is, which hand-off is next, and what could break it. Shows the projects in the workbook you loaded.',
  },
  {
    id: 'sponsor',
    label: 'Sponsor',
    needsReview: true,
    icon: <Icon d={['M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8']} />,
    heading: 'Can this sponsor deliver?',
    lede: 'How healthy is the sponsor firm? A score from 0 to 100 built from its cash, earnings and debt, and what it means for the projects. Shows the sponsor in the workbook you loaded.',
  },
  {
    id: 'firm',
    label: 'Firm record',
    icon: <Icon d={['M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16', 'M14 10h5a1 1 0 0 1 1 1v10', 'M8 8h2M8 12h2M8 16h2M3 21h18']} />,
    schema: firmSchema,
    heading: 'What we store about a firm',
    lede: 'The record structure, grouped the way the applicant workbook groups it. Tap a group to see its fields. Blue "new" tags mark things the workbook does not have.',
  },
  {
    id: 'project',
    label: 'Project record',
    icon: <Icon d={['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']} />,
    schema: projectSchema,
    heading: 'What we store about a project',
    lede: 'The record structure, grouped the way the applicant workbook groups it. Tap a group to see its fields. Blue "new" tags mark things the workbook does not have.',
  },
  {
    id: 'ai',
    label: 'AI second opinion',
    needsReview: true,
    icon: <Icon d={['M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z', 'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z']} />,
    heading: 'AI second opinion',
    lede: 'An optional second opinion that connects the biggest findings and screens the data lightly. The checks decide; the AI only advises, and nothing is sent until you press the button.',
  },
  {
    id: 'flags',
    label: 'Flag format',
    icon: <Icon d={['M5 21V4', 'M5 4h12l-2 4 2 4H5']} />,
    heading: 'What a flag looks like',
    lede: 'Every module reports what it finds in the same shape, so the findings can be combined and ranked.',
  },
]

// How the screens are grouped in the menu. The three "how it is stored" screens sit under Reference.
export const NAV_GROUPS = [
  { title: 'Start', ids: ['import'] },
  { title: 'Analysis', ids: ['keynumbers', 'benchmarks', 'datachecks', 'scenarios'] },
  { title: 'Risk', ids: ['devrisk', 'completedrisk', 'transitions', 'sponsor'] },
  { title: 'Optional', ids: ['ai'] },
  { title: 'Reference', ids: ['firm', 'project', 'flags'] },
]
