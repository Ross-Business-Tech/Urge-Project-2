# Sample workbooks: the answer key

Generated from `scenarios.js`. Do not edit by hand: change the scenario and run `node src/modules/shared/samples/writeKey.mjs`.

Every scenario is a made-up applicant workbook (cover version 1.9 layout), built from a healthy baseline with one thing broken on purpose. A module is correct for a scenario when it raises the flags below at (at least) the severity shown, and stays quiet where the key says "should not flag".

The healthy baseline: total cost 5,550,000; one loan of 3,000,000 at 6% over 360 months; sponsor equity 2,000,000; deferred fee 550,000; stabilized NOI 586,000; DSCR 2.71. Settings are the defaults (minimum DSCR 1.20, occupancy floor 90%, rent premium 10%, stability streak 3 months).

| Scenario | Stage | What is planted |
|---|---|---|
| s01-healthy-development | development | Healthy development project |
| s02-sources-not-equal-uses | development | Sources do not equal uses |
| s03-thin-contingency | development | Thin contingency |
| s04-error-cells | development | Excel error cells |
| s05-template-residue | development | Template placeholder text left in |
| s06-hidden-tab-with-data | development | Hidden project tab with data |
| s07-stage-contradicts-data | development | Stage contradicts the data |
| s08-dscr-under-minimum | development | DSCR under the lender minimum |
| s09-passes-dscr-low-occupancy-high-rent | lease_up | Passes DSCR but low occupancy and high rent |
| s10-healthy-project-failing-firm | completed | Healthy project under a failing firm |
| s11-missing-t12 | completed | Completed project with no T-12 |
| s12-partial-t12 | completed | Partial T-12 (5 months) |
| s13-typed-payment-too-low | development | Typed yearly payment is too low |
| s14-rate-typed-as-whole-number | development | Interest rate typed as 6.5 instead of 6.5% |
| s15-equity-with-rate-and-term | development | Equity source with a rate and a term |

## s01-healthy-development: Healthy development project

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** Nothing is wrong. Sources equal uses, contingency is adequate, debt service is covered.
- **T-12:** none.
- **Calculators:** dscr = 2.71; debtToCost = 0.54; equityShare = 0.36.
- **Modules should:**
  - M1 should not flag `M1-sources-uses`. Sources 5,550,000 equal uses 5,550,000. No flag.
  - M3D should not flag `M3D-contingency-low`. Construction contingency 400,000 on 3,500,000 hard cost (11.4%). No flag.
- **Overall:** A clean pass. No high or medium flags from any module. This is the control case: a module that flags this project is too noisy.

## s02-sources-not-equal-uses: Sources do not equal uses

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The sponsor equity is 350,000 short, so sources are 5,200,000 against uses of 5,550,000.
- **T-12:** none.
- **Calculators:** dscr = 2.71.
- **Modules should:**
  - M1 raises `M1-sources-uses` (High or higher). Sources 5,200,000 vs uses 5,550,000: a 350,000 gap (6.3%).
- **Overall:** M1 raises one high flag. Other modules may still run; the gap is a funding hole, not a reason to stop.

## s03-thin-contingency: Thin contingency

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** Construction contingency is 40,000 on 3,500,000 of hard cost (1.1%). Uses and sources are kept equal by raising sponsor equity.
- **T-12:** none.
- **Calculators:** dscr = 2.71.
- **Modules should:**
  - M3D raises `M3D-contingency-low` (High or higher). Contingency 1.1% of hard cost vs a 5% to 10% benchmark.
  - M1 should not flag `M1-sources-uses`. Sources and uses still tie out.
- **Overall:** Only M3D should object. M1 stays quiet because the numbers are internally consistent.

## s04-error-cells: Excel error cells

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The property tax cell on the Details tab shows #REF! and the debt interest rate shows #DIV/0!.
- **T-12:** none.
- **Calculators:** dscr = not available; noiCushion = not available.
- **Modules should:**
  - M1 raises `M1-error-cells` (High or higher). Two error cells: Details E139 (#REF!) and H28 (#DIV/0!).
- **Overall:** NOI and DSCR cannot be computed (property taxes and the rate are missing), so the calculators say "not available" and the modules raise low "missing data" flags instead of guessing.

## s05-template-residue: Template placeholder text left in

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The project name, address and firm name still hold the workbook's placeholder wording.
- **T-12:** none.
- **Calculators:** dscr = 2.71.
- **Modules should:**
  - M1 raises `M1-template-residue` (Medium or higher). Placeholder text in the firm name, project name and address.
- **Overall:** A medium M1 flag. The numbers are fine; the applicant did not finish the form.

## s06-hidden-tab-with-data: Hidden project tab with data

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The Cover says 1 development project, but a second, very hidden project tab holds a full project.
- **T-12:** none.
- **Modules should:**
  - M1 raises `M1-project-count` (High or higher). Cover says 1 development project; 2 tabs have data, and "Development Project 2 Details" is very hidden.
- **Overall:** The importer already notes the hidden tab. M1 turns that into a high flag. M5 should include the hidden project in the sponsor total.

## s07-stage-contradicts-data: Stage contradicts the data

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The underwriter chose development, but the stabilization date was mid-2024 and the project has a full T-12 of rent.
- **T-12:** 12 months, from 2024-12 to 2025-11.
- **Modules should:**
  - M1 raises `M1-stage-contradicted` (Medium or higher). Stage is development, but stabilization (2024-06) is past and a 12-month T-12 with rent is loaded.
- **Overall:** M1 flags the contradiction and never changes the stage. The underwriter decides.

## s08-dscr-under-minimum: DSCR under the lender minimum

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The whole 5,550,000 cost is borrowed at 9% over 360 months against the same income. DSCR is below 1.20.
- **T-12:** none.
- **Calculators:** dscr = 1.09.
- **Modules should:**
  - M3D raises `M3D-dscr-under-minimum` (High or higher). DSCR 1.09 vs a 1.20 minimum.
  - M1 should not flag `M1-sources-uses`. One loan of 5,550,000 equals uses of 5,550,000, so sources still tie.
- **Overall:** A clear fail on the first screener. Sources are consistent (all debt, no equity).

## s09-passes-dscr-low-occupancy-high-rent: Passes DSCR but low occupancy and high rent

- **Stage chosen:** lease_up. **As of:** 2026-01-15.
- **Planted:** The last 3 months of NOI beat underwriting and DSCR passes, but occupancy is 82% while rents run 30% above the market sample.
- **T-12:** 6 months, from 2024-12 to 2025-05.
- **Calculators:** dscr = 2.71; trailing = see T-12.
- **Modules should:**
  - M3T raises `M3T-high-rent-low-occupancy` (High or higher). Occupancy 82% (below the 90% floor) with rents 30% above comps (above the 10% premium limit), while DSCR passes.
  - M2 raises `M2-rent-above-comps` (Medium or higher). Achieved rents above the comparable range.
- **Overall:** The case the first screener alone would wave through. DSCR and NOI pass; the occupancy screener catches it.

## s10-healthy-project-failing-firm: Healthy project under a failing firm

- **Stage chosen:** completed. **As of:** 2026-01-15.
- **Planted:** The project is sound. The sponsor firm has almost no cash, large debt and shrinking fees.
- **T-12:** 12 months, from 2024-12 to 2025-11.
- **Calculators:** dscr = 2.71.
- **Modules should:**
  - M5 raises `M5-firm-liquidity` (High or higher). Firm cash 20,000 against 600,000 of payables; fee income fell to zero.
  - M3C should not flag `M3C-actuals-vs-underwriting`. The project itself performs; no project-level high flags.
- **Overall:** M5 raises the firm risk. M6 should show the project as sound but exposed to the sponsor. The project is not dead on its own numbers.

## s11-missing-t12: Completed project with no T-12

- **Stage chosen:** completed. **As of:** 2026-01-15.
- **Planted:** The project is completed, but no T-12 is loaded.
- **T-12:** none.
- **Calculators:** trailing = not available.
- **Modules should:**
  - M1 raises `M1-t12-missing` (Medium or higher). A completed project has no T-12.
  - M3C raises `M3C-missing-data` (Low or higher). Actuals checks could not run without a T-12.
- **Overall:** No crash and no silent skip: both modules say what is missing.

## s12-partial-t12: Partial T-12 (5 months)

- **Stage chosen:** completed. **As of:** 2026-01-15.
- **Planted:** Only 5 months of T-12 are loaded.
- **T-12:** 5 months, from 2024-12 to 2025-04.
- **Calculators:** trailing = streak of 5 months.
- **Modules should:**
  - M1 raises `M1-t12-partial` (Low or higher). Only 5 of 12 months provided.
- **Overall:** The 3-month stability test can run (5 months is enough). A full year-based check cannot.

## s13-typed-payment-too-low: Typed yearly payment is too low

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The applicant typed a yearly payment of 100,000 on a 3,000,000 loan. The loan's own terms produce about 215,838.
- **T-12:** none.
- **Calculators:** dscr = 5.86.
- **Modules should:**
  - M1 raises `M1-payment-override-low` (High or higher). Typed payment 100,000 a year vs 215,838 from the amount, rate and term.
- **Overall:** The typed number flatters DSCR (5.86 against 2.71). M1 catches it.

## s14-rate-typed-as-whole-number: Interest rate typed as 6.5 instead of 6.5%

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The rate cell holds 6.5 (meaning 650%).
- **T-12:** none.
- **Calculators:** dscr = not available.
- **Modules should:**
  - M1 raises `M1-implausible-input` (High or higher). Interest rate 650% is outside the believable range.
- **Overall:** The calculators refuse the number and say "not available". They never produce a confident wrong DSCR.

## s15-equity-with-rate-and-term: Equity source with a rate and a term

- **Stage chosen:** development. **As of:** 2026-01-15.
- **Planted:** The sponsor equity line carries an 8% rate and a 120-month term, so it is counted as debt service.
- **T-12:** none.
- **Calculators:** dscr = 1.16.
- **Modules should:**
  - M1 raises `M1-equity-with-payment-terms` (Medium or higher). Developer equity has a rate and term; confirm it is not a loan typed under the wrong label.
- **Overall:** The calculators count it (announced in their notes), so DSCR drops from 2.71 to about 1.16, under the 1.20 minimum. M1 asks the underwriter to confirm.
