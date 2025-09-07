import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('POST /v1/messages (non-streaming)', () => {
  it('maps JSON response and includes Authorization for custom provider', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3111
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { CUSTOM_API_KEY: 'testkey' },
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ messages: [{ role: 'user', content: 'Say hi' }], stream: false })
        .expect(200)

      expect(res.body).toBeTruthy()
      expect(res.body.type).toBe('message')
      expect(res.body.content[0].type).toBe('text')
      expect(res.body.content[0].text).toBe('Hello!')
      expect(res.body.stop_reason).toBe('end_turn')

      // Upstream saw Authorization header
      expect(upstream.received.headers['authorization']).toMatch(/^Bearer /)
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})

