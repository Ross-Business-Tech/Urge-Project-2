// Talks to the AI gateway (ai-gateway/ in this repository, hosted separately). The access code goes in a header, is typed by the
// reviewer each session, and is never stored. The AI provider's key is not here and never will be: it lives on the gateway.

const MESSAGES = {
  bad_code: 'The access code was not accepted. Check it and try again.',
  not_configured: 'The AI service is not set up yet. Ask whoever runs it.',
  origin_not_allowed: 'This website is not on the AI service’s allowed list. Ask whoever runs it to add it.',
  too_large: 'This review is too large to send. Try a smaller workbook.',
  busy: 'The AI service is busy or over its limit. Try again in a minute.',
  timeout: 'The AI service took too long to answer. Try again.',
  blocked: 'The AI provider declined to answer this request.',
  provider_auth: 'The AI provider did not accept the service’s credentials. Tell whoever runs it.',
  provider_rejected: 'The AI provider could not accept this request. Tell whoever runs it.',
  provider_error: 'The AI provider had a problem. Try again in a minute.',
  unreachable: 'The AI service could not reach the AI provider. Try again in a minute.',
  unknown_layer: 'The AI service does not recognise this request. It may need updating.',
  bad_request: 'The AI service could not read the request.',
  server_error: 'Something went wrong on the AI service. Try again.',
}

// The browser gives the same failure when the service is asleep, when it is down, and when it does not allow this website's address
// (it then blocks the reply, so the clearer "not on the allowed list" message can never arrive). So the message names the address.
const networkMessage = (origin) =>
  `Could not reach the AI service. If it has been idle it may be waking up, which can take about a minute: try again shortly. If it keeps failing, the service may not allow this website's address${origin ? ` (${origin})` : ''}: ask whoever runs it to add it to its allowed list.`

const pageOrigin = () => {
  try {
    return typeof location !== 'undefined' && /^https?:\/\//.test(location.origin) ? location.origin : null
  } catch {
    return null
  }
}

// Ask for a review. Returns { ok: true, text, ... } or { ok: false, error, message }. Never throws.
export async function askGateway({ url, code, payload, fetchImpl = fetch, signal, timeoutMs = 170_000, origin = pageOrigin() }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    let res
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': code },
        body: JSON.stringify({ layer: 'review', payload }),
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
    } catch {
      if (signal?.aborted) return { ok: false, error: 'cancelled', message: 'Cancelled.' }
      if (controller.signal.aborted) return { ok: false, error: 'timeout', message: MESSAGES.timeout }
      return { ok: false, error: 'network', message: networkMessage(origin) }
    }
    let body = null
    try {
      body = await res.json()
    } catch {
      /* not JSON: handled below */
    }
    if (res.ok && body?.ok && typeof body.text === 'string') {
      return { ok: true, text: body.text, model: body.model ?? null, stopReason: body.stop_reason ?? null, usage: body.usage ?? null, promptVersion: body.prompt_version ?? null }
    }
    const error = typeof body?.error === 'string' ? body.error : 'server_error'
    const missing = Array.isArray(body?.missing) && body.missing.length ? ` Missing: ${body.missing.join(', ')}.` : ''
    return { ok: false, error, status: res.status, message: (MESSAGES[error] ?? 'The AI service returned an error. Try again.') + (error === 'not_configured' ? missing : '') }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
