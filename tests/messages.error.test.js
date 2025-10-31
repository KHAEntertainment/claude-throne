import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('POST /v1/messages (errors)', () => {
  it('returns 400 when no usable API key is found', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3114
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { },
      isolateEnv: true,  // Don't inherit parent process env vars
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ messages: [{ role: 'user', content: 'Say hi' }], stream: false })
        .expect(400)
      expect(res.body.error || res.text).toMatch(/No API key found/)
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('sends SSE error event for non-200 streaming responses', async () => {
    const upstream = await startUpstreamMock({ 
      mode: 'sse', 
      statusCode: 400,
      sseChunks: [],
      sseTerminator: ''
    })
    const proxyPort = 3115
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        CUSTOM_API_KEY: 'testkey'
      },
      isolateEnv: true
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ messages: [{ role: 'user', content: 'Say hi' }], stream: true })
        .expect(200) // SSE always returns 200, errors are in events
      
      // Check that response contains error event (Comment 8: upstream non-2xx surfaced as event:error)
      const text = res.text
      expect(text).toMatch(/event: error/)
      expect(text).toMatch(/upstream_error/)
      expect(text).toMatch(/status.*400/)
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})

