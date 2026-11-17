# Demo pack: a clean firm, a healthy project and an unhealthy project

Made-up data. One workbook holds one firm and five projects, so a single load shows what the tool does with each.

| Who | What they are |
|---|---|
| **Cedar Hollow Partners** | The firm. A strong balance sheet and three finished projects that met their underwriting. |
| **Maple Court Apartments** | A new 100-unit building. Healthy: it raises no finding. |
| **Harbor Point Towers** | A new 100-unit building. Unhealthy: it raises findings on every screen. |
| Alder Court, Willow Street Flats, Maple Row Townhomes | The firm's finished projects (the track record). |

## The files

- **`demo-review.json`** is the one to use. It is a saved review: every stage and date is already chosen, and the finished projects' results are loaded. Drop it on the **Workbook** screen and you are ready.
- **`demo-benchmarks.json`** holds 19 ranges for the **Benchmarks** screen. Use "Open a saved file".
- **`demo-workbook.xlsx`** is the same data as a plain applicant workbook, if you want to show loading a real file. Choose **Development** for Maple Court and Harbor Point, **Completed** for the three finished projects, and the date 2026-01-15. Then load each finished project's T-12 (`demo-t12-<project name>.xlsx`).

## A five-minute run

Choose the project once, using the bar at the top ("Change project, stage or date"). Every screen then shows that project.

| Step | Do this | What you will see |
|---|---|---|
| 1. Load | **Workbook**: drop `demo-review.json`. | Five projects, one firm. "Reopened from a review saved on 1/15/2026." |
| 2. Benchmarks | **Benchmarks**: "Open a saved file", choose `demo-benchmarks.json`. | 19 ranges, dated. |
| 3. The firm | **Sponsor**. | Cedar Hollow Partners scores **98 of 100, Strong**. Track record **97 of 100, Strong** (3 finished projects, 372 units). "No review flags: the sponsor looks sound." Under "The sponsor's projects", Maple Court reads **Sound: 1.93×** and Harbor Point reads **Thin: 0.91×**. |
| 4. The healthy project | Choose **Maple Court Apartments**, then go through **Key numbers**, **Data checks**, **Scenarios**, **Development risk** and **Stage changes**. | Key numbers: "The key ratio meets your settings. Everything compared is within your benchmarks." Benchmarks: "All 19 compared figures are within your range." Data checks: 11 of 11 pass. Scenarios: "The loan holds up even in the downside case" (coverage 1.93× in the base case, 1.41× in the downside). Development risk: 15 of 15 pass. Stage changes: on track, delivery expected 2027-12. |
| 5. The unhealthy project | Choose **Harbor Point Towers** and go through the same screens. | Key numbers: "1 key ratio is a concern" (coverage **0.91×**, NOI cushion **-32.1%**, break-even occupancy **106.0%**), with the high-severity findings first. Benchmarks: 18 of 19 figures outside your range. Data checks: 3 need a look, led by "The money raised does not cover the project cost" (**$900,000 short**), then a total typed in by hand. Scenarios: "In the downside case, income no longer covers the loan payments" (**0.73×**, base 0.91×, upside 0.99×), with a large funding gap. Development risk: 9 of 15 need a look, including contingency of only **0.7%** of hard cost, construction past its completion date, coverage under the lender's minimum, a short loan that comes due before the project stabilizes, and mezzanine debt ranked ahead of the senior loan. Stage changes: "The next stage change is at risk." |
| 6. Optional | **AI second opinion** on each project. | It needs the access code. The checks' findings are listed first and the AI only adds to them, so Maple Court has almost nothing to connect and Harbor Point has a long list. |

## What is wrong with Harbor Point Towers, on purpose

It is broken in many different ways at once, so every kind of check has something to say:

- **The workbook does not add up:** sources are $900,000 short of uses, and the Budget tab's total is typed in over its formula.
- **Assumptions out of line with your ranges:** rents about 30% above the range, vacancy of 2%, and operating expenses far below the range.
- **A weak loan:** a 9.5% senior loan, 89% of the cost borrowed, and coverage of 0.91× against a 1.20× minimum.
- **Development risk:** contingency of 0.7%, no reserves, no general contractor or architect named, a 12-month bridge loan that comes due before the project stabilizes, and mezzanine debt ranked ahead of the senior loan.
- **Late:** construction was due to finish in 2025-06, and the as-of date is 2026-01-15.

Maple Court Apartments has the same shape of data with everything inside the ranges, a sensible mix of loans, grant and equity, and a deferred developer fee.

To rebuild these files after changing the pack: `node src/modules/shared/samples/writeDemoPack.mjs`
