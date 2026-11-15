// The AI gateway: the one small server that holds the AI provider's API key.
//
// The website (a static page) cannot keep a secret, so it sends a request here instead. This code checks who is asking,
// limits what can be asked, adds the secret key on the server, forwards the request to the AI provider and returns the
// answer. The key is read from an environment variable and is never returned, logged, or placed in any response.
//
// Written as a plain function of (request, env, fetch) so it can be tested with a pretend provider and no key.
// It is not tied to Vercel: api/ai.mjs is the thin file that connects it to Vercel.

import { createHash, timingSafeEqual } from 'node:crypto'
import { LAYERS, PROMPT_VERSION, systemPromptFor, userMessageFor } from './prompts.mjs'

const PROVIDER_URL = 'https://api.anthropic.com/v1/messages'
const PROVIDER_VERSION = '2023-06-01'

// Every limit here can be changed by an environment variable, but never by the person calling. The hard caps cannot be
// raised by an environment variable either, so a typo cannot turn this into an expensive endpoint.
const DEFAULTS = { model: 'claude-sonnet-5-5', maxTokens: 4000, maxBodyBytes: 200_000, timeoutMs: 120_000, temperature: 0 }
const HARD = { maxTokens: 8000, maxBodyBytes: 1_000_000, timeoutMs: 250_000 }

const clampInt = (value, fallback, max) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

const list = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// An allowed website address is either exact ("https://app.example.com") or one wildcard subdomain
// ("https://*.example.com"). A bare "*" is never accepted: it would let every website call this.
export function originAllowed(origin, patterns) {
  if (!origin || origin === 'null') return false
  const o = String(origin).toLowerCase()
  return patterns.some((raw) => {
    const p = raw.toLowerCase()
    if (/^https?:\/\/\*\.[a-z0-9.-]+$/.test(p)) {
      const [scheme, host] = p.split('://*.')
      return new RegExp(`^${scheme}://[a-z0-9-]+(\\.[a-z0-9-]+)*\\.${host.replace(/\./g, '\\.')}$`).test(o)
    }
    return !p.includes('*') && p === o
  })
}

// Compare the typed access code with every accepted code without revealing, by timing, how much of it was right.
function codeAccepted(given, accepted) {
  const digest = (s) => createHash('sha256').update(String(s)).digest()
  const want = digest(given ?? '')
  let ok = false
  for (const code of accepted) if (timingSafeEqual(want, digest(code))) ok = true
  return ok
}

function respond(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}

const fail = (status, error, message, headers) => respond(status, { ok: false, error, message }, headers)

export async function handle(request, env = process.env, fetchImpl = fetch, log = console.log) {
  const started = Date.now()
  const origin = request.headers.get('origin')
  const allowedOrigins = list(env.ALLOWED_ORIGINS)

  // 1. Which website is calling. A browser always names itself. A call with no name (a script) is let through to the
  //    access code check, which is the real gate: a script can claim any name, so the name is only a courtesy.
  let cors = {}
  if (origin) {
    if (!originAllowed(origin, allowedOrigins)) return fail(403, 'origin_not_allowed', 'This website is not allowed to use the AI service.')
    cors = {
      'access-control-allow-origin': origin,
      'vary': 'Origin',
    }
  }

  // 2. The browser's "may I?" question before the real request.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-access-code',
        'access-control-max-age': '600',
      },
    })
  }
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', { ...cors, allow: 'POST, OPTIONS' })

  // 3. Is the service set up? If anything is missing it refuses everyone. It never opens up by default.
  const apiKey = env.ANTHROPIC_API_KEY
  const codes = list(env.ACCESS_CODES)
  if (!apiKey || codes.length === 0) return fail(503, 'not_configured', 'The AI service is not set up yet.', cors)

  // 4. The access code.
  if (!codeAccepted(request.headers.get('x-access-code'), codes)) return fail(401, 'bad_code', 'The access code is missing or wrong.', cors)

  // 5. The request: size first, then shape.
  const maxBytes = clampInt(env.MAX_BODY_BYTES, DEFAULTS.maxBodyBytes, HARD.maxBodyBytes)
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) return fail(413, 'too_large', 'The request is too large.', cors)
  let text
  try {
    text = await request.text()
  } catch {
    return fail(400, 'bad_request', 'The request could not be read.', cors)
  }
  if (Buffer.byteLength(text) > maxBytes) return fail(413, 'too_large', 'The request is too large.', cors)

  let body
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'bad_request', 'The request is not valid JSON.', cors)
  }
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isObject(body)) return fail(400, 'bad_request', 'The request must be a JSON object.', cors)

  const layer = body.layer
  const layers = env.ENABLE_PING === '1' ? [...LAYERS, 'ping'] : LAYERS
  if (typeof layer !== 'string' || !layers.includes(layer)) return fail(400, 'unknown_layer', `The layer must be one of: ${layers.join(', ')}.`, cors)
  if (layer !== 'ping' && !isObject(body.payload)) return fail(400, 'bad_request', 'The payload must be a JSON object.', cors)

  // 6. The provider request. The caller supplies only the data. The model, the size cap, the temperature and the
  //    instructions are all fixed here: anything the caller sends for them is ignored.
  const providerBody = {
    model: env.AI_MODEL || DEFAULTS.model,
    max_tokens: clampInt(env.AI_MAX_TOKENS, DEFAULTS.maxTokens, HARD.maxTokens),
    system: systemPromptFor(layer),
    messages: [{ role: 'user', content: userMessageFor(layer, body.payload) }],
  }
  if (String(env.AI_TEMPERATURE ?? '').toLowerCase() !== 'none') {
    const t = Number.parseFloat(env.AI_TEMPERATURE)
    providerBody.temperature = Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : DEFAULTS.temperature
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clampInt(env.AI_TIMEOUT_MS, DEFAULTS.timeoutMs, HARD.timeoutMs))
  let status = 502
  let usage = {}
  try {
    let res
    try {
      res = await fetchImpl(PROVIDER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': PROVIDER_VERSION },
        body: JSON.stringify(providerBody),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        status = 504
        return fail(504, 'timeout', 'The AI service took too long to answer. Try again.', cors)
      }
      return fail(502, 'unreachable', 'The AI service could not be reached.', cors)
    }

    // Whatever the provider says when it refuses can repeat the request, so only the kind of failure is passed on.
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        status = 502
        return fail(502, 'provider_auth', "The AI provider did not accept this service's credentials. Tell the instructor.", cors)
      }
      if (res.status === 429 || res.status === 529) {
        status = 503
        return fail(503, 'busy', 'The AI service is busy or over its limit. Try again in a minute.', { ...cors, 'retry-after': '60' })
      }
      status = 502
      return fail(502, res.status === 400 ? 'provider_rejected' : 'provider_error', 'The AI provider could not complete the request.', cors)
    }

    let answer
    try {
      answer = await res.json()
    } catch {
      return fail(502, 'provider_error', 'The AI provider sent an answer that could not be read.', cors)
    }
    const out = (Array.isArray(answer?.content) ? answer.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('')
    usage = answer?.usage ?? {}
    status = 200
    return respond(200, {
      ok: true,
      layer,
      text: out,
      model: typeof answer?.model === 'string' ? answer.model : providerBody.model,
      stop_reason: answer?.stop_reason ?? null, // "max_tokens" means the answer was cut off
      usage: { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null },
      prompt_version: PROMPT_VERSION,
    }, cors)
  } finally {
    clearTimeout(timer)
    // One line of counts and timing. Never the data sent, the answer, the access code or the key.
    try {
      log(JSON.stringify({ event: 'ai_call', layer, status, ms: Date.now() - started, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null }))
    } catch {
      /* logging must never break a response */
    }
  }
}
