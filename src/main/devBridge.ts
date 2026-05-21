import { createServer, IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'
import { handlers } from './handlers'
import { addExternalListener } from './services/broadcaster'

/**
 * Dev-only HTTP + Server-Sent Events bridge. Lets a regular browser tab
 * pointed at http://localhost:5173 invoke the same handler registry as
 * the Electron renderer, so we can iterate on the UI without restarting
 * the Electron window.
 *
 * - `POST /api/<channel>` — JSON body `{ args: [...] }`, returns `{ result }` or `{ error }`
 * - `POST /api/recording:chunk?meetingId=...` — raw application/octet-stream body
 * - `GET /events` — SSE stream of every `broadcast()` call from main
 *
 * CORS is wide open (Access-Control-Allow-Origin: *) because the server
 * only listens on 127.0.0.1 and is gated behind `is.dev`. Do not enable
 * this in production builds.
 */

const PORT = 9877

interface SseClient {
  res: ServerResponse
}

const sseClients = new Set<SseClient>()

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCors(res)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  channel: string,
  url: URL
): Promise<void> {
  const handler = handlers[channel]
  if (!handler) {
    sendJson(res, 404, { error: `Unknown channel: ${channel}` })
    return
  }
  try {
    let args: unknown[]
    if (channel === 'recording:chunk') {
      // Raw binary body. meetingId comes from the query string.
      const meetingId = url.searchParams.get('meetingId')
      if (!meetingId) throw new Error('meetingId query param required')
      const buf = await readBody(req)
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      args = [meetingId, ab]
    } else {
      const body = await readBody(req)
      const parsed = body.length > 0 ? JSON.parse(body.toString('utf-8')) : { args: [] }
      args = Array.isArray(parsed.args) ? parsed.args : []
    }
    const result = await Promise.resolve(handler(...args))
    sendJson(res, 200, { result: result ?? null })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    sendJson(res, 500, { error: message })
  }
}

function handleSse(req: IncomingMessage, res: ServerResponse): void {
  setCors(res)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  res.write('retry: 2000\n\n')
  const client: SseClient = { res }
  sseClients.add(client)
  // Heartbeat so proxies don't time out idle streams.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      // ignore
    }
  }, 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(client)
  })
}

function pushEvent(channel: string, payload: unknown): void {
  const line = `event: ${channel}\ndata: ${JSON.stringify(payload ?? null)}\n\n`
  for (const client of sseClients) {
    try {
      client.res.write(line)
    } catch {
      sseClients.delete(client)
    }
  }
}

let started = false
let cleanup: (() => void) | null = null

export function startDevBridge(): void {
  if (started) return
  started = true
  cleanup = addExternalListener(pushEvent)

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

    if (req.method === 'OPTIONS') {
      setCors(res)
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      handleSse(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const channel = decodeURIComponent(url.pathname.slice(5))
      void handleApi(req, res, channel, url)
      return
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, handlers: Object.keys(handlers).length })
      return
    }

    setCors(res)
    res.statusCode = 404
    res.end('not found')
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[devBridge] listening on http://127.0.0.1:${PORT}`)
  })

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[devBridge] port ${PORT} in use — bridge disabled this session`)
    } else {
      console.error('[devBridge] server error:', e)
    }
  })
}

export function stopDevBridge(): void {
  if (cleanup) cleanup()
  cleanup = null
  started = false
}
