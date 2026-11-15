# AI gateway: the small server that holds the API key

The review tool is a static website, and a website cannot keep a secret. So the website never sees the AI provider's API key. It sends a request here; this server checks who is asking, adds the key, forwards the request to the AI provider, and returns the answer.

```
Website (here.now)  --- data + access code --->  this gateway (Vercel)  --- adds the key --->  AI provider
```

**This folder is set up but not deployed.** It was written and tested without a Vercel account, so the first real deployment is the first time it runs on Vercel. See "Check it works" below. No real API key has ever been in this folder and none should be.

## What it does, and what it refuses

- Accepts only `POST /api/ai` with `{ "layer": "integrity" | "synthesis" | "scenarios", "payload": { ... } }`.
- Needs the **access code** (header `x-access-code`). A wrong or missing code gets a 401 and no AI call is made.
- Answers only the websites you list in `ALLOWED_ORIGINS`.
- The caller sends only the data. The **model, the size cap, the temperature and the instructions are fixed here**; anything the caller sends for those is ignored. This is also why it cannot be used as a free general-purpose AI.
- The data goes to the AI inside a quoted block, with an instruction that nothing inside it is a command, and the data cannot close the block.
- **Fails closed:** if the key or the access codes are not set, it refuses everyone.
- Passes on only the *kind* of provider failure (busy, rejected, unreachable, timeout), never the provider's own message, which could repeat the request.
- Logs one line per call with counts and timing only: never the data, the answer, the access code or the key.

It does **not** store anything, and it does **not** limit how often someone calls it. That is done by the firewall rule below and by the spending limit at the provider.

## Setting it up (the instructor)

**Recommended: put this folder in its own private repository that only you can change.** Copy the `ai-gateway` folder's contents to the root of a new private repo. Students' pull requests to the app can then never read the key or change this code. (If you point Vercel at this folder inside the students' repository instead, any teammate's branch could read a preview key. The fallbacks are in the plan: low spending limit on the preview key, and the production key scoped to `main` only.)

1. **At the AI provider**
   - Create a workspace or project just for this app, and a key just for this gateway.
   - Set a **monthly spending limit** and a billing alert. This is the only hard stop on cost.
2. **At Vercel**
   - Create a team (check Vercel's plan terms: the free Hobby plan is for non-commercial personal use and has no team features).
   - Create a project from the new repository. If you use the students' repository, set the project's **Root Directory** to `ai-gateway`.
   - Add the environment variables below, each as type **Secret** (write-only after saving).
   - Leave **Deployment Protection off** for this project. The browser calling from another website has no Vercel login, so protection would block every call. The access code replaces it.
   - In **Firewall**, add one **rate limit rule** on the path `/api/ai`, for example 20 requests per 10 minutes per IP, action "Too many requests". (Counters are kept per region, so this slows a script down rather than stopping it.)
3. **Hand out** the gateway's address and the access code to the team. **Never** the key.

### Environment variables

| Name | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | The provider key. Secret. Never in code, chat, or GitHub. |
| `ACCESS_CODES` | yes | One or more access codes, separated by commas. To change the code, add the new one, tell people, then remove the old one. |
| `ALLOWED_ORIGINS` | yes | The websites allowed to call this, separated by commas. Exact (`https://my-team-dev.here.now`) or one wildcard subdomain (`https://*.here.now`). A bare `*` is ignored. Without this, every browser call is refused. |
| `AI_MODEL` | no | The model name. Default `claude-sonnet-5-5`. |
| `AI_MAX_TOKENS` | no | Longest answer. Default 4000, never more than 8000. |
| `AI_TEMPERATURE` | no | 0 to 1, default 0 (steadier answers). Set to `none` if the chosen model refuses a temperature. |
| `AI_TIMEOUT_MS` | no | How long to wait for the provider. Default 120000, never more than 250000. |
| `MAX_BODY_BYTES` | no | Largest request. Default 200000, never more than 1000000. |
| `ENABLE_PING` | no | Set to `1` only while testing, to allow the `ping` layer (a cheap "reply ok" check). Turn it off afterwards. |

Changing a variable at Vercel affects **new deployments only**, so redeploy after any change. That includes rotating the key.

## Check it works (first deployment)

Do this with no real data. Replace the three capitalised parts. Set `ENABLE_PING=1` first.

```bash
curl -sS -X POST "https://YOUR-PROJECT.vercel.app/api/ai" \
  -H "content-type: application/json" \
  -H "x-access-code: YOUR-ACCESS-CODE" \
  -d '{"layer":"ping"}'
```

You should get `{"ok":true,"layer":"ping","text":"ok", ...}`. Then check each of these:

1. A **wrong access code** gets `401 bad_code`.
2. A call **from a website that is not listed** (from the app, once the address is in place) is refused with `403`, and one that is listed works. This confirms the cross-website rules on Vercel itself, which the tests here could not.
3. A reply that takes 60 seconds or more completes (Vercel allows up to 300 on the free plan).
4. The **rate limit rule** returns `429` when exceeded.
5. **Delete the key variable and redeploy:** the answer must be `503 not_configured`, not a crash.
6. The key does not appear in any response or in Vercel's log lines.

Then set `ENABLE_PING` back to nothing and redeploy.

## Switching it off, rotating, ending

- **Switch off now:** revoke the key at the provider (instant), or delete `ANTHROPIC_API_KEY` at Vercel and redeploy.
- **Rotate the key:** create a new key, update the Secret, redeploy, then revoke the old key.
- **Suspected leak or runaway spending:** revoke the key at the provider first, then investigate.
- **After the event:** delete the Vercel project and the keys.

## Data

Everything sent here goes on to the AI provider, so both Vercel and the provider handle it. Use **made-up data only** until the instructor has read both companies' data-retention terms and approved reduced real data in writing. This gateway stores nothing and logs no content, but it cannot control what the other two keep.

## Working on this code

```bash
cd ai-gateway
npm test      # 22 tests, no key and no network needed
```

The logic is in `lib/handler.mjs`; `api/ai.mjs` only connects it to Vercel. The instructions the AI receives are in `lib/prompts.mjs` and are **drafts**: the answer shapes will change when the app side is built, and every answer carries a `prompt_version` so quality tests can tell which wording produced it.
