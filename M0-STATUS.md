# M0 status: where the shared foundation stands

Owner: NS. This note lets a new session (or a new teammate) continue M0 without replaying the history. The contract is in `BUILD-MODULES.md`; this file says what is built, how to work, and what is left. Update it when you finish a piece.

## What exists (all merged to `development` unless marked)

**Rules and data** (`src/modules/shared/`)
- `schema.js`: the firm record and project record (field names follow the applicant workbook; each field carries its limits). `records.js` makes blank records. `enums.js`, `settings.js` (the thresholds from section 1f).
- `calculators.js`: the base calculators and the key ratios (section 1g). They never guess: a missing or implausible input gives "not available" with a reason and the form to fill in.
- `recordEdit.js`, `fieldFormat.js`, `projectStage.js`: editing a record by hand (keeps the applicant's original), typed-text rules, stage and "as of" date.
- `reviewFile.js`: save a review to a file and reopen it. A file is checked field by field before anything uses it.
- `flags.js` (**in the open pull request**): the flag format, `makeFlag`, `createFlagMaker`, `missingDataFlag`, `flagFromUnavailable`, `citeCells`, `guardModule`.
- `import/`: `xlsxReader.js` (safe reader), `xlsxWriter.js`, `cellValue.js`, `workbookMap.js` (where each field lives in the applicant workbook), `importWorkbook.js`, `t12Template.js`.

**Screen** (`src/`): `App.jsx` (tabs), `ImportPreview.jsx`, `RecordEditor.jsx`, `KeyRatios.jsx`, `T12Tools.jsx`, `FlagFormat.jsx`, `RescueBoundary.jsx`, `download.js`.

**Tests:** `src/modules/shared/__tests__/`, 168 tests, run with `npm test`. `helpers.js` builds fake workbooks in code (no binary files).

## How to work
- `npm test`, `npm run lint`, `npm run build`, then `HERENOW_WORKSPACE= npm run publish:preview` for an anonymous 24-hour test link (nobody is signed in to here.now yet).
- One branch, one pull request at a time. After a pull request merges, fast-forward the branch to `development` before starting the next piece.
- Public repo: **made-up data only.** The real applicant workbook must never be committed. Build fake ones with `__tests__/helpers.js`.
- The built page carries a no-network Content-Security-Policy. Do not add anything that needs the network.

## Decisions already made (do not reopen without asking)
- The **underwriter chooses the stage**; the tool never works it out. Only stage and "as of" date are required.
- The applicant's number is **kept** when an underwriter changes it ("Put back" restores it). Saving is a file download; nothing is stored in the browser.
- A typed payment is a **yearly** amount (matches the applicant workbook). Percentages are stored as decimals.
- A source typed as equity with a rate and term is **counted** in debt service and announced; M1 flags it.
- Implausible inputs show **"not available"** with a reason, never a confident wrong number.
- No lender assumptions (exit cap rate, refinance terms) for now.

## Left to build in M0
1. **Benchmark loader** (spec M0): benchmark sets as data files keyed by stage, for M2.
2. **A spec update** for the T-12 template details, the flag rules, the sample scenarios and the workbook facts (including the per-tab error count).
3. Ask Ross IT to run `npm test` in CI (`.github/` is theirs).

Done since the last note: 16 sample scenarios with an answer key and ready-to-load files (`sample-files/`, `src/modules/shared/samples/`); workbook facts for M1 (`facts.sheets` with visibility, data and error count per tab, `facts.errorCells`, `facts.typedOver`, list of computed cells in `workbookMap.js`).

Not built, on purpose for now: a background worker with a Cancel button for very large files, encrypted review files, splitting `calculators.js` into smaller files.

## Things worth knowing
- The blank applicant template already shows over a thousand error cells (for example `#DIV/0!` on the Cap Table and `#REF!` on hidden helper tabs). M1 should weigh errors by tab: errors on tabs we read matter; errors on untouched helper tabs are noise. `facts.sheets[].errorCount` and `hasData` give it what it needs.
- To rebuild the sample files and key after changing a scenario: `node src/modules/shared/samples/writeFiles.mjs` and `node src/modules/shared/samples/writeKey.mjs`.
- The applicant workbook's own loan-payment formula understates debt service (it treats a term in months as periods of the annual rate), so its DSCR looks about twice as good as it is. Our calculators use the standard monthly method.
- `node --test` needs a quoted file pattern on Node 22 (already set in `package.json`).
- If a test or screen fails on a real-looking workbook, test it outside the repo and put only the fake reproduction in `__tests__`.
