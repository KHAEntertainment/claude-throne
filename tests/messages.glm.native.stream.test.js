import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

function parseSSE(text) {
  const events = []
  const lines = text.split(/\r?\n/)
  let current = { event: 'message', data: '' }
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      current.event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      current.data = line.slice(6)
    } else if (line.trim() === '') {
      if (current.data) {
        events.push({ ...current })
      }
      current = { event: 'message', data: '' }
    }
  }
  return events
}

describe('POST /v1/messages (GLM Anthropic native streaming)', () => {
  it('relays Anthropic SSE stream unchanged', async () => {
    const upstreamEvents = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_glm_stream","type":"message","role":"assistant","content":[]}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi from GLM"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]

    const upstream = await startUpstreamMock({
      mode: 'sse',
      endpoint: 'anthropic',
      sseChunks: upstreamEvents,
      sseTerminator: ''
    })
    const proxyPort = 3214
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        FORCE_PROVIDER: 'glm',
        ZAI_API_KEY: 'glm-stream-key'
      },
      isolateEnv: true
    })

    const anthropicRequest = {
      model: 'glm-4-plus',
      stream: true,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Stream hello' }]
        }
      ]
    }

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .buffer(true)
        .parse((response, cb) => {
          response.setEncoding('utf8')
          let data = ''
          response.on('data', (chunk) => (data += chunk))
          response.on('end', () => cb(null, data))
        })
        .send(anthropicRequest)
        .expect(200)

      const raw = res.text ?? res.body
      expect(raw).toBe(upstreamEvents.join(''))

      const events = parseSSE(raw)
      expect(events.map((e) => e.event)).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'message_stop'
      ])
      expect(events.find((e) => e.event === 'content_block_delta')?.data).toContain('"text":"Hi from GLM"')
      expect(raw).not.toContain('[DONE]')

      const receivedHeaders = upstream.received.headers
      expect(receivedHeaders['x-api-key']).toBe('glm-stream-key')
      expect(receivedHeaders['authorization']).toBeUndefined()
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})
