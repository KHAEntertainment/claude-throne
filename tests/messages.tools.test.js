import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

function parseSSE(text) {
  const events = []
  const lines = text.split(/\r?\n/)
  let cur = { event: 'message', data: '' }
  for (const line of lines) {
    if (line.startsWith('event: ')) cur.event = line.slice(7).trim()
    else if (line.startsWith('data: ')) cur.data = line.slice(6)
    else if (line.trim() === '') {
      if (cur.data) events.push({ ...cur });
      cur = { event: 'message', data: '' }
    }
  }
  return events
}

describe('POST /v1/messages (streaming tool calls)', () => {
  it('maps OpenAI tool_calls deltas to Anthropic tool_use content blocks', async () => {
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] } }] },
    ]
    const upstream = await startUpstreamMock({ mode: 'sse', sseChunks: chunks })
    const proxyPort = 3113
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
      const start = events.find((e) => e.event === 'content_block_start')
      expect(start).toBeTruthy()
      const startPayload = JSON.parse(start.data)
      expect(startPayload.content_block.type).toBe('tool_use')
      expect(startPayload.content_block.name).toBe('get_weather')

      const deltas = events
        .filter((e) => e.event === 'content_block_delta')
        .map((e) => JSON.parse(e.data))
      const jsonPieces = deltas.map((d) => d.delta.partial_json).join('')
      expect(jsonPieces).toBe('{"city":"SF"}')

      const lastDelta = events[events.length - 2] // message_delta
      const md = JSON.parse(lastDelta.data)
      expect(md.delta.stop_reason).toBe('tool_use')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})
