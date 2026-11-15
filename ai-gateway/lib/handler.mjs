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
import { PROVIDERS } from './providers.mjs'

// Every limit here can be changed by an environment variable, but never by the person calling. The hard caps cannot be
// raised by an environment variable either, so a typo cannot turn this into an expensive endpoint.
const DEFAULTS = { maxTokens: 4000, maxBodyBytes: 200_000, timeoutMs: 120_000, temperature: 0 }
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

  // 3. Is the service set up? If anything is missing it refuses everyone. It never opens up by default. The provider
  //    and the model are chosen here by the instructor, never by the caller.
  // Settings pasted into a dashboard often carry a stray space or newline, or a capital letter, so those are forgiven.
  const apiKey = String(env.AI_API_KEY ?? '').trim()
  const codes = list(env.ACCESS_CODES)
  const providerId = String(env.AI_PROVIDER ?? '').trim().toLowerCase()
  const provider = Object.hasOwn(PROVIDERS, providerId) ? PROVIDERS[providerId] : null
  const model = provider ? String(env.AI_MODEL ?? '').trim() || provider.defaultModel : null
  if (!apiKey || codes.length === 0 || !provider || !model) {
    // Say which settings are missing, by NAME only (the names are in the public README). Never a value.
    const missing = []
    if (!apiKey) missing.push('AI_API_KEY')
    if (codes.length === 0) missing.push('ACCESS_CODES')
    if (!provider) missing.push('AI_PROVIDER (must be gemini or anthropic)')
    else if (!model) missing.push('AI_MODEL')
    return respond(503, { ok: false, error: 'not_configured', message: 'The AI service is not set up yet.', missing }, cors)
  }

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
  let temperature = null
  if (String(env.AI_TEMPERATURE ?? '').toLowerCase() !== 'none') {
    const t = Number.parseFloat(env.AI_TEMPERATURE)
    temperature = Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : DEFAULTS.temperature
  }
  const call = provider.request({
    apiKey,
    model,
    maxTokens: clampInt(env.AI_MAX_TOKENS, DEFAULTS.maxTokens, HARD.maxTokens),
    temperature,
    system: systemPromptFor(layer),
    user: userMessageFor(layer, body.payload),
    json: layer !== 'ping',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clampInt(env.AI_TIMEOUT_MS, DEFAULTS.timeoutMs, HARD.timeoutMs))
  let status = 502
  let usage = {}
  try {
    let res
    try {
      res = await fetchImpl(call.url, { method: 'POST', headers: call.headers, body: JSON.stringify(call.body), signal: controller.signal })
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        status = 504
        return fail(504, 'timeout', 'The AI service took too long to answer. Try again.', cors)
      }
      return fail(502, 'unreachable', 'The AI service could not be reached.', cors)
    }

    // Whatever the provider says when it refuses can repeat the request, so only the kind of failure is passed on.
    if (!res.ok) {
      let errorBody = null
      try {
        errorBody = await res.json()
      } catch {
        /* no readable body: the status alone decides */
      }
      const kind = provider.classify(res.status, errorBody)
      if (kind === 'auth') {
        status = 502
        return fail(502, 'provider_auth', "The AI provider did not accept this service's credentials. Tell the instructor.", cors)
      }
      if (kind === 'busy') {
        status = 503
        return fail(503, 'busy', 'The AI service is busy or over its limit. Try again in a minute.', { ...cors, 'retry-after': '60' })
      }
      status = 502
      return fail(502, kind === 'rejected' ? 'provider_rejected' : 'provider_error', 'The AI provider could not complete the request.', cors)
    }

    let answer
    try {
      answer = await res.json()
    } catch {
      return fail(502, 'provider_error', 'The AI provider sent an answer that could not be read.', cors)
    }
    const parsed = provider.parse(answer, model)
    usage = parsed.usage
    if (parsed.blocked) {
      status = 422
      return fail(422, 'blocked', 'The AI provider declined to answer this request.', cors)
    }
    status = 200
    return respond(200, {
      ok: true,
      layer,
      text: parsed.text,
      model: parsed.model,
      stop_reason: parsed.stopReason, // "max_tokens" means the answer was cut off
      usage,
      prompt_version: PROMPT_VERSION,
    }, cors)
  } finally {
    clearTimeout(timer)
    // One line of counts and timing. Never the data sent, the answer, the access code or the key.
    try {
      log(JSON.stringify({ event: 'ai_call', provider: provider.id, layer, status, ms: Date.now() - started, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null }))
    } catch {
      /* logging must never break a response */
    }
  }
}
