import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from '../server.mjs'

// These go through a REAL web server on a real port, to prove the translation between Node's web server and the
// gateway logic works (the logic itself is tested in handler.test.mjs). The AI provider is still pretend, and the key is
// made up.
const KEY = 'FAKE_PROVIDER_KEY_FOR_TESTS_ONLY'
const CODE = 'class-code-one'
const ORIGIN = 'https://team-dev.example.test'
const env = { AI_PROVIDER: 'gemini', AI_MODEL: 'gemini-test-model', AI_API_KEY: KEY, ACCESS_CODES: CODE, ALLOWED_ORIGINS: ORIGIN, ENABLE_PING: '1' }

async function withServer(fn, environment = env) {
  const calls = []
  const fakeProvider = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), { status: 200 })
  }
  const logs = []
  const server = createServer(environment, fakeProvider, (l) => logs.push(l))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, calls, logs)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const call = (base, init = {}) => fetch(`${base}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-access-code': CODE }, body: JSON.stringify({ layer: 'ping' }), ...init })

test('a real request through the real server reaches the (pretend) provider and comes back', async () => {
  await withServer(async (base, calls) => {
    const res = await call(base)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.text, 'ok')
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
    assert.equal(calls.length, 1)
  })
})

test('the health check answers without the code and says nothing about the settings', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  }, {})
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200, 'alive even when not configured')
  }, {})
})

test('a wrong code is refused through the real server, and the provider is never called', async () => {
  await withServer(async (base, calls) => {
    const res = await call(base, { headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-access-code': 'wrong' } })
    assert.equal(res.status, 401)
    assert.equal(calls.length, 0)
  })
})

test('the browser permission check works through the real server', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/ai`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } })
    assert.equal(res.status, 204)
    assert.match(res.headers.get('access-control-allow-headers'), /x-access-code/)
  })
})

test('other addresses are not found, and other methods are refused', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 404)
    assert.equal((await fetch(`${base}/admin`)).status, 404)
    assert.equal((await fetch(`${base}/api/ai`, { method: 'GET', headers: { 'x-access-code': CODE } })).status, 405)
  })
})

test('a huge request is refused and never reaches the provider', async () => {
  await withServer(async (base, calls) => {
    const big = JSON.stringify({ layer: 'review', payload: { text: 'x'.repeat(2_000_000) } })
    let status
    try {
      status = (await call(base, { body: big })).status
    } catch {
      status = 'connection closed' // the server may close the connection once the limit is passed; that is also a refusal
    }
    assert.ok(status === 413 || status === 'connection closed', `got ${status}`)
    assert.equal(calls.length, 0)
  })
})

test('the key never appears in any response from the real server', async () => {
  await withServer(async (base) => {
    for (const init of [{}, { headers: { origin: ORIGIN } }, { body: 'not json' }]) {
      const res = await call(base, init)
      assert.doesNotMatch(await res.text() + JSON.stringify([...res.headers]), new RegExp(KEY))
    }
  })
})

test('npm start actually starts the program, listens on the port the host gives it, and answers', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, PORT: String(port) } })
  try {
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    for (let i = 0; i < 50 && !out.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
    assert.match(out, /"event":"listening"/)
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(res.status, 200)
    // Started with no settings at all, so it must refuse rather than open up.
    const refused = await fetch(`http://127.0.0.1:${port}/api/ai`, { method: 'POST', headers: { 'x-access-code': 'anything' }, body: '{"layer":"ping"}' })
    assert.equal(refused.status, 503)
  } finally {
    child.kill()
  }
})
