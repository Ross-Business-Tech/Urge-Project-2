import test from 'node:test'
import assert from 'node:assert/strict'
import { askGateway } from '../client.js'

const URL = 'https://gateway.example.test/api/ai'
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
const ask = (fetchImpl, extra = {}) => askGateway({ url: URL, code: 'the-code', payload: { flags: [] }, fetchImpl, ...extra })

test('a good reply returns the text and details', async () => {
  const r = await ask(async () => reply({ ok: true, text: '{"a":1}', model: 'm', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 }, prompt_version: 'draft-2' }))
  assert.deepEqual(r, { ok: true, text: '{"a":1}', model: 'm', stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 }, promptVersion: 'draft-2' })
})

test('the request is a POST to the gateway with the review job, the code in a header, and no cookies or referrer', async () => {
  let seen
  await ask(async (url, init) => { seen = { url, init }; return reply({ ok: true, text: 'x' }) })
  assert.equal(seen.url, URL)
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers['x-access-code'], 'the-code')
  assert.deepEqual(JSON.parse(seen.init.body), { layer: 'review', payload: { flags: [] } })
  assert.equal(seen.init.credentials, 'omit')
  assert.equal(seen.init.referrerPolicy, 'no-referrer')
  assert.doesNotMatch(seen.init.body, /the-code/, 'the code is not in the body')
})

test('every gateway error becomes a plain sentence, and the access code is never in what comes back', async () => {
  for (const error of ['bad_code', 'not_configured', 'origin_not_allowed', 'too_large', 'busy', 'timeout', 'blocked', 'provider_auth', 'provider_rejected', 'provider_error', 'unreachable', 'unknown_layer', 'bad_request']) {
    const r = await ask(async () => reply({ ok: false, error, message: 'raw message' }, 400))
    assert.equal(r.ok, false)
    assert.equal(r.error, error)
    assert.ok(r.message.length > 15 && r.message !== 'raw message', error)
    assert.doesNotMatch(JSON.stringify(r), /the-code/)
  }
})

test('an unfinished set-up names the missing settings (names only)', async () => {
  const r = await ask(async () => reply({ ok: false, error: 'not_configured', message: 'x', missing: ['AI_MODEL', 'ACCESS_CODES'] }, 503))
  assert.match(r.message, /Missing: AI_MODEL, ACCESS_CODES\./)
})

test('a server that cannot be reached gives a message about waking up, not a crash', async () => {
  const r = await ask(async () => { throw new TypeError('Failed to fetch') })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'network')
  assert.match(r.message, /waking up/)
})

test('a reply that is not JSON, or an unknown error, is handled', async () => {
  assert.equal((await ask(async () => new Response('<html>502</html>', { status: 502 }))).error, 'server_error')
  const r = await ask(async () => reply({ ok: false, error: 'something_new' }, 500))
  assert.equal(r.ok, false)
  assert.match(r.message, /returned an error/)
})

test('a gateway that never answers is stopped at the time limit', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  const r = await ask(hang, { timeoutMs: 40 })
  assert.equal(r.error, 'timeout')
})

test('the reviewer can cancel a request in progress', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  const controller = new AbortController()
  const pending = ask(hang, { signal: controller.signal, timeoutMs: 5000 })
  setTimeout(() => controller.abort(), 20)
  assert.equal((await pending).error, 'cancelled')
})

test('it never throws, whatever the reply looks like', async () => {
  for (const body of [null, 'string', [], { ok: true }, { ok: true, text: 5 }]) {
    const r = await ask(async () => new Response(JSON.stringify(body), { status: 200 }))
    assert.equal(r.ok, false)
  }
})
