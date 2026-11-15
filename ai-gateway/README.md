# AI gateway: the small server that holds the API key

The review tool is a static website, and a website cannot keep a secret. So the website never sees the AI provider's API key. It sends a request here; this server checks who is asking, adds the key, forwards the request to the AI provider, and returns the answer.

```
Website (here.now)  --- data + access code --->  this gateway (Vercel)  --- adds the key --->  AI provider
```

**This folder is set up but not deployed.** It was written and tested without a Vercel account, so the first real deployment is the first time it runs on Vercel. See "Check it works" below. No real API key has ever been in this folder and none should be.

**Which AI provider.** It works with **Google Gemini** or **Anthropic**, chosen by the `AI_PROVIDER` setting. You can tell which kind of key you hold from its first characters (look, but do not paste it anywhere): a Google AI Studio key starts with `AIza`, an Anthropic key with `sk-ant-`. **The Gemini side was written without being able to read Google's current documentation**, so it is proven only by the first real call (the ping check). If that call fails, only `lib/providers.mjs` needs to change.

## What it does, and what it refuses

- Accepts only `POST /api/ai` with `{ "layer": "integrity" | "synthesis" | "scenarios", "payload": { ... } }`.
- Needs the **access code** (header `x-access-code`). A wrong or missing code gets a 401 and no AI call is made.
- Answers only the websites you list in `ALLOWED_ORIGINS`.
- The caller sends only the data. The **model, the size cap, the temperature and the instructions are fixed here**; anything the caller sends for those is ignored. This is also why it cannot be used as a free general-purpose AI.
- The data goes to the AI inside a quoted block, with an instruction that nothing inside it is a command, and the data cannot close the block.
- **Fails closed:** if the key or the access codes are not set, it refuses everyone.
- Passes on only the *kind* of provider failure (busy, rejected, unreachable, timeout), never the provider's own message, which could repeat the request.
- Logs one line per call with counts and timing only: never the data, the answer, the access code or the key.

It does **not** store anything, and it does **not** limit how often someone calls it. **On Vercel** a firewall rule does that (below). **On Render there is no equivalent set up**, so the limits are the access code and the spending limit at the provider. Anyone who gets the access code could run up a bill up to that limit, so keep the code private, change it when someone leaves, and keep the provider's spending limit low. A per-code limit inside the server is a sensible next addition.

## Hosting on Render (this is the **start command**)

Render runs a program that stays on and listens for requests, so it uses `server.mjs` (a thin wrapper; the logic is the same). Render's own documentation says a web service must listen on `0.0.0.0` on the `PORT` Render provides (default 10000); `server.mjs` does exactly that.

Create a **Web Service** from the repository and fill in:

| Render field | Value |
|---|---|
| Language / runtime | Node |
| Root Directory | blank if the repo holds only this folder's contents (recommended). `ai-gateway` if you point Render at the students' repository instead (weaker: see the repository note below). |
| Build Command | `npm install` |
| **Start Command** | **`npm start`** (the same as `node server.mjs`) |
| Health Check Path | `/health` |
| Environment variables | The table below. **Do not set `PORT`**: Render sets it. |

- The address Render gives you ends in `.onrender.com`. The endpoint is `https://YOUR-SERVICE.onrender.com/api/ai`.
- **Node version:** Render checks the `NODE_VERSION` setting, then a `.node-version` file, then `engines` in `package.json` (this folder's is `>=22 <26`, with an upper bound, as Render's docs advise). Its current default is Node 24, which works. Nothing to set unless you want to pin one.
- **Free instances sleep** when idle, so the first request after a quiet spell can take a long while (I believe about a minute, but I could not read Render's page on this: check "Free instances" in their docs). The app will need to show "waking up" for that case. A paid instance stays awake.
- Render's `Secret Files` and encrypted settings are fine for the key; whichever you use, it must never go in the repository.

## Setting it up (the instructor)

**Recommended: put this folder in its own private repository that only you can change.** Copy the `ai-gateway` folder's contents to the root of a new private repo. Students' pull requests to the app can then never read the key or change this code. (If you point Vercel at this folder inside the students' repository instead, any teammate's branch could read a preview key. The fallbacks are in the plan: low spending limit on the preview key, and the production key scoped to `main` only.)

1. **At the AI provider**
   - **Gemini:** create the key in Google AI Studio (aistudio.google.com), in a Google Cloud project used only for this app. Then, in Google Cloud, set a **budget and alert** on that project. Google AI Studio keys on the free tier have their own usage caps, which also limit the damage, but **a free-tier key is not suitable for anything but made-up data** (see "Data" below).
   - **Anthropic:** create a workspace or project just for this app, and a key just for this gateway.
   - Either way, set a **monthly spending limit** and a billing alert. This is the only hard stop on cost.
   - Choose the **model name** on purpose (see `AI_MODEL` below). Gemini has no built-in default, because model names change and a stale one would fail.
2. **At Vercel** (skip this step if you host on Render: use the section above and then the environment variables table)
   - Create a team (check Vercel's plan terms: the free Hobby plan is for non-commercial personal use and has no team features).
   - Create a project from the new repository. If you use the students' repository, set the project's **Root Directory** to `ai-gateway`.
   - Add the environment variables below, each as type **Secret** (write-only after saving).
   - Leave **Deployment Protection off** for this project. The browser calling from another website has no Vercel login, so protection would block every call. The access code replaces it.
   - In **Firewall**, add one **rate limit rule** on the path `/api/ai`, for example 20 requests per 10 minutes per IP, action "Too many requests". (Counters are kept per region, so this slows a script down rather than stopping it.)
3. **Hand out** the gateway's address and the access code to the team. **Never** the key.

### Environment variables

| Name | Required | What it is |
|---|---|---|
| `AI_PROVIDER` | yes | `gemini` or `anthropic`. Anything else, or empty, and the service refuses everyone. |
| `AI_API_KEY` | yes | The provider key (whichever provider `AI_PROVIDER` names). Secret. Never in code, chat, or GitHub. |
| `ACCESS_CODES` | yes | One or more access codes, separated by commas. To change the code, add the new one, tell people, then remove the old one. |
| `ALLOWED_ORIGINS` | yes | The websites allowed to call this, separated by commas. Exact (`https://my-team-dev.here.now`) or one wildcard subdomain (`https://*.here.now`). A bare `*` is ignored. Without this, every browser call is refused. |
| `AI_MODEL` | Gemini: yes. Anthropic: no | The model name, exactly as the provider lists it (for Gemini, the model code shown in Google AI Studio; pick a current text model that supports JSON answers). Anthropic defaults to `claude-sonnet-5-5`. |
| `AI_MAX_TOKENS` | no | Longest answer. Default 4000, never more than 8000. |
| `AI_TEMPERATURE` | no | 0 to 1, default 0 (steadier answers). Set to `none` if the chosen model refuses a temperature. |
| `AI_TIMEOUT_MS` | no | How long to wait for the provider. Default 120000, never more than 250000. |
| `MAX_BODY_BYTES` | no | Largest request. Default 200000, never more than 1000000. |
| `ENABLE_PING` | no | Set to `1` only while testing, to allow the `ping` layer (a cheap "reply ok" check). Turn it off afterwards. |

Changing a variable at Vercel affects **new deployments only**, so redeploy after any change. That includes rotating the key. (On Render, saving a changed variable redeploys the service, as I understand it; check it picked up the change.)

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
5. **Delete the key variable and redeploy:** the answer must be `503 not_configured`, not a crash. (The same happens if `AI_PROVIDER` or, for Gemini, `AI_MODEL` is missing.)
6. The key does not appear in any response or in Vercel's log lines.

If the ping call returns `provider_auth`, the key was not accepted: check that it belongs to the provider named in `AI_PROVIDER`. If it returns `provider_rejected`, check the model name. `blocked` means the provider declined to answer.

Then set `ENABLE_PING` back to nothing and redeploy.

## Switching it off, rotating, ending

- **Switch off now:** revoke the key at the provider (instant), or delete `AI_API_KEY` at Vercel and redeploy.
- **Rotate the key:** create a new key, update the Secret, redeploy, then revoke the old key.
- **Suspected leak or runaway spending:** revoke the key at the provider first, then investigate.
- **After the event:** delete the Vercel project and the keys.

## Data

Everything sent here goes on to the AI provider, so both Vercel and the provider handle it. Use **made-up data only** until the instructor has read both companies' data terms and approved reduced real data in writing. This gateway stores nothing and logs no content, but it cannot control what the other two keep.

**Gemini in particular:** the terms for Google's Gemini API differ between its free ("unpaid") and paid (billing-enabled) use, and as I understand it the free tier may let Google use what is sent to improve its products and may involve human review. **I could not read Google's terms while building this, so treat that as something to check, not a fact.** Until the instructor has read them, send nothing that is not made up, and do not assume a paid key changes this.

## Working on this code

```bash
cd ai-gateway
npm test      # 37 tests, no key and no network needed
```

The logic is in `lib/handler.mjs`. `api/ai.mjs` connects it to Vercel and `server.mjs` (the Render start command) connects it to a normal web server. The instructions the AI receives are in `lib/prompts.mjs` and are **drafts**: the answer shapes will change when the app side is built, and every answer carries a `prompt_version` so quality tests can tell which wording produced it.
