// The AI providers this gateway can talk to. Each one only describes how to build its request and how to read its
// answer; the checks, limits and secrecy rules live in handler.mjs and are the same for every provider.
//
// The key always goes in a request HEADER, never in the web address, because web addresses end up in logs.
//
// NOTE ON ACCURACY. The Anthropic adapter follows its published messages API. The Gemini and OpenAI adapters were written from
// knowledge of those APIs WITHOUT being able to read their current documentation from the build environment, so their request
// and answer shapes have only been tested against the shapes described here, not against Google or OpenAI. The first real call
// (the "ping" check in the README) is what proves it. If that fails, only this file changes.

const ANTHROPIC = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-sonnet-5-5',

  request({ apiKey, model, maxTokens, temperature, system, user }) {
    const body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }
    if (temperature !== null) body.temperature = temperature
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body,
    }
  },

  // What kind of failure this was, judged from the status only. The provider's own message is never passed on.
  classify(status) {
    if (status === 401 || status === 403) return 'auth'
    if (status === 429 || status === 529) return 'busy'
    if (status === 400) return 'rejected'
    return 'error'
  },

  parse(answer, fallbackModel) {
    const text = (Array.isArray(answer?.content) ? answer.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('')
    return {
      text,
      model: typeof answer?.model === 'string' ? answer.model : fallbackModel,
      stopReason: answer?.stop_reason ?? null,
      usage: { input_tokens: answer?.usage?.input_tokens ?? null, output_tokens: answer?.usage?.output_tokens ?? null },
      blocked: false,
    }
  },
}

const GEMINI = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: null, // model names change; the instructor must choose one on purpose (see the README)

  request({ apiKey, model, maxTokens, temperature, system, user, json }) {
    const generationConfig = { maxOutputTokens: maxTokens }
    if (temperature !== null) generationConfig.temperature = temperature
    if (json) generationConfig.responseMimeType = 'application/json'
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      },
    }
  },

  // Google reports a rejected key as 400 as well as 401/403, so a 400 whose error text mentions the key counts as an
  // authentication problem. The text is only read to decide this, never passed on.
  classify(status, errorBody) {
    if (status === 401 || status === 403) return 'auth'
    if (status === 400) return /api key/i.test(String(errorBody?.error?.message ?? '')) ? 'auth' : 'rejected'
    if (status === 429 || status === 503) return 'busy'
    return 'error'
  },

  parse(answer, fallbackModel) {
    const candidate = Array.isArray(answer?.candidates) ? answer.candidates[0] : null
    const text = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
    const reason = candidate?.finishReason ?? null
    // Google can decline to answer (a safety block). That arrives as a normal 200 with no text.
    const blocked = Boolean(answer?.promptFeedback?.blockReason) || (!text && reason !== null && reason !== 'STOP' && reason !== 'MAX_TOKENS')
    return {
      text,
      model: typeof answer?.modelVersion === 'string' ? answer.modelVersion : fallbackModel,
      stopReason: reason === 'MAX_TOKENS' ? 'max_tokens' : reason === 'STOP' ? 'end_turn' : reason,
      usage: { input_tokens: answer?.usageMetadata?.promptTokenCount ?? null, output_tokens: answer?.usageMetadata?.candidatesTokenCount ?? null },
      blocked,
    }
  },
}

// OpenAI, through its "Responses" endpoint rather than the older chat endpoint: I believe the Codex models are served only
// there, and it accepts the other models too. The key goes in an Authorization header.
//
// It also serves any service that copies OpenAI's interface (a university's AI service, for example): set AI_BASE_URL to
// that service's address and the same request goes there instead. The key is then sent to THAT address, so the address is
// the instructor's to set, never the caller's.
const OPENAI = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: null, // model names change; the instructor must choose one on purpose (see the README)
  // Many newer OpenAI models refuse a temperature, so none is sent unless the instructor sets one (AI_TEMPERATURE).
  defaultTemperature: null,

  request({ apiKey, model, maxTokens, temperature, system, user, json, baseUrl }) {
    const body = {
      model,
      instructions: system,
      input: user,
      max_output_tokens: maxTokens,
      store: false, // do not keep the request or the answer on OpenAI's side
    }
    if (temperature !== null) body.temperature = temperature
    if (json) body.text = { format: { type: 'json_object' } }
    return {
      url: `${baseUrl ?? 'https://api.openai.com/v1'}/responses`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body,
    }
  },

  // 404 is how an unknown model name is reported.
  classify(status) {
    if (status === 401 || status === 403) return 'auth'
    if (status === 429) return 'busy' // a rate limit, or the account being out of credit: either way, "over its limit"
    if (status === 400 || status === 404 || status === 422) return 'rejected'
    return 'error'
  },

  parse(answer, fallbackModel) {
    const items = Array.isArray(answer?.output) ? answer.output : []
    // Other items (such as the model's own reasoning) are not part of the answer.
    const parts = items.filter((i) => i?.type === 'message').flatMap((i) => (Array.isArray(i.content) ? i.content : []))
    const text = parts.filter((p) => p?.type === 'output_text').map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
    const reason = answer?.status === 'incomplete' ? (answer?.incomplete_details?.reason ?? 'incomplete') : null
    return {
      text,
      model: typeof answer?.model === 'string' ? answer.model : fallbackModel,
      stopReason: reason === 'max_output_tokens' ? 'max_tokens' : reason === null ? 'end_turn' : reason,
      usage: { input_tokens: answer?.usage?.input_tokens ?? null, output_tokens: answer?.usage?.output_tokens ?? null },
      // The model declined (a refusal), or a content filter stopped it.
      blocked: parts.some((p) => p?.type === 'refusal') || reason === 'content_filter',
      failed: answer?.status === 'failed',
    }
  },
}

export const PROVIDERS = { anthropic: ANTHROPIC, gemini: GEMINI, openai: OPENAI }
