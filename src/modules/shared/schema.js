// What a firm record and a project record contain. Built by M0; no other module edits this file.
//
// Conventions
//  - Money is whole dollars. Percentages are decimals (8% is 0.08). Dates are text like "2026-03" or "2026-03-15".
//  - The tool stores only what the applicant types in. Totals, NOI, DSCR and the like are calculated, never stored.
//  - Field names and groups follow the applicant workbook. `where` names the tab and `cell` the cell(s) in that workbook
//    (cover version 1.9), so a flag can point back to it. Fields marked `cell: 'new'` do not exist in the workbook.
//
// Group kinds
//  - fields: a few single values
//  - table:  repeating rows (a row is one source, one unit type, one month, ...), up to `maxRows`
//  - grid:   fixed rows (each a named line such as "Land") by one or more columns

export const SCHEMA_VERSION = 1

const field = (key, label, type = 'text', cell) => ({ key, label, type, ...(cell ? { cell } : {}) })
const money = (key, label, cell) => field(key, label, 'dollars', cell)
const pct = (key, label, cell) => field(key, label, 'percent', cell)
const row = (key, label, cell, section) => ({ key, label, ...(cell ? { cell } : {}), ...(section ? { section } : {}) })

const group = (id, title, kind, where, extra) => ({ id, title, kind, where, ...extra })

// ---------------------------------------------------------------------------------------------
// Lines reused in more than one place
// ---------------------------------------------------------------------------------------------

// Annual operating expenses (project Details tab, rows 124 to 139) and the monthly T-12 columns.
const OPEX_ROWS = [
  row('propertyManagement', 'Property management', 'E124', 'Admin'),
  row('leasingExpense', 'Leasing expense', 'E125', 'Admin'),
  row('auditTax', 'Audit and tax', 'E126', 'Admin'),
  row('miscAdmin', 'Misc admin expense', 'E127', 'Admin'),
  row('electricHeatCommon', 'Electric and heat (common)', 'E129', 'Operating'),
  row('waterSewer', 'Water and sewer', 'E130', 'Operating'),
  row('garbage', 'Garbage', 'E131', 'Operating'),
  row('replacementReserves', 'Replacement reserves', 'E132', 'Reserves'),
  row('contractRepairs', 'Contract repairs', 'E134', 'Maintenance'),
  row('elevatorContract', 'Elevator contract', 'E135', 'Maintenance'),
  row('groundsMaintenance', 'Grounds maintenance', 'E136', 'Maintenance'),
  row('propertyLiabilityInsurance', 'Property and liability insurance', 'E138', 'Taxes and insurance'),
  row('propertyTaxes', 'Property taxes', 'E139', 'Taxes and insurance'),
]

// ---------------------------------------------------------------------------------------------
// FIRM RECORD
// ---------------------------------------------------------------------------------------------

export const firmSchema = [
  group('identity', 'Firm identity', 'fields', 'Cover', {
    fields: [
      field('name', 'Name of firm', 'text', 'C8'),
      field('street', 'Street address', 'text', 'C13'),
      field('cityStateZip', 'City, state, zip', 'text', 'C14'),
      field('principalName', 'Firm principal', 'text', 'C17'),
      field('developmentProjectCount', 'Number of development projects', 'number', 'C9'),
      field('completedProjectCount', 'Number of completed projects', 'number', 'C10'),
    ],
  }),

  group('owners', 'Owners', 'table', 'Cover', {
    note: 'The principal plus up to 3 additional owners.',
    maxRows: 4,
    columns: [field('name', 'Name', 'text', 'C17, C21, C24, C27'), pct('ownershipPct', 'Ownership %', 'C18, C22, C25, C28')],
  }),

  group('balanceSheet', 'Firm balance sheet', 'grid', 'Balance Sheet', {
    note: 'Current period and prior period, side by side.',
    fields: [field('currentPeriod', 'Current period covers', 'text', 'B6'), field('priorPeriod', 'Prior period covers', 'text', 'D6')],
    columns: [money('current', 'Current period'), money('prior', 'Prior period')],
    rows: [
      row('cash', 'Cash', '9', 'Current assets'),
      row('pettyCash', 'Petty cash', '10', 'Current assets'),
      row('accountsReceivable', 'Accounts receivable', '11', 'Current assets'),
      row('inventory', 'Inventory', '12', 'Current assets'),
      row('prepaidExpenses', 'Prepaid expenses', '13', 'Current assets'),
      row('employeeAdvances', 'Employee advances', '14', 'Current assets'),
      row('temporaryInvestments', 'Temporary investments', '15', 'Current assets'),
      row('land', 'Land', '19', 'Fixed assets'),
      row('buildings', 'Buildings', '20', 'Fixed assets'),
      row('furnitureEquipment', 'Furniture and equipment', '21', 'Fixed assets'),
      row('computerEquipment', 'Computer equipment', '22', 'Fixed assets'),
      row('vehicles', 'Vehicles', '23', 'Fixed assets'),
      row('accumulatedDepreciation', 'Less: accumulated depreciation', '24', 'Fixed assets'),
      row('trademarks', 'Trademarks', '28', 'Other assets'),
      row('patents', 'Patents', '29', 'Other assets'),
      row('securityDeposits', 'Security deposits', '30', 'Other assets'),
      row('otherAssets', 'Other assets', '31', 'Other assets'),
      row('accountsPayable', 'Accounts payable', '38', 'Current liabilities'),
      row('businessCreditCards', 'Business credit cards', '39', 'Current liabilities'),
      row('salesTaxPayable', 'Sales tax payable', '40', 'Current liabilities'),
      row('payrollLiabilities', 'Payroll liabilities', '41', 'Current liabilities'),
      row('otherLiabilities', 'Other liabilities', '42', 'Current liabilities'),
      row('currentPortionLongTermDebt', 'Current portion of long-term debt', '43', 'Current liabilities'),
      row('notesPayable', 'Notes payable', '47', 'Long-term liabilities'),
      row('mortgagePayable', 'Mortgage payable', '48', 'Long-term liabilities'),
      row('lessCurrentPortion', 'Less: current portion of long-term debt', '49', 'Long-term liabilities'),
      row('partnersEquity', "Capital stock / partner's equity", '53', 'Equity'),
      row('openingRetainedEarnings', 'Opening retained earnings', '54', 'Equity'),
      row('dividendsOwnerDraw', "Dividends paid / owner's draw", '55', 'Equity'),
      row('netIncome', 'Net income (loss)', '56', 'Equity'),
    ],
  }),

  group('principalStatement', "Principal's personal financial statement", 'grid', 'Principal PFS', {
    fields: [field('name', 'Name', 'text', 'B5'), field('statementDate', 'Statement date', 'date', 'B7')],
    columns: [money('amount', 'Amount')],
    rows: [
      row('cashChecking', 'Cash: checking accounts', 'D11', 'Assets'),
      row('cashSavings', 'Cash: savings accounts', 'D12', 'Assets'),
      row('certificatesOfDeposit', 'Certificates of deposit', 'D13', 'Assets'),
      row('securities', 'Securities: stocks, bonds, mutual funds', 'D14', 'Assets'),
      row('notesReceivable', 'Notes and contracts receivable', 'D15', 'Assets'),
      row('lifeInsuranceCashValue', 'Life insurance (cash surrender value)', 'D16', 'Assets'),
      row('personalProperty', 'Personal property', 'D17', 'Assets'),
      row('retirementFunds', 'Retirement funds', 'D18', 'Assets'),
      row('realEstateOwned', 'Real estate owned (market value)', 'D19', 'Assets'),
      row('otherAssetsCollege', 'Other assets (college funds)', 'D20', 'Assets'),
      row('otherAssets', 'Other assets (specify)', 'D21', 'Assets'),
      row('currentDebt', 'Current debt (credit cards, accounts)', 'D27', 'Liabilities'),
      row('notesPayable', 'Notes payable', 'D28', 'Liabilities'),
      row('taxesPayable', 'Taxes payable', 'D29', 'Liabilities'),
      row('propertyMortgages', 'Property mortgages', 'D30', 'Liabilities'),
      row('otherLiabilities1', 'Other liabilities (specify)', 'D31', 'Liabilities'),
      row('otherLiabilities2', 'Other liabilities (specify)', 'D32', 'Liabilities'),
    ],
  }),

  group('earnings', 'Firm earnings by year', 'table', 'Consolidated Financials', {
    note: 'One row per fiscal year, history and projections.',
    maxRows: 9,
    columns: [
      field('fiscalYear', 'Fiscal year', 'number', 'row 5'),
      money('operatingCashDistributions', 'Operating cash distributions', 'row 7'),
      money('developerFee', 'Developer fee', 'row 9'),
      money('propertyManagementFee', 'Property management fee', 'row 10'),
      money('gcFee', 'GC fee', 'row 11'),
      money('assetManagementFee', 'Asset management fee', 'row 12'),
      money('otherFee1', 'Other fee 1', 'row 13'),
      money('otherFee2', 'Other fee 2', 'row 14'),
      money('otherFee3', 'Other fee 3', 'row 15'),
      money('nonFeeIncome', 'Non-fee income', 'row 16'),
      money('salariesWages', 'Salaries and wages', 'row 21'),
      money('leaseExpense', 'Lease expense', 'row 22'),
      money('utilities', 'Utilities', 'row 23'),
      money('marketing', 'Marketing', 'row 24'),
      money('insurance', 'Insurance', 'row 25'),
      money('mealsEntertainment', 'Meals and entertainment', 'row 26'),
      money('travel', 'Travel', 'row 27'),
      money('technologyTelecom', 'Technology and telecom', 'row 28'),
      money('officeSupplies', 'Office supplies', 'row 29'),
      money('legalProfessional', 'Legal and professional services', 'row 30'),
      money('otherExpense1', 'Other expense 1', 'row 31'),
      money('otherExpense2', 'Other expense 2', 'row 32'),
      money('existingInterestExpense', 'Existing interest expense', 'row 38'),
      money('costOfOtherCapital', 'Cost of other capital', 'row 39'),
      money('drawFromReserves', 'Draw from reserves', 'row 40'),
      money('cashTaxes', 'Cash taxes', 'row 43'),
    ],
  }),

  group('capital', 'Firm debt and equity', 'grid', 'Cap Table', {
    columns: [money('committed', 'Committed', 'C'), money('funded', 'Funded', 'D')],
    rows: [
      row('securedDebt', 'Secured debt', 'row 8'),
      row('unsecuredDebt', 'Unsecured debt', 'row 9'),
      row('ownerEquity', 'Owner equity', 'row 16'),
    ],
  }),

  group('projects', 'Project list', 'table', 'Cover and each project team table', {
    note: "Which projects belong to the firm and the firm's ownership share in each.",
    maxRows: 12,
    columns: [field('projectId', 'Project', 'text'), pct('ownershipPct', "Firm's ownership %", 'Details F13:F17')],
  }),
]

// ---------------------------------------------------------------------------------------------
// PROJECT RECORD
// ---------------------------------------------------------------------------------------------

export const projectSchema = [
  group('identity', 'Project identity', 'fields', 'Details', {
    fields: [
      field('name', 'Project name', 'text', 'E3'),
      field('address', 'Address', 'text', 'E4'),
      field('constructionType', 'Construction type', 'text', 'E5'),
      field('propertyType', 'Property type', 'text', 'E6'),
      field('confidential', 'Mark as confidential', 'boolean', 'D184'),
    ],
  }),

  group('stage', 'Stage and review date', 'fields', 'New (not in the workbook)', {
    note: 'The underwriter chooses the stage. The tool never works it out.',
    fields: [
      field('stage', 'Stage', 'stage', 'new'),
      field('asOfDate', '"As of" date of these facts', 'date', 'new'),
      field('workbookVersion', 'Workbook version the data came from', 'text', 'new'),
    ],
  }),

  group('team', 'Development team', 'grid', 'Details', {
    columns: [field('firmName', 'Firm name', 'text', 'D'), field('principal', 'Firm principal', 'text', 'E'), pct('ownershipPct', 'Ownership % in deal', 'F')],
    rows: [
      row('generalContractor', 'General contractor', 'row 11'),
      row('architect', 'Architect', 'row 12'),
      row('devPartner1', 'Development partner 1', 'row 13'),
      row('devPartner2', 'Development partner 2', 'row 14'),
      row('devPartner3', 'Development partner 3', 'row 15'),
      row('other1', 'Other', 'row 16'),
      row('other2', 'Other', 'row 17'),
    ],
  }),

  group('timeline', 'Timeline', 'fields', 'Details', {
    note: 'The workbook asks for years only. A month may be added where known.',
    fields: [
      field('constructionStart', 'Construction start', 'yearMonth', 'E20'),
      field('constructionCompletion', 'Construction completion', 'yearMonth', 'E21'),
      field('stabilization', 'Stabilization', 'yearMonth', 'E22'),
    ],
  }),

  group('sources', 'Sources of money', 'table', 'Details', {
    note: 'In lien priority order, most senior first.',
    maxRows: 14,
    columns: [
      field('lienPriority', 'Lien priority', 'number', 'C28:C41'),
      field('name', 'Name of source', 'text', 'D'),
      field('type', 'Type of source', 'sourceType', 'E'),
      money('amount', 'Amount', 'F'),
      field('termMonths', 'Term (months)', 'number', 'G'),
      pct('interestRate', 'Annual interest rate', 'H'),
      money('paymentOverride', 'Typed payment (override)', 'K'),
    ],
  }),

  group('budget', 'Development budget', 'grid', 'Budget', {
    note: 'Optional. The workbook has no budget for completed projects.',
    columns: [money('amount', 'Amount', 'G')],
    rows: [
      row('land', 'Land', 'G3', 'Acquisition'),
      row('buildings', 'Buildings', 'G4', 'Acquisition'),
      row('acquisitionOther', 'Other acquisition', 'G5', 'Acquisition'),
      row('environmentalMitigation', 'Environmental mitigation', 'G11', 'Hard costs: site work'),
      row('earthWork', 'Earth work', 'G12', 'Hard costs: site work'),
      row('roadsWalks', 'Roads and walks', 'G13', 'Hard costs: site work'),
      row('siteUtilities', 'Site utilities', 'G14', 'Hard costs: site work'),
      row('siteImprovementsDemolition', 'Site improvements and demolition', 'G15', 'Hard costs: site work'),
      row('landscaping', 'Landscaping', 'G16', 'Hard costs: site work'),
      row('irrigation', 'Irrigation', 'G17', 'Hard costs: site work'),
      row('siteWorkOther', 'Other site work', 'G18', 'Hard costs: site work'),
      row('concreteMasonry', 'Building concrete and masonry', 'G20', 'Hard costs: structures'),
      row('carpentry', 'Carpentry', 'G21', 'Hard costs: structures'),
      row('roofingSiding', 'Roofing, metal, siding, insulation', 'G22', 'Hard costs: structures'),
      row('doorsWindows', 'Doors, windows, glass', 'G23', 'Hard costs: structures'),
      row('drywall', 'Drywall and acoustical', 'G24', 'Hard costs: structures'),
      row('flooring', 'Flooring', 'G25', 'Hard costs: structures'),
      row('cabinetsAppliances', 'Cabinets, countertops, appliances', 'G26', 'Hard costs: structures'),
      row('paintingFurnishings', 'Painting, decorating, furnishings', 'G27', 'Hard costs: structures'),
      row('plumbingElectrical', 'Plumbing, electrical, fire protection', 'G28', 'Hard costs: structures'),
      row('hvac', 'HVAC', 'G29', 'Hard costs: structures'),
      row('accessoryBuildings', 'Accessory buildings and garages', 'G30', 'Hard costs: structures'),
      row('elevatorsEquipment', 'Elevators and special equipment', 'G31', 'Hard costs: structures'),
      row('tenantUpgrades', 'Tenant upgrades', 'G32', 'Hard costs: structures'),
      row('structuresOther1', 'Other structures 1', 'G33', 'Hard costs: structures'),
      row('structuresOther2', 'Other structures 2', 'G34', 'Hard costs: structures'),
      row('generalRequirements', 'General requirements', 'G35', 'Hard costs: general'),
      row('buildersOverhead', "Builder's overhead", 'G36', 'Hard costs: general'),
      row('buildersProfit', "Builder's profit", 'G37', 'Hard costs: general'),
      row('siteSecurity', 'Site security', 'G38', 'Hard costs: general'),
      row('permitsBonds', 'Permits, tap fees, bond, cost certification', 'G39', 'Hard costs: general'),
      row('constructionContingency', 'Construction contingency', 'G40', 'Hard costs: general'),
      row('ownersContingency', "Owner's contingency", 'G41', 'Hard costs: general'),
      row('hardCostOther1', 'Other hard cost 1', 'G42', 'Hard costs: general'),
      row('hardCostOther2', 'Other hard cost 2', 'G43', 'Hard costs: general'),
      row('architectureEngineering', 'Architectural and engineering', 'G49', 'Soft costs: professional fees'),
      row('survey', 'Survey', 'G50', 'Soft costs: professional fees'),
      row('legalAccounting', 'Legal and accounting', 'G51', 'Soft costs: professional fees'),
      row('environmentalStudies', 'Environmental studies and soil testing', 'G52', 'Soft costs: professional fees'),
      row('marketStudy', 'Market study', 'G53', 'Soft costs: professional fees'),
      row('appraisal', 'Appraisal', 'G54', 'Soft costs: professional fees'),
      row('costCertification', 'Cost certification', 'G55', 'Soft costs: professional fees'),
      row('professionalFeesOther', 'Other professional fees', 'G56', 'Soft costs: professional fees'),
      row('constructionLoanFee', 'Construction loan fee', 'G60', 'Soft costs: interim construction'),
      row('constructionInterest', 'Construction interest', 'G61', 'Soft costs: interim construction'),
      row('constructionTaxes', 'Construction taxes', 'G62', 'Soft costs: interim construction'),
      row('constructionInsurance', 'Construction insurance', 'G63', 'Soft costs: interim construction'),
      row('interimOther1', 'Other interim cost 1', 'G64', 'Soft costs: interim construction'),
      row('interimOther2', 'Other interim cost 2', 'G65', 'Soft costs: interim construction'),
      row('permanentLoanFees', 'Permanent loan fees', 'G69', 'Soft costs: permanent financing'),
      row('applicationFees', 'Application fees', 'G70', 'Soft costs: permanent financing'),
      row('titleWork', 'Title work', 'G71', 'Soft costs: permanent financing'),
      row('permanentFinancingOther', 'Other financing cost', 'G72', 'Soft costs: permanent financing'),
      row('developerFee', 'Developer fee', 'G76', 'Soft costs: developer and consulting fees'),
      row('projectManagementFees', 'Project management fees', 'G77', 'Soft costs: developer and consulting fees'),
      row('constructionManagementFees', 'Construction management fees', 'G78', 'Soft costs: developer and consulting fees'),
      row('consultingFees', 'Consulting fees', 'G79', 'Soft costs: developer and consulting fees'),
      row('relatedPartyFees', 'Other related-party fees', 'G80', 'Soft costs: developer and consulting fees'),
      row('feesOther', 'Other fees', 'G81', 'Soft costs: developer and consulting fees'),
      row('rentUpReserve', 'Rent-up reserve', 'G85', 'Soft costs: reserves'),
      row('replacementReserve', 'Replacement reserve', 'G86', 'Soft costs: reserves'),
      row('operatingReserve', 'Operating reserve', 'G87', 'Soft costs: reserves'),
      row('softCostContingency', 'Soft-cost contingency', 'G88', 'Soft costs: reserves'),
      row('reservesOther', 'Other reserve', 'G89', 'Soft costs: reserves'),
      row('miscOther1', 'Miscellaneous 1', 'G93', 'Soft costs: miscellaneous'),
      row('miscOther2', 'Miscellaneous 2', 'G94', 'Soft costs: miscellaneous'),
      row('miscOther3', 'Miscellaneous 3', 'G95', 'Soft costs: miscellaneous'),
      row('miscOther4', 'Miscellaneous 4', 'G96', 'Soft costs: miscellaneous'),
      row('miscOther5', 'Miscellaneous 5', 'G97', 'Soft costs: miscellaneous'),
      row('miscOther6', 'Miscellaneous 6', 'G98', 'Soft costs: miscellaneous'),
    ],
  }),

  group('residentialIncome', 'Residential income', 'table', 'Details', {
    note: 'One row per unit type.',
    maxRows: 21,
    columns: [
      field('amiLevel', 'Affordability level (AMI)', 'text', 'C'),
      field('unitType', 'Unit type', 'text', 'D'),
      field('units', 'Number of units', 'number', 'E'),
      field('baths', 'Baths', 'number', 'F'),
      field('sqft', 'Square feet per unit', 'number', 'G'),
      money('monthlyRent', 'Monthly rent per unit', 'H'),
    ],
    fields: [
      pct('rentIncreaseYear2', 'Rent increase, year 2', 'P58'),
      pct('rentIncreaseYear3', 'Rent increase, year 3', 'Q58'),
      pct('rentIncreaseFuture', 'Rent increase, later years', 'R58'),
      pct('stabilizedVacancy', 'Stabilized vacancy', 'P60'),
    ],
  }),

  group('commercialIncome', 'Commercial income', 'table', 'Details', {
    note: 'One row per lease.',
    maxRows: 15,
    columns: [
      field('leaseType', 'Lease type', 'leaseType', 'C'),
      field('description', 'Description', 'text', 'D'),
      field('sqft', 'Square feet', 'number', 'G'),
      money('rentPerSqft', 'Rent per square foot', 'H'),
    ],
    fields: [
      pct('rentIncreaseYear2', 'Rent increase, year 2', 'O84'),
      pct('rentIncreaseYear3', 'Rent increase, year 3', 'P84'),
      pct('rentIncreaseFuture', 'Rent increase, later years', 'Q84'),
      pct('stabilizedVacancy', 'Stabilized vacancy', 'O86'),
    ],
  }),

  group('otherIncome', 'Other income', 'table', 'Details', {
    note: 'Parking, pets, storage, late fees and the like.',
    maxRows: 10,
    columns: [field('description', 'Description', 'text', 'D104:D113'), money('monthlyIncome', 'Monthly income', 'G104:G113')],
    fields: [
      pct('inflationYear2', 'Yearly increase, year 2', 'J105'),
      pct('inflationYear3', 'Yearly increase, year 3', 'K105'),
      pct('inflationFuture', 'Yearly increase, later years', 'L105'),
    ],
  }),

  group('operatingExpenses', 'Operating expenses (annual, at stabilization)', 'grid', 'Details', {
    columns: [money('amount', 'Amount', 'E')],
    rows: OPEX_ROWS,
  }),

  group('otherExpenses', 'Other operating expenses', 'table', 'Details', {
    maxRows: 5,
    columns: [field('description', 'Description', 'text', 'D141:D145'), money('amount', 'Amount', 'E141:E145')],
  }),

  group('t12', 'Trailing 12 months (optional)', 'table', 'New (not in the workbook)', {
    note: 'Up to 12 monthly rows, fewer for a project still leasing up. Same expense lines as above.',
    maxRows: 12,
    columns: [
      field('month', 'Month', 'date', 'new'),
      money('residentialRevenue', 'Residential revenue', 'new'),
      money('commercialRevenue', 'Commercial revenue', 'new'),
      money('otherRevenue', 'Other revenue', 'new'),
      money('vacancyLoss', 'Vacancy loss', 'new'),
      money('concessions', 'Concessions and free rent', 'new'),
      pct('occupancy', 'Occupancy', 'new'),
      ...OPEX_ROWS.map((r) => money(r.key, r.label, 'new')),
      money('otherExpenses', 'Other expenses', 'new'),
      money('noiReported', 'NOI as reported', 'new'),
      money('debtService', 'Debt service paid', 'new'),
    ],
  }),
]
