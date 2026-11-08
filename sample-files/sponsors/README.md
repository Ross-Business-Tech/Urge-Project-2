# Sample sponsors with a history

Three made-up sponsors, each with a new building to review and a record of completed projects. Nothing here is real. They are for trying the **Sponsor** tab the way a real user would.

## How to try one

1. On the **Load workbook** tab, drop the sponsor's workbook (for example `proven-sponsor.xlsx`). One workbook holds the new building and every past project, one tab each.
2. Open each project. For the new building choose the stage **Development**; for each past project choose **Completed**. Use 2026-01-15 as the "as of" date (the **Today** button also works).
3. For each past project, open its **Trailing 12 months** group and load that project's T-12 file (the file name ends with the project's name).
4. Open the **Sponsor** tab. It shows the loaded sponsor first: the firm health score, the track record and credibility score, and the review flags.

Without step 3 a past project has no T-12, so it cannot be compared with its underwriting and the track record shows "not available".

## Proven sponsor: three projects delivered, one new building

**File:** `proven-sponsor.xlsx`

Cedar Hollow Partners has finished three projects. Two met their underwriting; the third took two months longer than promised to stabilize. It now proposes a building about the size of its past ones.

**T-12 files:**
- `proven-sponsor-t12-alder-court.xlsx` for Alder Court
- `proven-sponsor-t12-willow-street-flats.xlsx` for Willow Street Flats
- `proven-sponsor-t12-maple-row-townhomes.xlsx` for Maple Row Townhomes

**What M5 should show:** A clean record: the credibility score is Strong and M5 raises no flag.

- Credibility score: Strong, 90 or more out of 100.
- Raises no track record flag and no firm flag.
- Stays quiet about `M5-no-track-record`.
- Stays quiet about `M5-track-record-weak`.
- Stays quiet about `M5-track-record-failing`.
- Stays quiet about `M5-scale-step-up`.
- Willow Street Flats leased up slowly at first: it passed the stability test two months after its target and its rents ran a little behind. Its card shows "Behind" on those two rows, but its own score stays at 90, so it is not flagged.

## Mixed record: one project on target, one fell short

**File:** `mixed-record-sponsor.xlsx`

Granite Bay Development delivered one project as promised. The other earned far less than underwritten, with rents and occupancy well below plan, and is still not stable. It now proposes a new building.

**T-12 files:**
- `mixed-record-sponsor-t12-juniper-commons.xlsx` for Juniper Commons
- `mixed-record-sponsor-t12-birch-row.xlsx` for Birch Row

**What M5 should show:** The average hides a failure, so M5 flags the weak project on its own. The credibility score is Adequate, not Strong.

- Credibility score: Adequate, 55 to 74 out of 100.
- Raises `M5-delivery-shortfall-birch-row` (high).
- Stays quiet about `M5-delivery-shortfall-juniper-commons`.
- Stays quiet about `M5-no-track-record`.
- Stays quiet about `M5-scale-step-up`.
- Birch Row scores about 11 out of 100 on its own: income was 74% of underwritten, rents 85%, occupancy 10 points low.

## Big step up: a small past project, a much larger new building

**File:** `big-step-up-sponsor.xlsx`

Larkspur Builders delivered one small project well. It now proposes a building four times the size of anything it has completed.

**T-12 files:**
- `big-step-up-sponsor-t12-pebble-creek-cottages.xlsx` for Pebble Creek Cottages

**What M5 should show:** The past project was delivered well, so the delivery parts are strong, but the size jump is the risk: M5 raises the scale flag.

- Credibility score: Strong, 75 or more out of 100.
- Raises `M5-scale-step-up` (high).
- Stays quiet about `M5-delivery-shortfall-pebble-creek-cottages`.
- Stays quiet about `M5-no-track-record`.
- With only one completed project, the credibility score rests on a single data point and the page says so.

To rebuild these files after changing a sponsor: `node src/modules/m5-sponsor/samples/writeSponsorFiles.mjs`
