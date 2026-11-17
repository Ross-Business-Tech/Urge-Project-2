# Deal Review

A web tool that reads a loan applicant's Excel workbook and tells a reviewer what to look at first. It is built for real estate underwriting, including affordable housing. Everything here uses made-up sample data.

## How it works

1. **Load a workbook.** It is read in the browser and never uploaded. The reviewer chooses the stage (development, lease-up or completed) and an "as of" date. The tool never guesses these.
2. **Seven checks run:** data checks, benchmarks, development risk, completed risk, stage changes, scenarios and sponsor strength. Each reports findings in one shared format (severity, evidence, cells, a question to ask).
3. **Benchmarks are the reviewer's own.** The Benchmarks screen holds the ranges the team trusts (rent by unit type, interest rate, coverage, costs and more). Nothing is compared until a range is entered. They are saved in that browser and can be saved to, and opened from, a file.
4. **Optional AI second opinion.** A reduced copy of the review (names replaced by labels) goes to a small service we run, which holds the AI provider's key and checks an access code. The AI only connects findings; its answer is checked against the data before it is shown.

Try it with the files in `sample-files/`. `full-example-*` is a complete project, with a ready-made benchmarks file. See `sample-files/README.md`.

## Where it runs

| Part | Where | Settings that matter |
|---|---|---|
| Website | Render **Static Site**, built from the `development` branch | Build `npm install && npm run build`, publish folder `dist` |
| AI service | Render **Web Service**, folder `ai-gateway` | Build `npm install`, start `npm start`, health check `/health` |

The website finds the AI service through `src/aiConfig.js`. To check the service, open `https://<service address>/health`. It should show `{"ok":true}`.

## Keeping it running

**The AI service's settings** (Render, the service's Environment tab). Names only. Never put a value in the code, in chat or on GitHub.

`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` (only for a university or other OpenAI-style service), `ACCESS_CODES`, `ALLOWED_ORIGINS`. Details are in `ai-gateway/README.md`.

| When | Do this |
|---|---|
| The website gets a new address, or the AI button says "Could not reach the AI service" | Add that exact address to `ALLOWED_ORIGINS`, separated by commas with no spaces, then wait for **Live**. The error message shows the address to add. |
| Change the access code | Add the new code to `ACCESS_CODES`, tell users, then remove the old one. |
| Rotate the AI key | Replace `AI_API_KEY`, save, and wait for **Live**. |
| First AI request after a quiet spell is slow | Normal on the free plan. The service sleeps when idle. Wait about a minute. |
| Change the app | Branch, open a pull request into `development`, get it approved and merged. The site rebuilds. Only staff merge `development` into `main`. |

**Checks before any change goes out:** `npm install`, then `npm test` and `npm run build`.

## Know before using real client data

- There is one shared access code and no per-person usage limit. Keep the code private and set a low spending limit at the provider.
- Benchmarks live in each browser. A colleague on another computer needs the saved file.

This repository began as the Business+Tech hackathon starter.
