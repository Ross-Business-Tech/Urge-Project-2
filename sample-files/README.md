# Sample files

Made-up applicant workbooks and T-12 files for trying the app. Nothing here is real. Each file is described in `src/modules/shared/samples/ANSWER-KEY.md`.

- `sNN-name.xlsx`: an applicant workbook. Drop it on the "Load workbook" tab.
- `sNN-name-t12.xlsx`: the matching T-12, where the scenario has one. Upload it against the project after loading the workbook.
- The underwriter picks the stage and "as of" date after loading. The key lists the stage each scenario assumes.

- `sponsors/`: three made-up sponsors with a history of completed projects, for trying the Sponsor tab (one workbook each, plus a T-12 file per past project). See `sponsors/README.md`.

## The demo pack (`demo/`)

One workbook with a clean firm, a healthy project and an unhealthy project, for showing what the tool does with each. `demo/demo-review.json` opens with everything already set up. See `demo/README.md` for a five-minute run and what each screen should show.

## The fully filled-in example (for trying every feature)

Riverside Commons is a made-up 100-apartment project with nothing missing: five room types (studio, 1, 2 and 3 bedroom, two of them also at the 60% income level), shops, a complete budget, three loans plus a grant and a deferred fee, every expense line, and a full team. Nothing is broken on purpose.

- `full-example-development.xlsx`: still to be built. After loading it, choose the **Development** stage and an "as of" date (for example 2026-11-16). Good for the budget, cost per square foot, contingency, scenarios and development risk screens.
- `full-example-completed.xlsx` with `full-example-completed-t12.xlsx`: already open. Load the workbook, choose the **Completed** stage and the same date, then upload the T-12 file against the project. Good for rents and expenses against real monthly results.
- `full-example-benchmarks.json`: example ranges for the **Benchmarks** screen. Use "Open a saved file". Most of the project's figures sit inside them, and a few deliberately do not:
  - above the range: 2-bedroom market rent, operating expenses per unit, soft cost per square foot, debt service coverage, equity share (the last two are the safe side);
  - below the range: yield on cost (the risky side);
  - the 3-bedroom rent has no range, so it shows as "not compared";
  - for the completed version, the cost and contingency ranges show as "not used".

These ranges are invented for trying the app. They are not market data.

To rebuild them: `node src/modules/shared/samples/writeFullExample.mjs`

To rebuild the scenario files after changing a scenario: `node src/modules/shared/samples/writeFiles.mjs`
