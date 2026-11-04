# BUILD MODULES: who builds which part of the project

**Everyone's Claude reads this file first.** It splits the app into modules so each team member builds one clear skill per session without overlapping anyone else.

## How to pick your module (for the student and for Claude)

1. Open the **Module claim board** below. Pick a row whose status is `OPEN`.
2. Change that row's status to `CLAIMED` and put your first name in the Owner column. Edit **only your own row**, so the team's edits don't collide. Make this one-line change in its own small pull request into `development` first, so teammates see it right away.
3. Build only that module, following its spec in this file and the **Shared rules** (section 1). If your module needs something from another module that isn't built yet, use the sample data and contracts in section 1 and leave a note. Don't build the other module.
4. When your pull request merges, change your row to `DONE`.
5. One module = one session = one pull request.

Claude: if the student hasn't named a module, show them the `OPEN` rows in plain language (skill, what it answers, what they'd see when done) and ask which one they want. Don't pick for them.

## Module claim board

| ID | Module | Layer | Stage behaviour | Needs first | Status | Owner |
|----|--------|-------|-----------------|-------------|--------|-------|
| M0 | Shared foundation (project record, stage flag, flag format, sample projects) | Base | Shared | none | CLAIMED | NS |
| M1 | Integrity checks | 1 | Shared | M0 | OPEN | |
| M2 | Benchmarking engine | 2 | Shared engine, stage-specific benchmark sets | M0 | OPEN | |
| M3D | Development risk module | 3 | Development stage | M0 | OPEN | |
| M3C | Completed risk module | 3 | Completed stage | M0 | OPEN | |
| M3T | Transition checks (lease-up and the hand-offs between stages) | 3 | Lease-up stage and every transition | M0 | OPEN | |
| M4 | Scenario engine (downside / base / upside) | 4 | Shared mechanics, stage-specific levers | M0 | OPEN | |
| M5 | Sponsor and portfolio view (global DSCR, liquidity, track record, credibility score) | 5 | Cross-project | M0 | OPEN | |
| M6 | Synthesis (ranked flags, cell references, sponsor follow-up questions) | 6 | Shared | M0, plus any flags the other modules produce | OPEN | |

Big modules can be split between two people. If you want half of one, add a row such as `M3D-a` and `M3D-b` (copy the parent row, say which half each covers, and do it in the claim pull request). Suggested splits are noted in each spec.

**Suggested order:** M0 first (one person, small, about one session). After it merges, M1 to M6 can all be built in parallel. M6 gets better as the others land, but it can start from sample flags.

---

## 0. The core idea

Every project is reviewed by asking the same six questions in order. The questions are shared. Only a few answers depend on **where the project is in its life**. So there are **no separate "development" and "completed" builds**. There is one set of modules, and the project's **stage** is a parameter that each module reads.

| Layer | Question being asked | Shared or stage-specific |
|-------|----------------------|--------------------------|
| 1. Integrity | Is the data valid? | Shared |
| 2. Benchmarking | How does it compare with the market? | Shared engine, different benchmark sets per stage |
| 3. Risk modules | What can go wrong? | Stage-specific |
| 4. Scenarios | What happens in the downside, base and upside cases? | Shared mechanics, stage-specific levers |
| 5. Sponsor / portfolio | Can this sponsor deliver, and can they absorb a miss? | Cross-project |
| 6. Synthesis | What should the reviewer look at first, and what do we ask the sponsor? | Shared |

### The stage flag (three values, not two)

Projects move between states, and the transitions carry the biggest risk. Construction to lease-up to stabilization to refinance is where deals break. So the stage flag has three values:

| `stage` value | Plain meaning | Typical signs (guidance for the underwriter) |
|---------------|---------------|---------------|
| `development` | Being built, nothing operating | Nothing is earning yet; budget and draw schedule are live |
| `lease_up` | Partially operating: built or delivering, still filling and not yet stable | Construction is complete but the project has not yet met the stability test in 1f; some actuals exist, some projections remain |
| `completed` | Stabilized and operating with real history | The project has met the stability test in 1f; rent roll and trailing 12 months (T-12) exist |

- The **underwriter chooses the stage** for each project. The tool never works it out. The "typical signs" above are guidance for the underwriter, not rules the tool applies. If the data in the project clearly contradicts the chosen stage, M1 raises a flag. The tool never changes the stage by itself.
- A project is one stage at a time. For a phased project, the underwriter updates the stage and the "as of" date when the next phase is built.
- Every module reads `project.stage` and reports which stage it used.
- **How `lease_up` runs:** it runs the `development` checks for whatever is still projected (remaining budget, remaining lease-up), the `completed` checks for whatever is already actual (rent roll to date, expenses to date), and the transition checks in M3T.

### Transitions are their own risk checks (owned by M3T)

| Transition | Where deals break | Example questions |
|------------|-------------------|-------------------|
| T1: `development` to `lease_up` (delivery) | Late or over-budget delivery, interest reserve running dry, certificate of occupancy slipping | Will the interest reserve last until the first units lease? Is the delivery date realistic against the schedule? |
| T2: `lease_up` to `completed` (stabilization) | Absorption slower than underwritten, concessions masking rent, takeout test missed | At the current pace, when does the property reach stabilization, and does the debt still work by then? |
| T3: `completed` to refinance or sale (takeout / reset) | Rate or cap rate worse than underwritten, maturity wall, debt yield test fails | Will the property meet the lender's refinance tests at today's rates? |

---

## 1. Shared rules (every module follows these)

These keep nine separate sessions from producing nine incompatible pieces. **M0 builds them; everyone else uses them.**

### 1a. Where things live

- Each module lives in its own folder: `src/modules/<module-id>/` (for example `src/modules/m1-integrity/`). Do not edit another module's folder.
- Everything runs in the browser. There is no server. Follow the hosting limits in `CLAUDE.md`.
- Shared types and helpers live in `src/modules/shared/` and are built only by M0. If you need a change there, say so in your pull request instead of editing it.

### 1b. The firm record and the project record

Two linked records describe a review. Field names follow the applicant's workbook, so a flag can point to a cell.

**Firm record:** identity (name, address, principal, other owners and their ownership %); the firm's balance sheet (current and prior period); the principal's personal financial statement; firm earnings (fee income, overhead, EBITDA, debt payments); firm debt and equity; and the list of its projects with the firm's ownership % in each.

**Project record:** identity (name, address, construction and property type); the `stage` chosen by the underwriter; the team (general contractor, architect, development partners and their ownership %); timeline (construction start, completion and stabilization dates); sources and uses (lien priority, source type, amount, term, rate); budget; income (residential by unit type, commercial leases, other income); expenses; debt terms; and an **optional monthly T-12**.

The **T-12** holds up to 12 monthly columns using the same revenue and expense lines as the applicant workbook, plus monthly occupancy, concessions, NOI and debt service. It may have fewer than 12 months. It is optional, but a completed project without one should be flagged by M1.

Every project record carries an **"as of" date**. Every value also carries the **workbook tab and cell it came from**, and the record carries the **workbook version**.

M0 defines the exact fields and provides **made-up sample firms and projects**, each with an answer key stating what every module should produce for it, so every module can be built and tested without waiting for real data.

### 1c. The flag format (what every risk-type module returns)

A module takes a project and returns a list of flags. Each flag has:

| Field | Meaning |
|-------|---------|
| `id` | Stable id, such as `M3D-contingency-low` |
| `module` | The module id that raised it |
| `layer` | 1 to 6 |
| `stage_used` | The stage value the check ran under (`development`, `lease_up` or `completed`) |
| `severity` | `high`, `medium` or `low` |
| `title` | One plain sentence a business reader understands |
| `evidence` | The numbers behind it, with the value and the comparison (for example "contingency 2.1% vs. 5% to 10% benchmark") |
| `cell_refs` | Where the numbers come from, in spreadsheet terms (for example `Budget!C14`, `Sources&Uses!D22`) |
| `follow_up` | The question to put to the sponsor |
| `transition` | `T1`, `T2`, `T3` or empty |

If a check can't run because data is missing, return a low-severity flag saying what's missing. Never crash and never skip silently.

### 1d. Module interface

Every module exports one function, `run(project, context)`, where `context` holds the benchmark sets, scenario settings and (for M5) the sponsor's other projects. It returns `{ flags, notes }`. No module calls another module directly. M6 combines their outputs.

### 1e. Data and privacy

Sample projects use made-up names and numbers only. No real sponsors, lenders, addresses or people. This repository is public. Sample data may be translated from real models only after every name, address, lender and program is replaced and the numbers are altered so no real deal can be recognized.

### 1f. Settings (stored by M0, read by other modules)

| Setting | Default |
|---------|---------|
| Lender's minimum DSCR | 1.20 |
| NOI vs. underwritten | at least 100% |
| Consecutive months | 3 |
| Occupancy floor | 90% |
| Rent premium over market that warrants a look | 10% |

A project passes the **first stability screen** when DSCR and NOI meet their thresholds for the consecutive months. The **occupancy screen** then checks for low occupancy combined with rent well above market. M3T uses this test to estimate when a project will stabilize. It is not used to assign the stage. The underwriter can change any setting.

---

## 2. Module specs

### M0: Shared foundation

**Skill:** data modeling. **Answers:** "What do a firm and its projects look like, and what stage did the underwriter put each project in?"
**Build:**
- The firm record and project record (section 1b), including the optional monthly T-12 and the "as of" date.
- Sample firms and projects covering every stage, with an answer key stating what each module should produce for each one.
- The stage as an input chosen by the underwriter (not worked out by the tool), and the settings in section 1f.
- The flag format and a helper to create a flag (section 1c).
- Benchmark set loader: benchmark sets are data files keyed by stage, so M2 can plug into them.
**You'll see:** a simple page where you pick a sample project and see its stage and fields.

### M1: Integrity checks (Layer 1, shared)

**Skill:** data validation. **Answers:** "Can we trust the numbers at all?"
**Checks (same for every stage):**
- Sources equal uses.
- No error values or broken formulas.
- No template residue (placeholder text, default values left in, unfilled cells).
- Cross-tab tie-outs (a number that appears on two tabs must match).
- The chosen stage is not clearly contradicted by the data (for example development with T-12 rent, completed with no rent roll or T-12, a development project whose stabilization date has passed, or a completed project whose construction completion is in the future). Raise a flag; never change the stage.
**You'll see:** a pass / fail checklist per project, with the failing cells named.
**Possible split:** M1-a sources and uses plus errors; M1-b template residue plus cross-tab tie-outs.

### M2: Benchmarking engine (Layer 2, shared engine)

**Skill:** comparing against the market. **Answers:** "Are these rents, expenses and costs reasonable?"
**Build:** one engine that takes a project and a **benchmark set** and flags outliers. The same engine runs for every stage; only the benchmark set changes.

| Metric | `development` set | `lease_up` set | `completed` set |
|--------|-------------------|----------------|-----------------|
| Rents | Projected rents vs. comparable new deliveries | Achieved rents (net of concessions) vs. comps | Actual in-place rents vs. comps |
| Expenses per unit | Underwritten expenses vs. stabilized comps | Run-rate expenses vs. comps | T-12 expenses vs. comps |
| Cost per square foot | Hard, soft and total cost vs. comps | Remaining cost vs. comps | Not applicable |

Benchmark sets are made-up sample data for now.
**You'll see:** a table showing each metric, the project's value, the market range and a flag when it falls outside.

### M3: Risk modules (Layer 3, stage-specific)

Three modules, one per row on the board.

#### M3D: Development risk

**Skill:** construction-stage underwriting. **Runs for:** `development`, and for the still-projected parts of `lease_up`.
1. **Budget realism:** contingency size, hard-cost to soft-cost ratio, cost per square foot.
2. **Schedule:** start date, completion date, stabilization date, lease-up length, and whether they are consistent with each other.
3. **Capital stack and takeout risk:** lien priority, interest reserve adequacy, refinance or takeout risk.
4. **Team completeness:** is a developer, general contractor, architect, property manager and guarantor named, with relevant experience?
**Possible split:** M3D-a budget plus schedule; M3D-b capital stack plus team.

#### M3C: Completed risk

**Skill:** operating-asset underwriting. **Runs for:** `completed`, and for the already-actual parts of `lease_up`.
1. **Actuals vs. underwriting:** rent roll and T-12 compared with what was underwritten.
2. **Expense normalization:** property tax reassessment, replacement reserves, missing expense lines.
3. **Vacancy realism:** is the vacancy assumption supported by the actual history?
4. **Debt maturity or reset:** when does the loan mature or reset, and on what terms?
**Possible split:** M3C-a actuals plus vacancy; M3C-b expenses plus debt maturity.

#### M3T: Transition checks

**Skill:** stage-change risk. **Runs for:** `lease_up` mainly, and as a look-ahead for `development` and `completed`.
- Builds the `lease_up` view: occupancy trend, absorption pace, concessions, how long until stabilization.
- Uses the stability test in section 1f to estimate when a project will stabilize, and flags high rent combined with low occupancy.
- Runs T1, T2 and T3 (section 0) as separate named checks, each producing flags with `transition` set.
- Every project gets a "next transition" summary: which transition is next, when, and what has to be true for it to go well.
**You'll see:** a timeline for each project showing where it is and which transition is coming.

### M4: Scenario engine (Layer 4, shared mechanics)

**Skill:** sensitivity modeling. **Answers:** "What happens to the debt if things go wrong?"
**Build:** one mechanism that applies a set of **levers** to a project and recomputes the key results (cash flow, DSCR, debt yield, shortfall). Cases: downside, base, upside. The stage decides which levers are available.

| Stage | Downside levers |
|-------|-----------------|
| `development` | Cost overrun, delay, slower absorption, rent haircut, worse exit cap rate or rate at takeout |
| `lease_up` | Delay to stabilization, slower absorption, rent haircut, worse takeout rate (combine the development and completed levers that still apply) |
| `completed` | Vacancy, rent, expense growth, refinance terms |

**You'll see:** three columns (downside, base, upside) with sliders for the levers.

### M5: Sponsor and portfolio (Layer 5, cross-project)

**Skill:** counterparty analysis. **Answers:** "Does this sponsor have the track record and cash to deliver?"
**Build:**
- Uses the firm record from M0. A healthy project under a failing firm is still a risk, and it matters most at the `development` stage.
- Global debt service coverage across all of the sponsor's projects.
- Liquidity (cash and liquid assets against obligations and guarantees).
- Track record.
- **Credibility score:** completed projects feed the score for development projects. Compare **projected vs. delivered** (budget, schedule, rents, stabilization) for the sponsor's completed projects. This is the strongest sponsor evidence available.
**You'll see:** a sponsor page listing their projects, global coverage, liquidity and a credibility score with the projected-vs-delivered table behind it.

### M6: Synthesis (Layer 6, shared)

**Skill:** prioritization and writing. **Answers:** "What should the reviewer look at first?"
**Build:**
- Collect flags from every module, remove duplicates and rank them by severity, then by how much each could move the downside case.
- Each ranked item shows the cell references and the follow-up question for the sponsor.
- Let the reviewer copy the follow-up questions as a list to send to the sponsor.
**You'll see:** one summary page per project: ranked flags on top, then the detail behind each.

---

## 3. Rules for changing this file

- Update only your own claim-board row, or add split rows as described above.
- To change a spec (a module's scope, a new stage rule, a new flag field), make that change in its own small pull request and tell the team. Specs here are the contract between sessions.
- Keep this file in plain language. Business readers use it to decide what to build.
