// A small always-running web server around the gateway, for hosts such as Render that run a program and send it traffic
// (Vercel instead calls api/ai.mjs directly and does not use this file).
//
//   npm start        starts it. The host supplies PORT; it listens on 0.0.0.0 as such hosts require.
//
// It only translates between Node's web server objects and the standard Request / Response the gateway logic uses. All the
// checks (access code, allowed websites, limits, secrecy) are in lib/handler.mjs and are the same on every host.

import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { handle } from './lib/handler.mjs'

// The most this file will read from a caller at all, before the gateway's own (smaller, configurable) limit applies.
// It stops someone from streaming gigabytes into memory.
const READ_LIMIT = 1_000_000

const AI_PATHS = new Set(['/api/ai', '/ai'])

function send(res, status, headers, body) {
  res.writeHead(status, headers)
  res.end(body)
}

const json = (res, status, body) => send(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, JSON.stringify(body))

// Read the body, giving up as soon as it is larger than the limit.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > READ_LIMIT) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function createServer(env = process.env, fetchImpl = fetch, log = console.log) {
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://placeholder').pathname

      // The host asks this to know the program is alive. It says nothing about the settings or the key.
      if (path === '/health' && (req.method === 'GET' || req.method === 'HEAD')) return json(res, 200, { ok: true })

      if (!AI_PATHS.has(path)) return json(res, 404, { ok: false, error: 'not_found', message: 'Not found.' })

      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const v of value) headers.append(name, v)
        else if (value !== undefined) headers.set(name, value)
      }

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      let body
      if (hasBody) {
        try {
          body = await readBody(req)
        } catch (err) {
          if (err?.tooLarge) return json(res, 413, { ok: false, error: 'too_large', message: 'The request is too large.' })
          return json(res, 400, { ok: false, error: 'bad_request', message: 'The request could not be read.' })
        }
      }

      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers, body: hasBody ? body : undefined })
      const response = await handle(request, env, fetchImpl, log)
      const out = Buffer.from(await response.arrayBuffer())
      send(res, response.status, Object.fromEntries(response.headers), out)
    } catch {
      // Never show details of an unexpected failure.
      if (!res.headersSent) json(res, 500, { ok: false, error: 'server_error', message: 'Something went wrong on the server.' })
      else res.end()
    }
  })
  // Longer than the usual 60 seconds some hosts' front doors keep a connection, so the host does not close it first.
  server.keepAliveTimeout = 120_000
  server.headersTimeout = 125_000
  server.requestTimeout = 200_000
  return server
}

// Start listening only when this file is run directly (npm start), not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT, 10) || 10000
  const server = createServer()
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })))
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
}
