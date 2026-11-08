# Sample files

Made-up applicant workbooks and T-12 files for trying the app. Nothing here is real. Each file is described in `src/modules/shared/samples/ANSWER-KEY.md`.

- `sNN-name.xlsx`: an applicant workbook. Drop it on the "Load workbook" tab.
- `sNN-name-t12.xlsx`: the matching T-12, where the scenario has one. Upload it against the project after loading the workbook.
- The underwriter picks the stage and "as of" date after loading. The key lists the stage each scenario assumes.

- `sponsors/`: three made-up sponsors with a history of completed projects, for trying the Sponsor tab (one workbook each, plus a T-12 file per past project). See `sponsors/README.md`.

To rebuild them after changing a scenario: `node src/modules/shared/samples/writeFiles.mjs`
