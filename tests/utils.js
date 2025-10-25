import http from 'http'

export function startUpstreamMock({ mode = 'json', jsonResponse, sseChunks, assertAuth, endpoint = 'openai', statusCode = 200, sseTerminator } = {}) {
  // mode: 'json' or 'sse'
  const received = { headers: null, body: null, url: null, method: null }
  const targetPath = endpoint === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.endsWith(targetPath)) {
      let buf = ''
      req.setEncoding('utf8')
      req.on('data', (d) => (buf += d))
      req.on('end', () => {
        received.headers = req.headers
        received.body = buf
        received.url = req.url
        received.method = req.method
        if (assertAuth) {
          assertAuth(req.headers)
        }
        if (mode === 'json') {
          const payload = jsonResponse || {
            id: 'chatcmpl-test',
            choices: [
              { message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }
          const data = JSON.stringify(payload)
          res.writeHead(statusCode, { 'content-type': 'application/json' })
          res.end(data)
        } else if (mode === 'sse') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          const chunks = sseChunks || []
          for (const obj of chunks) {
            if (typeof obj === 'string') {
              const chunk = obj.endsWith('\n') ? obj : `${obj}\n`
              res.write(chunk.endsWith('\n\n') ? chunk : `${chunk}\n`)
            } else {
              res.write(`data: ${JSON.stringify(obj)}\n\n`)
            }
          }
          const terminator = sseTerminator !== undefined
            ? sseTerminator
            : (endpoint === 'openai' ? 'data: [DONE]\n\n' : '')
          if (terminator) {
            if (typeof terminator === 'string') {
              const chunk = terminator.endsWith('\n\n') ? terminator : `${terminator}\n\n`
              res.write(chunk)
            } else {
              res.write(`data: ${JSON.stringify(terminator)}\n\n`)
            }
          }
          res.end()
        } else {
          res.statusCode = 500
          res.end('unknown mode')
        }
      })
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ server, port: addr.port, received })
    })
  })
}
export async function spawnProxyProcess({ port, baseUrl, env = {}, isolateEnv = false }) {
  const { spawn } = await import('node:child_process')
  const baseEnv = isolateEnv ? {} : process.env
  const child = spawn(process.execPath, ['index.js'], {
    env: {
      ...baseEnv,
      PORT: String(port),
      ANTHROPIC_PROXY_BASE_URL: baseUrl,
      PATH: process.env.PATH,  // Need PATH to find node
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Wait until the server accepts connections: simple retry loop
  await waitForReady(`http://127.0.0.1:${port}/__healthz__`, `http://127.0.0.1:${port}`)
  return child
}

async function waitForReady(healthUrl, baseUrl, attempts = 30) {
  // There is no health route; instead, try connecting root to get 404.
  const url = baseUrl
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.ok || res.status >= 400) return
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('Proxy did not start in time')
}

export function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve()
    child.once('exit', () => resolve())
    child.kill()
    setTimeout(() => resolve(), 500)
  })
}
