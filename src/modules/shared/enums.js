// Shared lists of allowed values. Built by M0; every module reads them from here.

// The stage is chosen by the underwriter. The tool never works it out.
export const STAGES = [
  { value: 'development', label: 'Development', plain: 'Being built, nothing operating' },
  { value: 'lease_up', label: 'Lease-up', plain: 'Built or delivering, still filling, not yet stable' },
  { value: 'completed', label: 'Completed', plain: 'Stabilized and operating with real history' },
]

// The kinds of money in a project's sources table (same list as the applicant workbook).
export const SOURCE_TYPES = [
  { value: 'hard_debt', label: 'Hard debt' },
  { value: 'gov_debt', label: 'Government debt' },
  { value: 'mezzanine_debt', label: 'Mezzanine debt' },
  { value: 'recoverable_grant', label: 'Recoverable grant' },
  { value: 'nonrecoverable_grant', label: 'Non-recoverable grant' },
  { value: 'developer_equity', label: 'Developer equity' },
  { value: 'tax_credit_equity', label: 'Tax credit equity' },
  { value: 'other', label: 'Other' },
]

// Commercial lease types.
export const LEASE_TYPES = [
  { value: 'gross', label: 'Gross' },
  { value: 'nnn', label: 'NNN' },
]

// Sources typed as one of these count as "total debt" in the shared calculators.
export const DEBT_SOURCE_TYPES = ['hard_debt', 'gov_debt', 'mezzanine_debt']
