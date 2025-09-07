import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

function parseSSE(text) {
  // Returns array of { event, data }
  const events = []
  const lines = text.split(/\r?\n/)
  let current = { event: 'message', data: '' }
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      current.event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      const d = line.slice(6)
      current.data = d
    } else if (line.trim() === '') {
      if (current.data) {
        events.push({ ...current })
      }
      current = { event: 'message', data: '' }
    }
  }
  return events
}

describe('POST /v1/messages (streaming)', () => {
  it('re-emits SSE events in expected sequence for text deltas', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
    ]
    const upstream = await startUpstreamMock({ mode: 'sse', sseChunks: chunks })
    const proxyPort = 3112
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { CUSTOM_API_KEY: 'testkey' },
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .buffer(true)
        .parse((res, cb) => {
          res.setEncoding('utf8')
          let data = ''
          res.on('data', (d) => (data += d))
          res.on('end', () => cb(null, data))
        })
        .send({ messages: [{ role: 'user', content: 'Say hi' }], stream: true })
        .expect(200)

      const raw = res.text ?? res.body
      const events = parseSSE(raw)
      const names = events.map((e) => e.event)
      // Expect message_start, ping, content_block_start, content_block_delta..., content_block_stop, message_delta, message_stop
      expect(names[0]).toBe('message_start')
      expect(names[1]).toBe('ping')
      expect(names).toContain('content_block_start')
      expect(names).toContain('content_block_delta')
      expect(names[names.length - 2]).toBe('message_delta')
      expect(names[names.length - 1]).toBe('message_stop')

      // Verify deltas contain our text
      const deltas = events.filter((e) => e.event === 'content_block_delta').map((e) => JSON.parse(e.data))
      const text = deltas.map((d) => d.delta.text || '').join('')
      expect(text).toBe('Hello')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})
